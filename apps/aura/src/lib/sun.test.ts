import { describe, expect, it } from "vitest";
import { sunTime } from "./sun";

// London, summer solstice 2020-06-20. Reference almanac: sunrise ~03:43 UTC,
// sunset ~20:21 UTC. We assert coarse windows so the test catches gross errors
// (bad quadrant, sign flips) without being brittle about the last minute.
const LONDON = { lat: 51.5074, lon: -0.1278 };

describe("sunTime", () => {
  it("computes a plausible London solstice sunrise (UTC)", () => {
    const t = sunTime(new Date(2020, 5, 20), LONDON.lat, LONDON.lon, "sunrise")!;
    expect(t).not.toBeNull();
    const h = t.getUTCHours() + t.getUTCMinutes() / 60;
    expect(h).toBeGreaterThan(3);
    expect(h).toBeLessThan(5);
  });

  it("computes a plausible London solstice sunset (UTC)", () => {
    const t = sunTime(new Date(2020, 5, 20), LONDON.lat, LONDON.lon, "sunset")!;
    const h = t.getUTCHours() + t.getUTCMinutes() / 60;
    expect(h).toBeGreaterThan(19);
    expect(h).toBeLessThan(21);
  });

  it("puts sunset after sunrise on the same day", () => {
    const rise = sunTime(new Date(2021, 2, 15), 40.71, -74.0, "sunrise")!; // NYC
    const set = sunTime(new Date(2021, 2, 15), 40.71, -74.0, "sunset")!;
    expect(set.getTime()).toBeGreaterThan(rise.getTime());
  });

  it("returns null in the polar night (no sunrise)", () => {
    // Longyearbyen (78°N) in mid-December — the sun never rises.
    expect(sunTime(new Date(2021, 11, 21), 78.22, 15.65, "sunrise")).toBeNull();
  });
});
