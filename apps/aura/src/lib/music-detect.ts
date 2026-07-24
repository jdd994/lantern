// music-detect.ts — a lightweight, on-device guess at "is this music?" from the
// microphone's own FFT data. No model, no upload: two cheap signals computed
// from what createMicSource is already reading every 250ms.
//
//  • Spectral flatness — near 0 for tonal/harmonic content (instruments,
//    singing), near 1 for broadband noise (traffic, wind, room hum). Music
//    reads low; most ambient sound reads high.
//  • Sustained loudness — the fraction of the last few seconds that's above a
//    near-silence floor. Music tends to stay "on"; speech has gaps between
//    words and sentences; a room is mostly quiet with occasional bursts.
//
// Deliberately conservative: both signals have to agree before this claims
// "music," so a wrong guess is rare rather than confidently wrong — an unset
// kind just falls back to the generic room-sound reading, exactly what
// happens today. These thresholds are a starting point, not a tuned model;
// expect to adjust them against a real mic and real rooms.

export function spectralFlatness(freq: Uint8Array | number[]): number {
  const n = freq.length;
  if (!n) return 1;
  let logSum = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = freq[i] + 1; // +1 avoids log(0) for silent bins
    logSum += Math.log(v);
    sum += v;
  }
  if (sum === 0) return 1;
  const geometricMean = Math.exp(logSum / n);
  const arithmeticMean = sum / n;
  return geometricMean / arithmeticMean;
}

export function sustainedRatio(levels: number[], floor = 0.06): number {
  if (!levels.length) return 0;
  return levels.filter((l) => l > floor).length / levels.length;
}

const FLATNESS_CEILING = 0.35; // below this, the spectrum reads tonal/harmonic
const SUSTAINED_FLOOR = 0.7; // above this, the loudness reads "mostly on"
const MIN_SAMPLES = 8; // ~2s at the 250ms sample rate — long enough to judge

export function guessMusic(flatness: number, recentLevels: number[]): boolean {
  if (recentLevels.length < MIN_SAMPLES) return false;
  return flatness < FLATNESS_CEILING && sustainedRatio(recentLevels) > SUSTAINED_FLOOR;
}
