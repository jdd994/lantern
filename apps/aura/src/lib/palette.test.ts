import { describe, expect, it } from "vitest";
import { paletteVariant, type PaletteTarget } from "./palette";

const CANDLELIGHT: PaletteTarget = { brightness: 14, rgb: { r: 255, g: 138, b: 58 }, kelvin: 1900 };

describe("paletteVariant", () => {
  it("returns the base unchanged when it's the only light", () => {
    expect(paletteVariant(CANDLELIGHT, "device-1", true)).toEqual(CANDLELIGHT);
  });

  it("is deterministic — the same device gets the same variant every time", () => {
    const a = paletteVariant(CANDLELIGHT, "device-1", false);
    const b = paletteVariant(CANDLELIGHT, "device-1", false);
    expect(a).toEqual(b);
  });

  it("gives different devices different variants", () => {
    const a = paletteVariant(CANDLELIGHT, "device-1", false);
    const b = paletteVariant(CANDLELIGHT, "device-2", false);
    expect(a).not.toEqual(b);
  });

  it("stays a believable neighbor of the base — never a wildly different color", () => {
    for (const seed of ["a", "b", "c", "reading-lamp", "desk-strip", "ceiling", "candle"]) {
      const v = paletteVariant(CANDLELIGHT, seed, false);
      // Still clearly warm: red channel stays dominant, blue stays low.
      expect(v.rgb.r).toBeGreaterThan(v.rgb.b);
      expect(v.rgb.r).toBeGreaterThan(150);
      // Brightness and kelvin stay in the immediate neighborhood of the base.
      expect(Math.abs(v.brightness - CANDLELIGHT.brightness)).toBeLessThanOrEqual(8);
      expect(Math.abs((v.kelvin ?? 0) - (CANDLELIGHT.kelvin ?? 0))).toBeLessThanOrEqual(150);
    }
  });

  it("never drops brightness to zero or below one, even at the low end of Night", () => {
    const NIGHT: PaletteTarget = { brightness: 8, rgb: { r: 200, g: 25, b: 0 }, kelvin: 2000 };
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(paletteVariant(NIGHT, seed, false).brightness).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps kelvin within the connectors' clamped range", () => {
    const DAYLIGHT: PaletteTarget = { brightness: 100, rgb: { r: 246, g: 246, b: 255 }, kelvin: 5600 };
    for (const seed of ["a", "b", "c", "d"]) {
      const k = paletteVariant(DAYLIGHT, seed, false).kelvin ?? 0;
      expect(k).toBeGreaterThanOrEqual(2000);
      expect(k).toBeLessThanOrEqual(6500);
    }
  });

  it("has no kelvin when the base has none", () => {
    const base: PaletteTarget = { brightness: 50, rgb: { r: 200, g: 100, b: 50 } };
    expect(paletteVariant(base, "x", false).kelvin).toBeUndefined();
  });
});
