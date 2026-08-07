// Body.tsx
// Body metrics — weight and a measurement or two, over time. This is the part
// where diet apps do the most harm (BMI, "ideal weight", red arrows). Hearth
// does none of it: your own number, watched gently, like a garden through the
// seasons. The change is stated as a plain fact, never as good or bad.

import { useState } from "react";
import {
  METRIC_META, METRIC_KINDS, series, latest, change, chartSeries, recentAverage,
  witnesses, formatMetric,
  type Metric, type MetricContent, type MetricKind, type MetricSource, type SourceSeries,
} from "../lib/metrics";
import { PROVIDERS } from "../lib/wearable";

const AVG_DAYS = 14;

// Each witness keeps one colour for life (see styles.css — the set is validated
// for colour-vision separation on both the dark and light surfaces). Your own
// typed readings are the baseline testimony: quiet ink and a dashed line, named
// in the legend — never identified by colour alone.
const stroke = (source?: MetricSource) => (source ? `var(--wit-${source})` : "var(--wit-you)");
const dash = (source?: MetricSource) => (source ? undefined : "5 4");
const witnessName = (source?: MetricSource) =>
  source ? PROVIDERS[source].label.toLowerCase() : "typed by you";

// The one true sentence we can say about this series, in Hearth's voice: a fact,
// never a verdict. Which fact depends on the kind — a slow-moving number (weight)
// has a real change since you started; a daily one (sleep, steps) doesn't, and
// gets its average instead. See METRIC_META.daily.
//
// With more than one witness the sentence changes shape entirely: each source
// is stated alone, side by side. Averaging the strap into the ring would be a
// number nobody measured — if they disagree, the disagreement is shown, because
// it's information.
function summarise(metrics: Metric[], kind: MetricKind): string {
  const wits = witnesses(metrics, kind, AVG_DAYS);
  if (wits.length > 1) {
    const each = wits
      .map((w) => `${formatMetric(w.value, kind, w.unit)} ${witnessName(w.source)}`)
      .join(" · ");
    return METRIC_META[kind].daily
      ? `${each} — each on average, last ${AVG_DAYS} days`
      : `${each} — latest from each`;
  }
  const s = series(metrics, kind);
  if (METRIC_META[kind].daily) {
    const avg = recentAverage(metrics, kind, AVG_DAYS);
    if (avg && avg.n > 1) {
      return `${formatMetric(avg.value, kind, avg.unit)} on average, last ${AVG_DAYS} days`;
    }
    if (s.length > 1) return `nothing in the last ${AVG_DAYS} days`;
    return "your first reading — the shape appears as more arrive";
  }
  const chg = change(metrics, kind);
  if (!chg) return "your first reading — the trend appears with the next";
  if (chg.delta === 0) return "steady since you started";
  const since = new Date(s[0].at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${chg.delta < 0 ? "down" : "up"} ${Math.abs(chg.delta).toFixed(METRIC_META[kind].dp)} ${chg.unit} since ${since}`;
}

// A quiet inline line chart — no library, no axes clutter. Just the shape of the
// trend. One witness draws the classic ember line; more than one draws a line
// per source on one shared scale — never a single line threaded through
// different devices' numbers, which would be an average drawn without admitting
// it. Identity comes from the legend below, not from colour alone.
function Chart({ series: all }: { series: SourceSeries[] }) {
  const W = 600, H = 120, pad = 10;
  const flat = all.flatMap((s) => s.points);
  if (flat.length === 0) return null;
  const solo = all.length === 1;
  const xs = flat.map((p) => p.at);
  const ys = flat.map((p) => p.value);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const px = (x: number) => pad + ((x - minX) / spanX) * (W - 2 * pad);
  const py = (y: number) => H - pad - ((y - minY) / spanY) * (H - 2 * pad);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {all.map((s) => {
        const colour = solo ? "var(--ember)" : stroke(s.source);
        const last = s.points[s.points.length - 1];
        return (
          <g key={s.source ?? "you"}>
            {s.points.length > 1 ? (
              <polyline
                points={s.points.map((p) => `${px(p.at).toFixed(1)},${py(p.value).toFixed(1)}`).join(" ")}
                fill="none" stroke={colour} strokeWidth="2" strokeDasharray={solo ? undefined : dash(s.source)}
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ) : null}
            <circle cx={px(last.at)} cy={py(last.value)} r="3.5" fill={colour} />
          </g>
        );
      })}
    </svg>
  );
}

// Who drew which line. Only appears when there's more than one witness — a lone
// series needs no legend, the card's title already names it.
function ChartLegend({ series: all }: { series: SourceSeries[] }) {
  if (all.length < 2) return null;
  return (
    <div className="chart-legend">
      {all.map((s) => (
        <span className="legend-item" key={s.source ?? "you"}>
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="18" y2="2" stroke={stroke(s.source)} strokeWidth="2"
              strokeDasharray={dash(s.source)} />
          </svg>
          {witnessName(s.source)}
        </span>
      ))}
    </div>
  );
}

export function Body({
  metrics, onLog, onRemove, children,
}: {
  metrics: Metric[];
  onLog: () => void;
  onRemove: (id: string) => void;
  // Where readings can come from (a wearable), kept with the readings themselves
  // rather than exiled to a settings screen.
  children?: React.ReactNode;
}) {
  // Which kinds actually have data (weight always shown as the default entry).
  const present = METRIC_KINDS.filter((k) => series(metrics, k).length > 0);
  const kinds = present.length ? present : (["weight"] as MetricKind[]);
  const [kind, setKind] = useState<MetricKind>(kinds[0]);
  const active = kinds.includes(kind) ? kind : kinds[0];

  const s = series(metrics, active);
  const cur = latest(metrics, active);
  const lines = chartSeries(metrics, active);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Body</h2>
        <button className="btn btn-sm" onClick={onLog}>Log</button>
      </div>

      {present.length > 1 ? (
        <div className="metric-tabs">
          {present.map((k) => (
            <button key={k} className={"metric-tab" + (k === active ? " active" : "")} onClick={() => setKind(k)}>
              {METRIC_META[k].label}
            </button>
          ))}
        </div>
      ) : null}

      {s.length === 0 ? (
        <div className="empty">
          Nothing logged yet.
          <br />
          Note your weight when you like — Hearth just shows you the gentle line over time, never a
          judgement.
        </div>
      ) : (
        <div className="metric-card">
          <div className="metric-now">
            <span className="metric-val">{cur ? formatMetric(cur.value, active, cur.unit) : "—"}</span>
            <span className="metric-change">{summarise(metrics, active)}</span>
          </div>
          <Chart series={lines} />
          <ChartLegend series={lines} />
          <div className="metric-list">
            {[...s].reverse().slice(0, 6).map((m) => (
              <div className="metric-row" key={m.id}>
                <span className="metric-row-val">
                  {formatMetric(m.value, active, m.unit)}
                  {/* Where it came from, stated plainly — a reading you typed and a
                      reading your band recorded are not quite the same claim. */}
                  {m.source ? <span className="tier-badge">{PROVIDERS[m.source].label}</span> : null}
                </span>
                <span className="metric-row-date">
                  {new Date(m.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {/* The reading's own uncertainty, kept beside the number for life. */}
                  {m.note ? ` — ${m.note}` : ""}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(m.id)} title="Remove">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {children}
    </section>
  );
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function LogMetric({
  onLog, onClose,
}: {
  onLog: (c: MetricContent, at: number) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MetricKind>("weight");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(METRIC_META.weight.units[0]);
  const [date, setDate] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);

  function pickKind(k: MetricKind) {
    setKind(k);
    setUnit(METRIC_META[k].units[0]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(value);
    if (!v || v <= 0) return setError("Enter a number.");
    const at = date === todayStr() ? Date.now() : new Date(`${date}T12:00:00`).getTime();
    await onLog({ kind, value: v, unit }, at);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Log a reading</h3>
        <div className="choices">
          {METRIC_KINDS.map((k) => (
            <button key={k} type="button" className="choice" aria-pressed={kind === k} onClick={() => pickKind(k)}>
              {METRIC_META[k].label}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}
          <div className="row">
            <label className="field">
              <span className="label">{METRIC_META[kind].label}</span>
              <input type="number" min={0} step="0.1" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.0" autoFocus />
            </label>
            {METRIC_META[kind].units.length > 1 ? (
              <label className="field" style={{ flex: "0 0 90px" }}>
                <span className="label">Unit</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {METRIC_META[kind].units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <label className="field">
            <span className="label">When</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
