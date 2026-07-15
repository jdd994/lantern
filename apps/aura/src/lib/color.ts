// color.ts — pure color conversions, shared by connectors (brand int formats) and
// the UI (native <input type=color> hex). No IO; unit-tested in color.test.ts.
import type { Color } from "./connectors";

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

// 24-bit packed RGB, the form several brand APIs (Govee) use.
export const rgbToInt = (c: Color): number =>
  (clamp255(c.r) << 16) | (clamp255(c.g) << 8) | clamp255(c.b);

export const intToRgb = (n: number): Color => ({
  r: (n >> 16) & 255,
  g: (n >> 8) & 255,
  b: n & 255,
});

const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, "0");

// "#rrggbb" for the native color input. Falls back to the glow accent when unset.
export const rgbToHex = (c?: Color): string =>
  c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : "#e7b75a";

export const hexToRgb = (h: string): Color => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});
