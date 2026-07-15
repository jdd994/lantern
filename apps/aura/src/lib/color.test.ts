import { describe, expect, it } from "vitest";
import { hexToRgb, intToRgb, rgbToHex, rgbToInt } from "./color";

describe("color conversions", () => {
  it("round-trips rgb ↔ int", () => {
    const c = { r: 231, g: 183, b: 90 };
    expect(intToRgb(rgbToInt(c))).toEqual(c);
  });

  it("packs int in 0xRRGGBB order", () => {
    expect(rgbToInt({ r: 255, g: 0, b: 0 })).toBe(0xff0000);
    expect(rgbToInt({ r: 0, g: 255, b: 0 })).toBe(0x00ff00);
    expect(rgbToInt({ r: 0, g: 0, b: 255 })).toBe(0x0000ff);
  });

  it("clamps out-of-range channels", () => {
    expect(rgbToInt({ r: 999, g: -5, b: 300 })).toBe(rgbToInt({ r: 255, g: 0, b: 255 }));
  });

  it("round-trips rgb ↔ hex", () => {
    const c = { r: 18, g: 200, b: 7 };
    expect(hexToRgb(rgbToHex(c))).toEqual(c);
  });

  it("formats hex with padding and falls back when unset", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex(undefined)).toBe("#e7b75a");
  });
});
