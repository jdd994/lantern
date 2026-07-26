import { describe, expect, it } from "vitest";
import { energyVariability, guessStyle } from "./music-style";

describe("energyVariability", () => {
  it("is 0 for perfectly steady energy", () => {
    expect(energyVariability([0.5, 0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it("is 0 for an empty or single-sample history", () => {
    expect(energyVariability([])).toBe(0);
    expect(energyVariability([0.5])).toBe(0);
  });

  it("is high for energy that swings hard between loud and quiet", () => {
    const punchy = [0.9, 0.05, 0.85, 0.1, 0.9, 0.05, 0.8, 0.1];
    expect(energyVariability(punchy)).toBeGreaterThan(0.6);
  });

  it("is 0 when every value is 0 (guards the divide-by-mean)", () => {
    expect(energyVariability([0, 0, 0])).toBe(0);
  });
});

describe("guessStyle", () => {
  it("stays null with too little history yet", () => {
    expect(guessStyle([0.5, 0.5, 0.5])).toBeNull();
  });

  it("reads steady energy as mellow", () => {
    const steady = new Array(10).fill(0.5);
    expect(guessStyle(steady)).toBe("mellow");
  });

  it("reads hard-swinging energy as energetic", () => {
    const punchy = [0.9, 0.05, 0.85, 0.1, 0.9, 0.05, 0.8, 0.1, 0.9, 0.05];
    expect(guessStyle(punchy)).toBe("energetic");
  });

  it("stays null in the ambiguous middle rather than forcing a guess", () => {
    const middling = [0.6, 0.3, 0.55, 0.35, 0.6, 0.3, 0.55, 0.35, 0.6, 0.3];
    expect(guessStyle(middling)).toBeNull();
  });
});
