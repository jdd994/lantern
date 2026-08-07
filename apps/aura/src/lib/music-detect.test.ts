import { describe, expect, it } from "vitest";
import { guessMusic, spectralFlatness, sustainedRatio } from "./music-detect";

describe("spectralFlatness", () => {
  it("reads high (near 1) for a flat/broadband spectrum", () => {
    const flat = new Array(64).fill(128);
    expect(spectralFlatness(flat)).toBeGreaterThan(0.95);
  });

  it("reads low for a peaky/tonal spectrum (a few harmonic peaks over near-silence)", () => {
    const peaky = new Array(64).fill(0);
    peaky[5] = 200;
    peaky[10] = 180;
    peaky[15] = 150;
    peaky[20] = 100;
    expect(spectralFlatness(peaky)).toBeLessThan(0.2);
  });

  it("returns 1 for silence (all zero)", () => {
    expect(spectralFlatness(new Array(64).fill(0))).toBe(1);
  });

  it("returns 1 for an empty spectrum", () => {
    expect(spectralFlatness([])).toBe(1);
  });
});

describe("sustainedRatio", () => {
  it("is 1 when every sample is above the floor", () => {
    expect(sustainedRatio([0.5, 0.6, 0.4, 0.55])).toBe(1);
  });

  it("is low when most samples are near-silent (speech-like gaps)", () => {
    expect(sustainedRatio([0.5, 0, 0, 0.4, 0, 0])).toBeCloseTo(1 / 3, 5);
  });

  it("is 0 for an empty history", () => {
    expect(sustainedRatio([])).toBe(0);
  });
});

describe("guessMusic", () => {
  const tonal = new Array(64).fill(1);
  tonal[5] = 255;
  tonal[6] = 200;
  const tonalFlatness = spectralFlatness(tonal);

  const noisy = new Array(64).fill(128);
  const noisyFlatness = spectralFlatness(noisy);

  it("says yes when the spectrum is tonal and loudness is sustained", () => {
    expect(guessMusic(tonalFlatness, new Array(10).fill(0.5))).toBe(true);
  });

  it("says no when the spectrum is tonal but loudness is bursty (speech-like)", () => {
    const bursty = [0.5, 0, 0, 0.4, 0, 0, 0.5, 0, 0, 0];
    expect(guessMusic(tonalFlatness, bursty)).toBe(false);
  });

  it("says no when loudness is sustained but the spectrum is broadband (noise-like)", () => {
    expect(guessMusic(noisyFlatness, new Array(10).fill(0.5))).toBe(false);
  });

  it("stays conservative with too little history yet", () => {
    expect(guessMusic(tonalFlatness, new Array(4).fill(0.5))).toBe(false);
  });
});
