// music-style.ts — a rough "what kind of energy is this" read for music
// already identified by music-detect.ts. Two honest limits, stated up front:
//
//  • This can't tell genres apart. That needs a real trained model — no
//    signal-processing heuristic gets from an FFT to "this is jazz."
//  • This can't measure actual tempo either. At the 250ms sample rate
//    ambient-source.ts reads at, most real tempos (60-180 BPM → 1000-333ms
//    beat intervals) sit too close to or below the sampling interval to
//    resolve without aliasing — a "we detected 128 BPM" readout here would be
//    false precision, not a real measurement.
//
// What IS reliable at this resolution: how much the track's energy swings
// moment to moment. A driving, percussive track alternates hard between quiet
// gaps and loud hits; a steady, textural one barely moves. That's
// "energetic vs mellow" — a real, useful distinction this signal can actually
// back up, computed from the same rolling energy history music-detect.ts's
// sustainedRatio already reads.

// Coefficient of variation (stddev / mean) — the shape of the swings,
// independent of how loud the room is overall.
export function energyVariability(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export type MusicStyle = "energetic" | "mellow" | null;

const MIN_SAMPLES = 8; // ~2s at the 250ms sample rate — long enough to judge
const ENERGETIC_FLOOR = 0.6;
const MELLOW_CEILING = 0.25;

// Conservative, same shape as music-detect's guessMusic: null ("can't tell
// yet") beats a confident wrong guess. The ambiguous middle between the two
// thresholds deliberately stays null rather than being forced one way.
export function guessStyle(energyHistory: number[]): MusicStyle {
  if (energyHistory.length < MIN_SAMPLES) return null;
  const variability = energyVariability(energyHistory);
  if (variability > ENERGETIC_FLOOR) return "energetic";
  if (variability < MELLOW_CEILING) return "mellow";
  return null;
}
