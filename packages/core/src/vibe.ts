// vibe.ts — the shared "vibe" vocabulary: one small set of named moods the whole
// lantern family reads from. A vibe is a *semantic* atmosphere ("candlelight"),
// deliberately medium-agnostic: each app renders it in its own material — Aura as
// room lighting, @lantern/ui as a screen theme (`mood`), a music app as a seed.
//
// This module is only the vocabulary + a neutral target — it holds no transport
// itself. The transport that exists today is `vibe-relay.ts`: a same-machine,
// account-free WebSocket relay (packages/vibe-relay). That's deliberate, not a
// placeholder — a vibe is an ephemeral, already-on-screen mood pick, not data
// worth an account, and Aura has no account/vault by design ("you shouldn't type
// a password to dim a lamp"). True cross-device transport riding the real
// sync/account system (packages/server) remains a possible later path for apps
// that already have an account, but isn't needed for same-machine mirroring.
// Keeping the words here — and nothing else — is what lets the apps agree on
// "candlelight" without knowing anything else about each other.

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
  {
    id: "night",
    label: "Night",
    description: "Deep red, barely there — the last light before sleep, with no blue in it.",
    accent: "#C81900",
    // The one true stop for zero-blue: b: 0. Only a color-capable bulb actually
    // gets there — kelvin is the honest fallback for white-only fixtures, but no
    // "warm white" LED can truly reach zero blue (they're a blue diode under a
    // phosphor coating, physically) — 2000K is just the warmest most bulbs go.
    light: { brightness: 8, rgb: { r: 200, g: 25, b: 0 }, kelvin: 2000 },
  },
  {
    id: "yoga",
    label: "Yoga",
    description: "Soft, clear, and grounded — enough light to breathe by, calm enough to sink into.",
    accent: "#E8C89A",
    light: { brightness: 45, rgb: { r: 255, g: 214, b: 170 }, kelvin: 3000 },
  },
  {
    id: "night-yoga",
    label: "Night yoga",
    description: "Low amber light to move by outside after dark — enough to see your mat, none of the blue that would wake you up.",
    accent: "#D2864B",
    // Between Night and Yoga on purpose: Night's near-monochrome red is too flat
    // to judge distance/balance by (bad for a standing pose outdoors); Yoga's
    // daytime brightness is too much for after dark. Some green stays in the mix
    // (unlike Night) so shapes and edges still read, just low and warm.
    light: { brightness: 30, rgb: { r: 255, g: 150, b: 70 }, kelvin: 2300 },
  },
];

export function vibeById(id: string): Vibe | undefined {
  return VIBES.find((v) => v.id === id);
}
