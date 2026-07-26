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

// Which shelf a vibe sits on when there are enough of them that one flat list
// stops being scannable. A grouping, not a hierarchy — every vibe belongs to
// exactly one palette, and a palette with nothing in it just doesn't render.
export type VibePaletteId = "everyday" | "cozy" | "gather" | "night" | "atmosphere";

export const VIBE_PALETTES: { id: VibePaletteId; label: string }[] = [
  { id: "everyday", label: "Everyday" },
  { id: "cozy", label: "Cozy" },
  { id: "gather", label: "Gather" },
  { id: "night", label: "Night" },
  { id: "atmosphere", label: "Atmosphere" },
];

export type Vibe = {
  id: string;
  label: string;
  description: string;
  accent: string; // hex — a representative swatch every app can preview
  light: VibeLight;
  palette: VibePaletteId;
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
    palette: "cozy",
    mood: "candlelight",
  },
  {
    id: "calm",
    label: "Calm",
    description: "Soft lamplight, easy on the eyes.",
    accent: "#E7B75A",
    light: { brightness: 40, rgb: { r: 255, g: 176, b: 96 }, kelvin: 2400 },
    palette: "everyday",
    mood: "warmth",
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm amber-orange, the golden hour held.",
    accent: "#E07850",
    light: { brightness: 55, rgb: { r: 255, g: 122, b: 72 }, kelvin: 2200 },
    palette: "cozy",
  },
  {
    id: "focus",
    label: "Focus",
    description: "Clear and bright, without going cold.",
    accent: "#C9B48A",
    light: { brightness: 85, rgb: { r: 255, g: 236, b: 206 }, kelvin: 4000 },
    palette: "everyday",
  },
  {
    id: "daylight",
    label: "Daylight",
    description: "Bright and true — awake and clear.",
    accent: "#BFC7D6",
    light: { brightness: 100, rgb: { r: 246, g: 246, b: 255 }, kelvin: 5600 },
    palette: "everyday",
    mood: "daylight",
  },
  {
    id: "morning",
    label: "Morning",
    description: "Crisp and awake — a cool, clear light to start the day on.",
    accent: "#D8E2F0",
    light: { brightness: 90, rgb: { r: 255, g: 250, b: 242 }, kelvin: 5000 },
    palette: "everyday",
  },
  {
    id: "reading",
    label: "Reading",
    description: "Warm and steady — enough to read by without straining, gentle on the eyes.",
    accent: "#D9A868",
    light: { brightness: 60, rgb: { r: 255, g: 206, b: 150 }, kelvin: 2800 },
    palette: "everyday",
  },
  {
    id: "wind-down",
    label: "Wind-down",
    description: "Dim amber to ease toward sleep.",
    accent: "#C98A5A",
    light: { brightness: 20, rgb: { r: 255, g: 150, b: 82 }, kelvin: 2100 },
    palette: "cozy",
  },
  {
    id: "romantic",
    label: "Romantic",
    description: "Low, warm, and close — just the two of you.",
    accent: "#D9455A",
    light: { brightness: 10, rgb: { r: 255, g: 80, b: 95 }, kelvin: 2000 },
    palette: "cozy",
  },
  {
    id: "dinner",
    label: "Dinner",
    description: "Warm and inviting — the light a good meal with people you like deserves.",
    accent: "#E0A468",
    light: { brightness: 65, rgb: { r: 255, g: 190, b: 130 }, kelvin: 2700 },
    palette: "gather",
  },
  {
    id: "gathering",
    label: "Gathering",
    description: "Warm and a little livelier — the light for having people over.",
    accent: "#E0985A",
    light: { brightness: 70, rgb: { r: 255, g: 180, b: 110 }, kelvin: 2600 },
    palette: "gather",
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
    palette: "night",
  },
  {
    id: "yoga",
    label: "Yoga",
    description: "Soft, clear, and grounded — enough light to breathe by, calm enough to sink into.",
    accent: "#E8C89A",
    light: { brightness: 45, rgb: { r: 255, g: 214, b: 170 }, kelvin: 3000 },
    palette: "everyday",
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
    palette: "night",
  },
  {
    id: "movie-night",
    label: "Movie night",
    description: "Barely there and cool-toned — enough to see the room, none of it competing with the screen.",
    accent: "#3A4A78",
    // Kelvin is the coolest a typical bulb goes — the honest white-only fallback
    // for a mood that's really asking for saturated blue, which no "tunable
    // white" fixture can actually produce (see Night's note on the same limit).
    light: { brightness: 6, rgb: { r: 50, g: 65, b: 120 }, kelvin: 6000 },
    palette: "atmosphere",
  },
  {
    id: "storm",
    label: "Storm",
    description: "Moody and cool-dim, like weather rolling in outside.",
    accent: "#6E7896",
    light: { brightness: 15, rgb: { r: 90, g: 100, b: 135 }, kelvin: 6000 },
    palette: "atmosphere",
  },
  {
    id: "rainy-day",
    label: "Rainy day",
    description: "Soft grey-blue, like light through a window on an overcast afternoon.",
    accent: "#A9B4C4",
    light: { brightness: 35, rgb: { r: 200, g: 206, b: 220 }, kelvin: 4200 },
    palette: "atmosphere",
  },
];

export function vibeById(id: string): Vibe | undefined {
  return VIBES.find((v) => v.id === id);
}
