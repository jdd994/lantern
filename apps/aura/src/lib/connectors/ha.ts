// connectors/ha.ts — Home Assistant, via its REST API. Registered ONLY in the
// Tauri shell (see ./index.ts) for the same reason as Hue: a typical HA instance
// lives on the LAN over plain HTTP (or a self-signed cert), which a browser PWA
// can't reach — mixed-content/TLS/CORS all block it. Native HTTP under Tauri has
// none of those walls.
//
// Why this connector exists at all, when Aura already talks to brands directly:
// HA already aggregates almost everything — Zigbee, Z-Wave, Matter, and brands
// with no clean public API of their own (Cync, historically). Rather than Aura
// hand-writing a connector per vendor forever, pointing it at a user's own HA
// instance inherits that coverage for free. It's one more entry in the connect
// picker, not a replacement for Govee/Hue — someone with only a couple of Govee
// bulbs has no reason to run HA just for Aura.
//
// Credential is "<base-url>|<long-lived-token>": the URL of the user's HA instance
// (e.g. "http://homeassistant.local:8123") and a Long-Lived Access Token, which HA
// issues from a person's own profile page — there's no pairing handshake to
// automate, unlike Hue's link button.
//
// NOTE — motion/presence sensors: not implemented yet, deliberately, same call as
// Govee's. HA exposes them as binary_sensor entities with device_class "motion",
// which is well-documented, so this is lower-risk than Govee's case — just not
// verified against a real instance yet. To finish it: GET /api/states, filter
// entity_id starting "binary_sensor." with attributes.device_class === "motion",
// map state === "on" to SensorReading.motion.
import type { Connector, Device, LightState } from "./index";
import { httpFetch } from "../platform";

const COLOR_MODES = new Set(["hs", "rgb", "rgbw", "rgbww", "xy"]);

function parse(cred: string): { base: string; token: string } {
  const [url, token] = cred.split("|");
  if (!url || !token) throw new Error('Home Assistant credential must be "<base-url>|<long-lived-token>".');
  return { base: url.replace(/\/+$/, ""), token };
}

async function call(cred: string, path: string, init?: RequestInit): Promise<any> {
  const { base, token } = parse(cred);
  const res = await httpFetch(base + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Home Assistant request failed (${res.status}).`);
  return data;
}

function toDevice(entity: any): Device {
  const modes: string[] = entity.attributes?.supported_color_modes ?? [];
  return {
    id: `ha:${entity.entity_id}`,
    name: entity.attributes?.friendly_name || entity.entity_id,
    sourceId: "homeassistant",
    canBrightness: modes.some((m) => m !== "onoff"),
    canColor: modes.some((m) => COLOR_MODES.has(m)),
    canColorTemp: modes.includes("color_temp"),
    raw: { entityId: entity.entity_id },
  };
}

function toState(entity: any): LightState {
  const a = entity.attributes ?? {};
  const state: LightState = { on: entity.state === "on" };
  if (typeof a.brightness === "number") state.brightness = Math.round((a.brightness / 255) * 100);
  if (Array.isArray(a.rgb_color) && a.rgb_color.length === 3) {
    const [r, g, b] = a.rgb_color;
    state.color = { r, g, b };
  } else if (typeof a.color_temp_kelvin === "number") {
    state.kelvin = a.color_temp_kelvin;
  }
  return state;
}

export const homeAssistant: Connector = {
  id: "homeassistant",
  label: "Home Assistant",
  descriptor: {
    id: "homeassistant",
    label: "Home Assistant",
    tier: 1,
    discloses:
      "Aura talks directly to your own Home Assistant instance — typically your home network, though it depends on how you've set HA up. Through it, Aura can reach almost anything HA already integrates (Hue, Govee, Zigbee, Z-Wave, Matter, and more), governed entirely by what HA itself is configured to reach.",
    takes: ["A Long-Lived Access Token you generate in Home Assistant, stored on this device"],
    refuses: ["Never talks to any brand's cloud directly — only your own Home Assistant instance"],
  },
  credLabel: "Home Assistant URL + token",
  credHint: "From your HA profile (bottom left) → Security → Long-Lived Access Tokens → Create Token.",
  credFields: [
    { key: "url", label: "Home Assistant URL", placeholder: "http://homeassistant.local:8123" },
    { key: "token", label: "Long-lived access token", type: "password" },
  ],

  async listDevices(cred) {
    const states: any[] = await call(cred, "/api/states");
    return states.filter((e) => e.entity_id.startsWith("light.")).map(toDevice);
  },

  async getState(cred, device) {
    const { entityId } = device.raw as { entityId: string };
    const entity = await call(cred, `/api/states/${entityId}`);
    return toState(entity);
  },

  async setState(cred, device, patch, opts) {
    const { entityId } = device.raw as { entityId: string };
    if (patch.on === false) {
      await call(cred, "/api/services/light/turn_off", {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId }),
      });
      return;
    }
    const body: Record<string, unknown> = { entity_id: entityId };
    // HA fades natively via its own `transition` (seconds) — one call, no client-side ramp.
    if (opts?.transitionMs) body.transition = opts.transitionMs / 1000;
    if (patch.brightness !== undefined) {
      body.brightness = Math.max(0, Math.min(255, Math.round((patch.brightness / 100) * 255)));
    }
    if (patch.color !== undefined) body.rgb_color = [patch.color.r, patch.color.g, patch.color.b];
    if (patch.kelvin !== undefined) body.color_temp_kelvin = Math.round(patch.kelvin);
    await call(cred, "/api/services/light/turn_on", { method: "POST", body: JSON.stringify(body) });
  },
};
