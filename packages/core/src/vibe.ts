// vibe.ts — the shared "vibe" vocabulary: one small set of named moods the whole
// lantern family reads from. A vibe is a *semantic* atmosphere ("candlelight"),
// deliberately medium-agnostic: each app renders it in its own material — Aura as
// room lighting, @lantern/ui as a screen theme (`mood`), a music app as a seed.
//
// This module is only the vocabulary + a neutral target. It holds no transport:
// how a vibe chosen in one app reaches another is a separate concern that rides the
// sync layer once an app has an account (see the cross-app design note). Keeping the
// words here — and nothing else — is what lets the apps agree on "candlelight"
// without knowing anything about each other.

export type VibeLight = {
  brightness: number; // 0..100
  rgb: { r: number; g: number; b: number };
  kelvin: number; // approximate white point, for fixtures that prefer temperature
};

export type Vibe = {
  id: string;
  label: string;
  description: string;
  accent: string; // hex — a representative swatch every app can preview
  light: VibeLight;
  mood?: string; // optional hint to @lantern/ui useTheme mood id, where one fits
};

// Warm-leaning by design — the family's soul is a lamplit room, not a showroom.
export const VIBES: Vibe[] = [
  {
    id: "candlelight",
    label: "Candlelight",
    description: "Deep, warm, and low — a room by one flame.",
    accent: "#E0954B",
    light: { brightness: 14, rgb: { r: 255, g: 138, b: 58 }, kelvin: 1900 },
    mood: "candlelight",
  },
  {
    id: "calm",
    label: "Calm",
    description: "Soft lamplight, easy on the eyes.",
    accent: "#E7B75A",
    light: { brightness: 40, rgb: { r: 255, g: 176, b: 96 }, kelvin: 2400 },
    mood: "warmth",
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm amber-orange, the golden hour held.",
    accent: "#E07850",
    light: { brightness: 55, rgb: { r: 255, g: 122, b: 72 }, kelvin: 2200 },
  },
  {
    id: "focus",
    label: "Focus",
    description: "Clear and bright, without going cold.",
    accent: "#C9B48A",
    light: { brightness: 85, rgb: { r: 255, g: 236, b: 206 }, kelvin: 4000 },
  },
  {
    id: "daylight",
    label: "Daylight",
    description: "Bright and true — awake and clear.",
    accent: "#BFC7D6",
    light: { brightness: 100, rgb: { r: 246, g: 246, b: 255 }, kelvin: 5600 },
    mood: "daylight",
  },
  {
    id: "wind-down",
    label: "Wind-down",
    description: "Dim amber to ease toward sleep.",
    accent: "#C98A5A",
    light: { brightness: 20, rgb: { r: 255, g: 150, b: 82 }, kelvin: 2100 },
  },
];

export function vibeById(id: string): Vibe | undefined {
  return VIBES.find((v) => v.id === id);
}
