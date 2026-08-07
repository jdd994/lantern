// connectors/ha.ts — Home Assistant, via its own REST API. Registered ONLY in the
// Tauri shell (see ./index.ts), for the same reason as Hue: a browser PWA can't
// reach a box on your LAN (mixed-content/TLS/CORS), but native HTTP can.
//
// Home Assistant is the "everything else" connector: one credential and Aura can
// see every light HA already knows about — Zigbee, Z-Wave, WiFi brands with no
// public API of their own. The trade is honest tier 1: commands go to YOUR
// server at the address YOU give, and nowhere else. Aura adds no cloud. (If the
// address you give is a remote one — say a Nabu Casa URL — that's the path your
// commands take; the descriptor says so plainly.)
//
// API notes, verified against a live instance (2026-07-21, HA stable):
//   • GET  /api/states                       — every entity; lights are "light.*"
//   • GET  /api/states/<entity_id>           — one entity's state + attributes
//   • POST /api/services/light/turn_on       — { entity_id, brightness_pct 0–100,
//         rgb_color [r,g,b], color_temp_kelvin, transition (SECONDS, fractional ok) }
//   • POST /api/services/light/turn_off      — { entity_id, transition }
//   • brightness attribute is 0–255 (we speak 0–100 and convert);
//     supported_color_modes tells capabilities; color_mode tells the current one.
import type { Connector, Device, LightState, Sensor } from "./index";
import { httpFetch } from "../platform";

type HaRaw = { entityId: string };

// The color modes that mean "this light can show a color" (HA also has onoff /
// brightness / color_temp / white, which don't).
const COLOR_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);

function parse(cred: string): { base: string; token: string } {
  const i = cred.indexOf("|");
  if (i < 1) throw new Error('Home Assistant credential must be "<url>|<token>".');
  let base = cred.slice(0, i).trim().replace(/\/+$/, "");
  const token = cred.slice(i + 1).trim();
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return { base, token };
}

async function call(cred: string, path: string, init?: RequestInit): Promise<any> {
  const { base, token } = parse(cred);
  const res = await httpFetch(`${base}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new Error(
      "Home Assistant didn't accept that token. Create a fresh long-lived token (Profile → Security) and try again."
    );
  }
  if (!res.ok) throw new Error(`Home Assistant request failed (${res.status}).`);
  return res.json().catch(() => null);
}

type HaEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
};

function toState(e: HaEntity): LightState {
  const a = e.attributes ?? {};
  const state: LightState = { on: e.state === "on" };
  if (typeof a.brightness === "number") {
    state.brightness = Math.round((a.brightness / 255) * 100);
  }
  // color_mode says what the light is DOING right now: white mode reports its
  // temperature, color mode its color. (HA derives rgb_color for every color
  // mode, so we never have to speak hs/xy/rgbww ourselves.)
  if (a.color_mode === "color_temp" && typeof a.color_temp_kelvin === "number") {
    state.kelvin = Math.round(a.color_temp_kelvin);
  } else if (Array.isArray(a.rgb_color) && a.rgb_color.length >= 3) {
    state.color = { r: a.rgb_color[0], g: a.rgb_color[1], b: a.rgb_color[2] };
  }
  return state;
}

export const homeAssistant: Connector = {
  id: "ha",
  label: "Home Assistant",
  descriptor: {
    id: "ha",
    label: "Home Assistant",
    tier: 1,
    discloses:
      "Aura talks straight to your own Home Assistant at the address you give it — usually a box on your shelf. Every light HA knows becomes a light here, and commands go to your server and nowhere else. If the address is a remote one, that's the path your commands take.",
    takes: ["Your Home Assistant's address and a long-lived access token, stored on this device"],
    refuses: [
      "Never talks to anyone but the Home Assistant you point it at — Aura adds no cloud of its own",
      "Never touches entities beyond lights and motion sensors: no cameras, no locks, no history",
    ],
  },
  credLabel: "Address + token",
  credHint:
    "The token lets Aura talk to your Home Assistant the way its own app does — it stays on this device.",
  credFields: [
    {
      key: "url",
      label: "Home Assistant address",
      placeholder: "http://homeassistant.local:8123",
      hint: "The address you open in your browser.",
    },
    {
      key: "token",
      label: "Long-lived access token",
      type: "password",
      hint: "In Home Assistant: Profile → Security → Long-lived access tokens → Create token.",
    },
  ],

  async listDevices(cred) {
    const states: HaEntity[] = (await call(cred, "/states")) ?? [];
    return states
      .filter((e) => e.entity_id.startsWith("light."))
      .map((e): Device => {
        const modes: string[] = Array.isArray(e.attributes?.supported_color_modes)
          ? e.attributes.supported_color_modes
          : [];
        return {
          id: `ha:${e.entity_id}`,
          name: e.attributes?.friendly_name || e.entity_id,
          sourceId: "ha",
          canBrightness: modes.some((m) => m !== "onoff"),
          canColor: modes.some((m) => COLOR_MODES.has(m)),
          canColorTemp: modes.includes("color_temp"),
          raw: { entityId: e.entity_id } satisfies HaRaw,
        };
      });
  },

  async getState(cred, device) {
    const { entityId } = device.raw as HaRaw;
    const e: HaEntity = await call(cred, `/states/${entityId}`);
    return toState(e);
  },

  async setState(cred, device, patch, opts) {
    const { entityId } = device.raw as HaRaw;
    // HA fades natively — `transition` is in seconds, fractional allowed.
    const transition = opts?.transitionMs !== undefined ? Math.max(0, opts.transitionMs / 1000) : undefined;
    if (patch.on === false) {
      await call(cred, "/services/light/turn_off", {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId, ...(transition !== undefined ? { transition } : {}) }),
      });
      return;
    }
    // Everything else is turn_on: HA adjusts brightness/color through the same
    // service, turning the light on if it was off (that's HA's own semantics —
    // the alternative would be a second round-trip to check state first).
    const body: Record<string, unknown> = { entity_id: entityId };
    if (transition !== undefined) body.transition = transition;
    if (patch.brightness !== undefined) {
      body.brightness_pct = Math.max(0, Math.min(100, Math.round(patch.brightness)));
    }
    if (patch.color !== undefined) body.rgb_color = [patch.color.r, patch.color.g, patch.color.b];
    if (patch.kelvin !== undefined) body.color_temp_kelvin = Math.round(patch.kelvin);
    await call(cred, "/services/light/turn_on", { method: "POST", body: JSON.stringify(body) });
  },

  // Motion for the automation engine: HA models motion/occupancy/presence as
  // binary_sensors wearing a device_class. We take those three and nothing else
  // — the "no entities beyond lights and motion" refusal is kept right here.
  async listSensors(cred) {
    const states: HaEntity[] = (await call(cred, "/states")) ?? [];
    return states
      .filter(
        (e) =>
          e.entity_id.startsWith("binary_sensor.") &&
          ["motion", "occupancy", "presence"].includes(e.attributes?.device_class)
      )
      .map(
        (e): Sensor => ({
          id: `ha:sensor:${e.entity_id}`,
          name: e.attributes?.friendly_name || e.entity_id,
          sourceId: "ha",
          raw: { entityId: e.entity_id } satisfies HaRaw,
        })
      );
  },

  async readSensor(cred, sensor) {
    const { entityId } = sensor.raw as HaRaw;
    const e: HaEntity = await call(cred, `/states/${entityId}`);
    return { motion: e.state === "on" };
  },
};
