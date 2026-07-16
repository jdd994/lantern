import { describe, expect, it } from "vitest";
import { adaptiveKelvin } from "./adaptive";

const LONDON = { lat: 51.5074, lon: -0.1278 };

describe("adaptiveKelvin", () => {
  it("is warm in the deep of night", () => {
    expect(adaptiveKelvin(new Date(Date.UTC(2020, 5, 20, 2, 0)), LONDON)).toBe(2200);
  });

  it("is cooler around midday than at night", () => {
    const noon = adaptiveKelvin(new Date(Date.UTC(2020, 5, 20, 12, 0)), LONDON);
    const night = adaptiveKelvin(new Date(Date.UTC(2020, 5, 20, 2, 0)), LONDON);
    expect(noon).toBeGreaterThan(night);
    expect(noon).toBeLessThanOrEqual(5200);
    expect(noon).toBeGreaterThan(3500);
  });

  it("stays within the warm–cool band without coordinates too", () => {
    for (let h = 0; h < 24; h++) {
      const k = adaptiveKelvin(new Date(2020, 5, 20, h, 0), null);
      expect(k).toBeGreaterThanOrEqual(2200);
      expect(k).toBeLessThanOrEqual(5200);
    }
  });
});
