// rhythm.ts — the day rhythm: one continuous curve over the real day, from which
// everything the rhythm does is read. Pure and unit-tested; the hook applies it on
// a timer. This grew out of adaptive.ts (the plain circadian white curve) — the
// rhythm keeps that soul and adds the edges of the day: it eases up through dawn
// rather than snapping at sunrise, sinks past "warm white" into ember red after
// dusk on bulbs that can say it, and (per preset) carries brightness along too.
//
// The one promise, same as adaptive white always made: the rhythm shapes light
// that's already burning. It never turns a light on.
import { sunTime, twilight } from "./sun";
import type { Coords } from "./automations";
import type { Color } from "./connectors";

export type RhythmPreset = {
  id: string;
  label: string;
  description: string;
  accent: string; // hex — a representative swatch for the preset picker
  dayKelvin: number; // the midday peak
  nightKelvin: number; // the floor a white-only bulb settles at
  // Brightness shaping: null means the preset never touches brightness at all —
  // not "brightness 0", but "that dial belongs entirely to you".
  dayBrightness: number | null;
  nightBrightness: number;
  // The color the evening sinks into, past the warmest white a bulb can say.
  // Only color-capable bulbs ever get this; null = a whites-only rhythm.
  ember: Color | null;
  emberLevel: number; // curve level below which the ember descent begins (0..1)
  shiftMin: number; // slide the whole curve later (+) — the night owl's day
  morningLagMin: number; // hold the dawn ramp back this much — slow mornings
};

export const RHYTHM_PRESETS: RhythmPreset[] = [
  {
    id: "sun",
    label: "Follow the sun",
    accent: "#E7B75A",
    description:
      "The balanced default. Cool, bright light through the middle of the day; warm and dimmer as the sun goes; ember red after dusk on bulbs that can show it.",
    dayKelvin: 5200,
    nightKelvin: 2000,
    dayBrightness: 100,
    nightBrightness: 25,
    ember: { r: 255, g: 120, b: 45 },
    emberLevel: 0.18,
    shiftMin: 0,
    morningLagMin: 0,
  },
  {
    id: "candle",
    label: "Candlelit evenings",
    accent: "#E0954B",
    description:
      "The descent starts earlier and goes deeper — evenings sink toward candlelight and near-dark, mornings stay ordinary.",
    dayKelvin: 5000,
    nightKelvin: 2000,
    dayBrightness: 100,
    nightBrightness: 12,
    ember: { r: 255, g: 100, b: 28 },
    emberLevel: 0.32,
    shiftMin: 0,
    morningLagMin: 0,
  },
  {
    id: "owl",
    label: "Night owl",
    accent: "#8E7CB0",
    description:
      "The same rhythm, slid later — morning light arrives gently and the evening wind-down waits for your evening, not the sun's.",
    dayKelvin: 5200,
    nightKelvin: 2000,
    dayBrightness: 100,
    nightBrightness: 25,
    ember: { r: 255, g: 120, b: 45 },
    emberLevel: 0.18,
    shiftMin: 75,
    morningLagMin: 30,
  },
  {
    id: "whites",
    label: "Just the whites",
    accent: "#CFE0FF",
    description:
      "Only color temperature, nothing else — warm at the edges of the day, cool at midday. Brightness and color stay entirely yours.",
    dayKelvin: 5200,
    nightKelvin: 2200,
    dayBrightness: null,
    nightBrightness: 0,
    ember: null,
    emberLevel: 0,
    shiftMin: 0,
    morningLagMin: 0,
  },
];

export function rhythmPresetById(id: string): RhythmPreset | undefined {
  return RHYTHM_PRESETS.find((p) => p.id === id);
}

export type RhythmPhase = "night" | "dawn" | "day" | "dusk";

export type RhythmTarget = {
  level: number; // the raw curve, 0 deep night .. 1 midday — for display too
  phase: RhythmPhase;
  kelvin: number;
  brightness: number | null; // null when the preset leaves brightness alone
  ember: Color | null; // non-null only in the low tail, for color-capable bulbs
};

// The day's anchor times, already shifted by the preset. clockOnly is true when
// there were no coordinates (or the sun math had no answer, e.g. polar seasons)
// and the anchors are just a reasonable clock-shaped day instead.
export type RhythmAnchors = {
  dawn: Date; // where the morning ramp starts (twilight + the preset's lag)
  sunrise: Date;
  noon: Date;
  sunset: Date;
  dusk: Date; // where the evening ramp finishes
  clockOnly: boolean;
};

