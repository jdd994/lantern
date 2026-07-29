import { describe, expect, it } from "vitest";
import { sunTime, twilight } from "./sun";

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

describe("twilight", () => {
  it("puts civil dawn before sunrise and civil dusk after sunset", () => {
    const day = new Date(2021, 2, 15); // NYC equinox-ish
    const dawn = twilight(day, 40.71, -74.0, "dawn")!;
    const rise = sunTime(day, 40.71, -74.0, "sunrise")!;
    const set = sunTime(day, 40.71, -74.0, "sunset")!;
    const dusk = twilight(day, 40.71, -74.0, "dusk")!;
    expect(dawn.getTime()).toBeLessThan(rise.getTime());
    expect(dusk.getTime()).toBeGreaterThan(set.getTime());
    // Civil twilight is roughly 20–40 minutes at mid-latitudes — coarse sanity.
    expect(rise.getTime() - dawn.getTime()).toBeGreaterThan(10 * 60_000);
    expect(rise.getTime() - dawn.getTime()).toBeLessThan(60 * 60_000);
  });

  it("returns null in white nights where the sun never gets 6° under", () => {
    // Reykjavík (64°N) at midsummer — bright all night, no true civil dusk.
    expect(twilight(new Date(2021, 5, 21), 64.15, -21.94, "dusk")).toBeNull();
  });
});
