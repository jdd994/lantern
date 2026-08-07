import { describe, expect, it } from "vitest";
import {
  RHYTHM_PRESETS,
  rhythmAnchors,
  rhythmLevel,
  rhythmPresetById,
  rhythmTarget,
} from "./rhythm";

const LONDON = { lat: 51.5074, lon: -0.1278 };
// London summer solstice: sunrise ~03:43 UTC, sunset ~20:21 UTC.
const DAY = (h: number, m = 0) => new Date(Date.UTC(2020, 5, 20, h, m));

const sun = rhythmPresetById("sun")!;
const whites = rhythmPresetById("whites")!;
const owl = rhythmPresetById("owl")!;

describe("rhythmLevel", () => {
  it("is zero in the deep of night and full near solar noon", () => {
    // Anchors follow the local calendar day, so derive them from the instant
    // being asked about — exactly as the engine does.
    expect(rhythmLevel(DAY(1), rhythmAnchors(DAY(1), LONDON, sun))).toBe(0);
    expect(rhythmLevel(DAY(12), rhythmAnchors(DAY(12), LONDON, sun))).toBeGreaterThan(0.97);
  });

  it("climbs monotonically through the morning", () => {
    const a = rhythmAnchors(DAY(8), LONDON, sun);
    const l5 = rhythmLevel(DAY(5), a);
    const l8 = rhythmLevel(DAY(8), a);
    const l11 = rhythmLevel(DAY(11), a);
    expect(l5).toBeLessThan(l8);
    expect(l8).toBeLessThan(l11);
  });

  it("eases through the dawn shoulder instead of snapping at sunrise", () => {
    const a = rhythmAnchors(DAY(3), LONDON, sun);
    const mid = new Date((a.dawn.getTime() + a.sunrise.getTime()) / 2);
    const l = rhythmLevel(mid, a);
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(0.5);
  });
});

describe("rhythmTarget", () => {
  it("is cool and bright at midday, warm and dim at night", () => {
    const noon = rhythmTarget(DAY(12), LONDON, sun);
    const night = rhythmTarget(DAY(1), LONDON, sun);
    expect(noon.kelvin).toBeGreaterThan(4800);
    expect(noon.brightness).toBe(100);
    expect(noon.ember).toBeNull();
    expect(night.kelvin).toBe(sun.nightKelvin);
    expect(night.brightness).toBe(sun.nightBrightness);
    expect(night.phase).toBe("night");
  });

  it("sinks into ember red after dusk, deepest in the night", () => {
    const night = rhythmTarget(DAY(1), LONDON, sun);
    expect(night.ember).toEqual(sun.ember);
    // Mid-descent the ember is warmer than the doorway but not yet the deep red.
    const a = rhythmAnchors(DAY(21), LONDON, sun);
    let mid = null;
    for (let m = 0; m < 24 * 60; m += 5) {
      const t = new Date(DAY(0).getTime() + m * 60_000);
      const lv = rhythmLevel(t, a);
      if (lv > 0.02 && lv < sun.emberLevel - 0.02 && t.getTime() > a.sunset.getTime()) {
        mid = rhythmTarget(t, LONDON, sun);
        break;
      }
    }
    expect(mid).not.toBeNull();
    expect(mid!.ember!.g).toBeGreaterThan(sun.ember!.g);
    expect(mid!.ember!.g).toBeLessThan(190);
  });

  it("whites preset never touches brightness or color", () => {
    for (const h of [1, 6, 12, 18, 23]) {
      const t = rhythmTarget(DAY(h), LONDON, whites);
      expect(t.brightness).toBeNull();
      expect(t.ember).toBeNull();
    }
    expect(rhythmTarget(DAY(1), LONDON, whites).kelvin).toBe(2200);
  });

  it("night owl slides the whole day later", () => {
    const base = rhythmAnchors(DAY(12), LONDON, sun);
    const late = rhythmAnchors(DAY(12), LONDON, owl);
    expect(late.dusk.getTime() - base.dusk.getTime()).toBe(75 * 60_000);
    expect(late.dawn.getTime()).toBeGreaterThan(base.dawn.getTime());
  });

  it("falls back to a clock-shaped day without coordinates", () => {
    const a = rhythmAnchors(new Date(2020, 5, 20, 12), null, sun);
    expect(a.clockOnly).toBe(true);
    expect(rhythmLevel(new Date(2020, 5, 20, 3, 0), a)).toBe(0);
    expect(rhythmLevel(new Date(2020, 5, 20, 13, 30), a)).toBeGreaterThan(0.97);
  });

  it("keeps a sane curve for every preset at every hour", () => {
    for (const p of RHYTHM_PRESETS) {
      for (let h = 0; h < 24; h++) {
        const t = rhythmTarget(new Date(2020, 5, 20, h), null, p);
        expect(t.level).toBeGreaterThanOrEqual(0);
        expect(t.level).toBeLessThanOrEqual(1);
        expect(t.kelvin).toBeGreaterThanOrEqual(p.nightKelvin);
        expect(t.kelvin).toBeLessThanOrEqual(p.dayKelvin);
        if (t.brightness !== null) {
          expect(t.brightness).toBeGreaterThanOrEqual(1);
          expect(t.brightness).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
