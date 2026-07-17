// metrics.ts
// Pure logic for body metrics — weight and a couple of measurements, tracked
// over time. The tone rule from CLAUDE.md is absolute here: this is your own
// number, watched gently, like a garden through the seasons. NEVER a BMI, never
// an "ideal weight", never a comparison to anyone, never a verdict. It just shows
// you your own trend, so you can notice it with compassion.

export type MetricKind = "weight" | "waist" | "bodyfat" | "sleep" | "restingHR" | "steps" | "hrv";

// `daily` marks the kinds that are a fresh quantity every day rather than a
// slow-moving state. It decides which true thing we can say about a series:
// your weight today genuinely compares to your weight in June, but last night's
// sleep doesn't "compare" to some night a fortnight ago — see recentAverage.
export const METRIC_META: Record<
  MetricKind,
  { label: string; units: string[]; canonical: string; dp: number; daily?: boolean }
> = {
  weight: { label: "Weight", units: ["kg", "lb"], canonical: "kg", dp: 1 },
  waist: { label: "Waist", units: ["cm", "in"], canonical: "cm", dp: 1 },
  bodyfat: { label: "Body fat", units: ["%"], canonical: "%", dp: 1 },
  // Kinds a wearable can fill in (and you can still type by hand). They're
  // measurements, never grades — see lib/wearable/index.ts for why no score,
  // and no calories burned, is ever one of these.
  // Resting heart rate is NOT daily: like weight, it drifts slowly, so its
  // change over months is a real fact about you.
  sleep: { label: "Sleep", units: ["h"], canonical: "h", dp: 1, daily: true },
  restingHR: { label: "Resting heart rate", units: ["bpm"], canonical: "bpm", dp: 0 },
  steps: { label: "Steps", units: ["steps"], canonical: "steps", dp: 0, daily: true },
  // Beat-to-beat variability (RMSSD) from a strap's R-R intervals — arithmetic
  // on your own heartbeats, never a vendor's readiness grade. Marked daily
  // because it genuinely swings with sleep and stress: the true statement about
  // it is what it's been averaging, not the gap between two arbitrary sits.
  hrv: { label: "Heart rate variability", units: ["ms"], canonical: "ms", dp: 0, daily: true },
};

export const METRIC_KINDS = Object.keys(METRIC_META) as MetricKind[];

// Where a reading came from. Absent means you typed it — the ordinary case, and
// the reason this is optional rather than defaulted.
export type MetricSource = "fitbit" | "strap" | "ring";

export type MetricContent = {
  kind: MetricKind;
  value: number;
  unit: string;
  note?: string;
  source?: MetricSource;
};
export type Metric = MetricContent & { id: string; at: number };

// Convert to/from each kind's canonical unit, so readings entered in kg and lb
// (or cm and in) sit on one honest scale for trend + charting.
export function toCanonical(value: number, kind: MetricKind, unit: string): number {
  if (kind === "weight" && unit === "lb") return value * 0.45359237;
  if (kind === "waist" && unit === "in") return value * 2.54;
  return value;
}
export function fromCanonical(value: number, kind: MetricKind, unit: string): number {
  if (kind === "weight" && unit === "lb") return value / 0.45359237;
  if (kind === "waist" && unit === "in") return value / 2.54;
  return value;
}

// Readings of a kind, oldest → newest.
export function series(metrics: Metric[], kind: MetricKind): Metric[] {
  return metrics.filter((m) => m.kind === kind).sort((a, b) => a.at - b.at);
}

export function latest(metrics: Metric[], kind: MetricKind): Metric | undefined {
  const s = series(metrics, kind);
  return s[s.length - 1];
}

// Net change from first to latest reading, in the latest reading's display unit.
// Null if fewer than two readings (nothing to compare yet — stay quiet, don't
// invent a trend).
export function change(metrics: Metric[], kind: MetricKind): { delta: number; unit: string } | null {
  const s = series(metrics, kind);
  if (s.length < 2) return null;
  const first = s[0];
  const last = s[s.length - 1];
  const unit = last.unit;
  const deltaCanonical =
    toCanonical(last.value, kind, last.unit) - toCanonical(first.value, kind, first.unit);
  return { delta: fromCanonical(deltaCanonical, kind, unit), unit };
}

