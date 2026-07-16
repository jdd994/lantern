// adaptive.ts — the circadian white curve: what color temperature the room "should"
// be right now. Warm at the edges of the day, cool around solar noon. Pure and
// testable; the hook applies it on a timer to tunable-white bulbs.
import { sunTime } from "./sun";
import type { Coords } from "./automations";

const WARM = 2200; // deep-of-night / golden-hour warmth (K)
const COOL = 5200; // midday daylight (K)

export function adaptiveKelvin(now: Date, coords: Coords | null): number {
  // With coordinates, ride the actual sun: 0 at sunrise/sunset, peak at solar noon.
  if (coords) {
    const rise = sunTime(now, coords.lat, coords.lon, "sunrise");
    const set = sunTime(now, coords.lat, coords.lon, "sunset");
    if (rise && set && set.getTime() > rise.getTime()) {
      const t = now.getTime();
      if (t <= rise.getTime() || t >= set.getTime()) return WARM;
      const noon = (rise.getTime() + set.getTime()) / 2;
      const frac = 1 - Math.abs(t - noon) / (noon - rise.getTime()); // 0..1
      return Math.round(WARM + (COOL - WARM) * frac);
    }
  }
  // Fallback without location: a cosine peaking around 1pm local.
  const h = now.getHours() + now.getMinutes() / 60;
  const frac = Math.max(0, Math.cos(((h - 13) / 12) * Math.PI));
  return Math.round(WARM + (COOL - WARM) * frac);
}
