// palette.ts — when a vibe reaches more than one light, give each light its own
// small, deterministic pull within the vibe's palette instead of the identical
// flat color everywhere. Real rooms don't have every lamp at one exact hue —
// a candle and a lamp across the room read warm together without matching to
// the pixel. Pure, seeded by the device's own id, so a light keeps "its"
// variant every time you apply the same vibe — no flicker, no randomness on
// reapply, nothing to store.
import type { Color } from "./connectors";

// FNV-1a-ish string hash — good spread for a cosmetic seed, not cryptographic.
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // normalize to [0, 1)
}

// -1..1 from a seed, distinct per "axis" so a light's hue, brightness, and
// kelvin pulls don't all swing the same direction together.
function signed(seed: string, axis: string): number {
  return hash(`${seed}:${axis}`) * 2 - 1;
}

function rgbToHsl(c: Color): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(h: number, s: number, l: number): Color {
  h = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(h / 360 + 1 / 3) * 255),
    g: Math.round(hue2rgb(h / 360) * 255),
    b: Math.round(hue2rgb(h / 360 - 1 / 3) * 255),
  };
}

// Kept deliberately narrow — a "family" of related tones, never far enough to
// clash or drift the vibe's own identity (Night should still read unmistakably red).
const HUE_SPREAD_DEG = 12;
const LIGHTNESS_SPREAD = 0.06;
const BRIGHTNESS_SPREAD = 8; // points, out of 100
const KELVIN_SPREAD = 150;

export type PaletteTarget = { brightness: number; rgb: Color; kelvin?: number };

// One light's pull within a vibe's palette. `seed` should be the device's own
// stable id. `only` (a single-light target) returns the base unchanged —
// nothing to vary against with just one light.
export function paletteVariant(base: PaletteTarget, seed: string, only: boolean): PaletteTarget {
  if (only) return base;
  const { h, s, l } = rgbToHsl(base.rgb);
  const hue = h + signed(seed, "hue") * HUE_SPREAD_DEG;
  const lightness = Math.max(0, Math.min(1, l + signed(seed, "light") * LIGHTNESS_SPREAD));
  const rgb = hslToRgb(hue, s, lightness);
  const brightness = Math.max(1, Math.min(100, Math.round(base.brightness + signed(seed, "brightness") * BRIGHTNESS_SPREAD)));
  const kelvin =
    base.kelvin !== undefined
      ? Math.max(2000, Math.min(6500, Math.round(base.kelvin + signed(seed, "kelvin") * KELVIN_SPREAD)))
      : undefined;
  return { brightness, rgb, kelvin };
}