// The mean of the last `days`, in the latest reading's display unit.
//
// This exists because `change` would lie about a daily kind. "Up 2,431 steps
// since Jul 1" compares two arbitrary days and calls the difference a trend —
// noise wearing the clothes of a finding. For a number that swings every day,
// the quiet true thing is what it's been averaging. Still your own number, still
// no target, still no verdict; just a steadier way of looking at it.
//
// Null when there's nothing in the window — better to say so than to widen the
// window silently and average something else than what we claimed.
export function recentAverage(
  metrics: Metric[], kind: MetricKind, days = 14
): { value: number; unit: string; n: number } | null {
  const s = series(metrics, kind);
  if (s.length === 0) return null;
  const unit = s[s.length - 1].unit;
  const cutoff = Date.now() - days * 86_400_000;
  const recent = s.filter((m) => m.at >= cutoff);
  if (recent.length === 0) return null;
  const mean =
    recent.reduce((total, m) => total + toCanonical(m.value, kind, m.unit), 0) / recent.length;
  return { value: fromCanonical(mean, kind, unit), unit, n: recent.length };
}

// ---- witnesses -------------------------------------------------------------
// Source-aware aggregation. When more than one device (or your own hand) has
// something to say about a metric, each is a separate witness: sources are
// never averaged together silently, because the strap saying 58 while the ring
// says 62 is information, not noise to smooth over. These helpers keep every
// testimony separate; the display's job is to show them side by side.

export type Witness = {
  source?: MetricSource; // absent = typed by you, same convention as MetricContent
  n: number;             // readings this witness contributed (window for daily kinds)
  value: number;         // its own honest summary — never blended with another's
  unit: string;
};

const bySource = (metrics: Metric[], kind: MetricKind): Map<MetricSource | undefined, Metric[]> => {
  const groups = new Map<MetricSource | undefined, Metric[]>();
  for (const m of series(metrics, kind)) {
    const g = groups.get(m.source);
    if (g) g.push(m);
    else groups.set(m.source, [m]);
  }
  return groups;
};

/**
 * Everyone who has testified about this kind, each summarised alone: the recent
 * average for a daily kind, the latest reading for a slow-moving one — the same
 * one-true-sentence rule as the single-source view, applied per witness. All
 * values are stated in one shared unit (the series' latest display unit) so
 * they can sit in a sentence together. Most recent testimony first.
 */
export function witnesses(metrics: Metric[], kind: MetricKind, days = 14): Witness[] {
  const s = series(metrics, kind);
  if (s.length === 0) return [];
  const unit = s[s.length - 1].unit;
  const cutoff = Date.now() - days * 86_400_000;
  const out: { w: Witness; lastAt: number }[] = [];
  for (const [source, group] of bySource(metrics, kind)) {
    const lastAt = group[group.length - 1].at;
    if (METRIC_META[kind].daily) {
      const recent = group.filter((m) => m.at >= cutoff);
      if (recent.length === 0) continue; // nothing recent to say — silence, not a stale number
      const mean =
        recent.reduce((total, m) => total + toCanonical(m.value, kind, m.unit), 0) / recent.length;
      out.push({ w: { source, n: recent.length, value: fromCanonical(mean, kind, unit), unit }, lastAt });
    } else {
      const last = group[group.length - 1];
      out.push({
        w: {
          source, n: group.length,
          value: fromCanonical(toCanonical(last.value, kind, last.unit), kind, unit), unit,
        },
        lastAt,
      });
    }
  }
  return out.sort((a, b) => b.lastAt - a.lastAt).map((x) => x.w);
}

// Points for a chart: {at, value} in the latest reading's display unit, so a
// mixed-unit history still draws one continuous line.
export type Point = { at: number; value: number };
export function chartPoints(metrics: Metric[], kind: MetricKind): Point[] {
  const s = series(metrics, kind);
  if (s.length === 0) return [];
  const unit = s[s.length - 1].unit;
  return s.map((m) => ({ at: m.at, value: fromCanonical(toCanonical(m.value, kind, m.unit), kind, unit) }));
}

// One line per witness, never one line through all of them — a chart that
// threads the strap's beats and the ring's into a single polyline is an average
// drawn without admitting it. Every series shares one unit (the overall latest
// display unit) so the lines are honestly comparable on one scale.
export type SourceSeries = { source?: MetricSource; points: Point[] };
export function chartSeries(metrics: Metric[], kind: MetricKind): SourceSeries[] {
  const s = series(metrics, kind);
  if (s.length === 0) return [];
  const unit = s[s.length - 1].unit;
  const out: SourceSeries[] = [];
  for (const [source, group] of bySource(metrics, kind)) {
    out.push({
      source,
      points: group.map((m) => ({
        at: m.at, value: fromCanonical(toCanonical(m.value, kind, m.unit), kind, unit),
      })),
    });
  }
  // Most recent testimony last, so the liveliest line draws on top.
  return out.sort(
    (a, b) => a.points[a.points.length - 1].at - b.points[b.points.length - 1].at
  );
}

export function formatMetric(value: number, kind: MetricKind, unit: string): string {
  return `${Number(value.toFixed(METRIC_META[kind].dp)).toLocaleString()} ${unit}`;
}