const at = (day: Date, minutes: number): Date => {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d;
};
const shifted = (d: Date, min: number): Date => new Date(d.getTime() + min * 60_000);

export function rhythmAnchors(now: Date, coords: Coords | null, preset: RhythmPreset): RhythmAnchors {
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let dawn: Date | null = null;
  let dusk: Date | null = null;
  if (coords) {
    sunrise = sunTime(now, coords.lat, coords.lon, "sunrise");
    sunset = sunTime(now, coords.lat, coords.lon, "sunset");
    dawn = twilight(now, coords.lat, coords.lon, "dawn");
    dusk = twilight(now, coords.lat, coords.lon, "dusk");
  }
  const clockOnly = !sunrise || !sunset || sunset.getTime() <= sunrise.getTime();
  if (clockOnly) {
    // No location (or a polar season with no sunrise/sunset): a clock-shaped day.
    sunrise = at(now, 7 * 60 + 30);
    sunset = at(now, 19 * 60 + 30);
    dawn = at(now, 6 * 60 + 45);
    dusk = at(now, 20 * 60 + 15);
  } else {
    // White nights: sun rises and sets, but never dips 6° under — no true civil
    // twilight. Ease over a fixed shoulder instead.
    if (!dawn || dawn.getTime() >= sunrise!.getTime()) dawn = shifted(sunrise!, -40);
    if (!dusk || dusk.getTime() <= sunset!.getTime()) dusk = shifted(sunset!, 40);
  }
  const s = preset.shiftMin;
  const lagged = shifted(dawn!, s + preset.morningLagMin);
  const shiftedSunrise = shifted(sunrise!, s);
  return {
    dawn: lagged.getTime() < shiftedSunrise.getTime() ? lagged : shifted(shiftedSunrise, -5),
    sunrise: shiftedSunrise,
    noon: shifted(new Date((sunrise!.getTime() + sunset!.getTime()) / 2), s),
    sunset: shifted(sunset!, s),
    dusk: shifted(dusk!, s),
    clockOnly,
  };
}

const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, f: number) => a + (b - a) * f;

// Where the raw curve sits at `now`: 0 in the deep of night, 0.5 at the horizon
// moments, 1 at solar noon — with smooth shoulders through the twilights.
export function rhythmLevel(now: Date, a: RhythmAnchors): number {
  const t = now.getTime();
  const dawn = a.dawn.getTime();
  const rise = a.sunrise.getTime();
  const noon = a.noon.getTime();
  const set = a.sunset.getTime();
  const dusk = a.dusk.getTime();
  if (t <= dawn || t >= dusk) return 0;
  if (t < rise) return 0.5 * smooth((t - dawn) / (rise - dawn));
  if (t < noon) return 0.5 + 0.5 * smooth((t - rise) / (noon - rise));
  if (t < set) return 0.5 + 0.5 * smooth((set - t) / (set - noon));
  return 0.5 * smooth((dusk - t) / (dusk - set));
}

export function rhythmPhase(now: Date, a: RhythmAnchors): RhythmPhase {
  const t = now.getTime();
  if (t <= a.dawn.getTime() || t >= a.dusk.getTime()) return "night";
  if (t < a.sunrise.getTime()) return "dawn";
  if (t <= a.sunset.getTime()) return "day";
  return "dusk";
}

// The warm-white doorway the ember descent starts from — roughly what ~2000K
// looks like on a color bulb, so crossing from kelvin into color doesn't jump.
const EMBER_DOOR: Color = { r: 255, g: 185, b: 120 };

export function rhythmTarget(now: Date, coords: Coords | null, preset: RhythmPreset): RhythmTarget {
  const anchors = rhythmAnchors(now, coords, preset);
  const level = rhythmLevel(now, anchors);
  const phase = rhythmPhase(now, anchors);
  const kelvin = Math.round(mix(preset.nightKelvin, preset.dayKelvin, level));
  const brightness =
    preset.dayBrightness === null
      ? null
      : Math.max(1, Math.min(100, Math.round(mix(preset.nightBrightness, preset.dayBrightness, level))));
  let ember: Color | null = null;
  if (preset.ember && preset.emberLevel > 0 && level < preset.emberLevel) {
    const depth = 1 - level / preset.emberLevel; // 0 at the doorway → 1 deep in the night
    ember = {
      r: Math.round(mix(EMBER_DOOR.r, preset.ember.r, depth)),
      g: Math.round(mix(EMBER_DOOR.g, preset.ember.g, depth)),
      b: Math.round(mix(EMBER_DOOR.b, preset.ember.b, depth)),
    };
  }
  return { level, phase, kelvin, brightness, ember };
}
