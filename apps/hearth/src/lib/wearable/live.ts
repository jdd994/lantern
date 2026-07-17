// wearable/live.ts
// The shared arithmetic and shared doorway for a "sit" — a live reading taken
// with a device in the room, over Web Bluetooth, with nothing persisted unless
// you save it. Two devices feed this today (see `sources`):
//
//   strap  the chest strap — ECG-grade, speaks the published Bluetooth SIG
//          heart-rate profile, carries raw beat-to-beat R-R intervals.
//   ring   the ColMi-class smart ring — optical, speaks a reverse-engineered
//          vendor protocol, streams bpm only.
//
// The difference between them is encoded honestly in the data: the strap's R-R
// intervals earn a variability reading; the ring never produces one, because an
// optical bpm stream can't honestly back it. Same sit, different truths — the
// arithmetic below says nothing a device didn't measure.

import type { ProviderId, Reading } from "./index";
import * as strap from "./strap";
import * as ring from "./ring";

// One tick of a live source. `contact` is the device's own "this isn't you"
// flag (strap: off-skin bit; ring: an error frame) — believed, shown, and kept
// out of the summary. `rr` is beat-to-beat gaps in ms; empty when the device
// can't honestly provide them.
export type Sample = {
  bpm: number;
  contact: boolean | null;
  rr: number[];
};

export type Session = {
  name: string;
  stop: () => void;
};

export type LiveSource = {
  open: (onSample: (s: Sample) => void, onDrop: () => void) => Promise<Session | null>;
  // What to say when the device reports it isn't reading you — worn devices
  // are adjusted differently, and vague advice helps nobody.
  offBodyHint: string;
};

export const sources: Partial<Record<ProviderId, LiveSource>> = {
  strap: {
    open: strap.open,
    offBodyHint: "The strap isn't reading you yet — snug it just below your chest.",
  },
  ring: {
    open: ring.open,
    offBodyHint: "The ring isn't reading you yet — settle it snug at the base of your finger.",
  },
};

// Every live source rides Web Bluetooth, so one answer covers them all.
// (Chrome and Edge can; Safari and Firefox can't.)
export const supported = (): boolean =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;

// ---- resting arithmetic ----------------------------------------------------
// Pure summaries of a quiet sit. The honesty rule shapes both: report the
// middle of what was actually seen with its real spread, and when there isn't
// enough clean signal to say something true, say nothing rather than guess.

// An R-R gap outside a plausible human beat, or jumping more than 20% from its
// neighbour, is almost always the device mis-triggering (a moved electrode, a
// missed beat) rather than your heart. Standard artifact rule; applied openly.
const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;
const RR_MAX_JUMP = 0.2;

// Fewer clean pairs than this and an RMSSD is noise wearing a number's clothes.
// A two-minute sit at ordinary heart rates clears it comfortably.
export const MIN_RR_PAIRS = 40;

const plausible = (ms: number) => ms >= RR_MIN_MS && ms <= RR_MAX_MS;

/**
 * RMSSD — the root mean square of successive R-R differences, the standard
 * short-reading variability measure. Computed only over consecutive plausible
 * pairs; returns the count so the caller can decide whether it's enough to say
 * out loud. Null when no pair survives.
 */
export function rmssd(rr: number[]): { value: number; pairs: number } | null {
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < rr.length; i++) {
    const a = rr[i - 1];
    const b = rr[i];
    if (!plausible(a) || !plausible(b)) continue;
    if (Math.abs(b - a) > RR_MAX_JUMP * a) continue;
    const d = b - a;
    sum += d * d;
    pairs++;
  }
  return pairs === 0 ? null : { value: Math.sqrt(sum / pairs), pairs };
}

export type Resting = {
  bpm: number;          // median — the middle of what was seen, not a hopeful mean
  low: number;          // 10th percentile —
  high: number;         //   90th: "mostly between low and high", honestly
  samples: number;
  hrv: number | null;   // RMSSD in ms, only when enough clean pairs backed it
  rrPairs: number;
};

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Summarise a sit. Null until there's anything at all to summarise. */
export function resting(bpms: number[], rr: number[]): Resting | null {
  if (bpms.length === 0) return null;
  const sorted = [...bpms].sort((a, b) => a - b);
  const v = rmssd(rr);
  return {
    bpm: Math.round(pct(sorted, 0.5)),
    low: Math.round(pct(sorted, 0.1)),
    high: Math.round(pct(sorted, 0.9)),
    samples: bpms.length,
    hrv: v && v.pairs >= MIN_RR_PAIRS ? Math.round(v.value) : null,
    rrPairs: v?.pairs ?? 0,
  };
}

/**
 * The readings a saved sit produces. Variability is included only when the
 * summary could honestly compute it — which a ring's sit never can. `at` keys
 * the naturals: a saved sit is one moment, and re-saving the same sit
 * (double-tap, StrictMode) lands on the same records instead of duplicating.
 */
export function toReadings(provider: ProviderId, r: Resting, at: number): Reading[] {
  const out: Reading[] = [
    {
      kind: "restingHR", value: r.bpm, unit: "bpm", at, natural: `${provider}:rhr:${at}`,
      // The spread travels with the number — the saved reading stays exactly as
      // honest as the sit that produced it.
      note: `mostly ${r.low}–${r.high}`,
    },
  ];
  if (r.hrv !== null) {
    out.push({
      kind: "hrv", value: r.hrv, unit: "ms", at, natural: `${provider}:hrv:${at}`,
      note: `from ${r.rrPairs} clean beat gaps`,
    });
  }
  return out;
}
