// apply.ts — pure "what should each light get" math, shared by the live UI
// (useAura) and the background keeper (lib/keeper.ts): resolve a vibe — built-in
// vocabulary or a custom one — against a home's devices and rooms into
// per-device patches. No IO, no state; both callers push the patches through
// their own transport.
import { vibeById } from "@lantern/core";
import { effectiveDeviceIds, type Room } from "./rooms";
import { paletteVariant } from "./palette";
import type { RhythmTarget } from "./rhythm";
import type { Color, Device, LightState } from "./connectors";
import type { CustomVibe } from "./db";

export function vibePatches(
  vibeId: string,
  roomId: string | undefined,
  devices: Device[],
  rooms: Room[],
  customVibes: CustomVibe[],
  brightnessScale = 1
): { deviceId: string; patch: Partial<LightState> }[] {
  const builtin = vibeById(vibeId);
  const custom = customVibes.find((c) => c.id === vibeId);
  const baseBrightness = builtin ? builtin.light.brightness : custom ? custom.brightness : null;
  const clamp = (b: number) => Math.max(1, Math.min(100, Math.round(b * brightnessScale)));
  const target: { brightness: number; rgb: Color; kelvin?: number } | null =
    baseBrightness === null
      ? null
      : builtin
        ? { brightness: clamp(baseBrightness), rgb: builtin.light.rgb, kelvin: builtin.light.kelvin }
        : custom
          ? { brightness: clamp(baseBrightness), rgb: custom.rgb }
          : null;
  if (!target) return [];
  const targetRoom = roomId ? rooms.find((r) => r.id === roomId) : undefined;
  const targetIds = roomId
    ? targetRoom
      ? effectiveDeviceIds(targetRoom, rooms)
      : []
    : devices.map((d) => d.id);
  // More than one light gets its own small, deterministic pull within the
  // vibe's palette (see palette.ts) — a room full of lamps at one identical
  // hue reads flat; the same warm family, slightly varied per fixture, reads
  // like a real room. A single light has nothing to vary against.
  const only = targetIds.length <= 1;
  const out: { deviceId: string; patch: Partial<LightState> }[] = [];
  for (const id of targetIds) {
    const device = devices.find((d) => d.id === id);
    if (!device) continue;
    const own = paletteVariant(target, device.id, only);
    const patch: Partial<LightState> = { on: true };
    if (device.canBrightness) patch.brightness = own.brightness;
    // Color bulbs take the vibe's hue; white-only bulbs take its temperature.
    if (device.canColor) patch.color = own.rgb;
    else if (device.canColorTemp && own.kelvin) patch.kelvin = own.kelvin;
    out.push({ deviceId: id, patch });
  }
  return out;
}

// What the day rhythm remembers about one device: the ember color and the
// brightness IT last set — how it tells its own work apart from yours. The
// caller owns a map of these (one per device) and hands the same object back
// each tick; this function reads and updates it.
export type RhythmMemory = { color?: Color; brightness?: number };

const sameColor = (a?: Color, b?: Color) => !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;

// One device's step along the rhythm curve. Returns the patch to push (or null
// for "leave it be"), keeping the rhythm's two promises: never turns a light
// on, and never paints over a color it didn't set itself. Shared by the live
// engine (useAura) and the background keeper so the promises can't drift apart.
export function rhythmStep(
  device: Device,
  st: LightState,
  target: RhythmTarget,
  mem: RhythmMemory
): Partial<LightState> | null {
  if (!st.on) {
    // An off light leaves the rhythm; turning it back on rejoins it fresh.
    delete mem.color;
    delete mem.brightness;
    return null;
  }
  const oursInColor = st.color !== undefined && sameColor(st.color, mem.color);
  if (st.color !== undefined && st.kelvin === undefined && !oursInColor) {
    delete mem.color; // a color you (or a vibe) chose — not the rhythm's to touch
    delete mem.brightness;
    return null;
  }
  const patch: Partial<LightState> = {};
  if (target.ember && device.canColor) {
    // The descent past white: kelvin has said all it can, color carries on.
    if (!sameColor(st.color, target.ember)) patch.color = target.ember;
    mem.color = target.ember;
  } else {
    if (device.canColorTemp) {
      const back = oursInColor; // dawn: climb back out of ember into white
      if (back || st.kelvin === undefined || Math.abs(st.kelvin - target.kelvin) >= 60) {
        patch.kelvin = target.kelvin;
      }
    }
    if (oursInColor) delete mem.color;
  }
  if (target.brightness !== null && device.canBrightness) {
    const cur = st.brightness ?? 100;
    // You moved the dimmer since the rhythm last did — that dial is yours now
    // (until the light cycles off and on again).
    const overridden = mem.brightness !== undefined && Math.abs(cur - mem.brightness) > 6;
    if (!overridden && Math.abs(cur - target.brightness) >= 3) {
      patch.brightness = target.brightness;
      mem.brightness = target.brightness;
    }
  }
  return Object.keys(patch).length ? patch : null;
}
