// connectors/hue.ts — Philips Hue, via the LOCAL bridge (CLIP v2). Registered ONLY
// in the Tauri shell (see ./index.ts): requests go through platform.httpFetch, which
// under Tauri uses native HTTP and so can reach a LAN bridge. In a plain browser this
// connector isn't offered, because the browser can't reach it at all. Here's why.
//
// Hue has two APIs:
//   • Local bridge (this file): https://<bridge-ip>/clip/v2 with an application key
//     you get by pressing the bridge's link button. Fast, private, no cloud — the
//     gold standard, and the on-brand choice (commands never leave the house).
//   • Cloud "Remote API": OAuth2 with an app registered on Hue's developer portal
//     (client id/secret + redirect). Heavier, and needs a backend to hold the
//     secret — doesn't fit Aura's "paste one credential" model.
//
// The catch for local: a browser PWA served over https CANNOT reach a bridge on the
// LAN — the bridge presents a self-signed cert on a private IP, so mixed-content +
// TLS + CORS all block it. That's exactly what the Tauri shell fixes (native HTTP,
// no browser origin rules). So Hue-local turns on when Aura ships as Tauri; until
// then wiring it into the PWA would just present a connector that can't connect.
//
// When enabling: register in ./index.ts, add the bridge origin to the CSP (Tauri
// uses its own scheme, not the web CSP), and provide a bridge-discovery + link-button
// pairing step to obtain { ip, applicationKey }. Credential format here is
// "<bridge-ip>|<application-key>".
import type { Connector, Device, LightState } from "./index";
import type { Color } from "./index";
import { httpFetch } from "../platform";

type HueRaw = { rid: string };
type HueXY = { x: number; y: number };

// ---- CIE xy <-> sRGB (Philips "Wide RGB D65" gamut), approximate ----------
// Hue expresses color as CIE xy; the UI speaks sRGB. Good enough for setting a
// vibe; not a color-managed round-trip.
function rgbToXy(c: Color): HueXY {
  const g = (v: number) => {
    const n = v / 255;
    return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92;
  };
  const r = g(c.r);
  const gr = g(c.g);
  const b = g(c.b);
  const X = r * 0.4124 + gr * 0.3576 + b * 0.1805;
  const Y = r * 0.2126 + gr * 0.7152 + b * 0.0722;
  const Z = r * 0.0193 + gr * 0.1192 + b * 0.9505;
  const sum = X + Y + Z;
  return sum === 0 ? { x: 0, y: 0 } : { x: X / sum, y: Y / sum };
}

function xyToRgb(xy: HueXY, brightnessPct = 100): Color {
  const Y = brightnessPct / 100;
  const x = xy.x || 0.3127;
  const y = xy.y || 0.329;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  const r = X * 1.6564 + Y * -0.5766 + Z * -0.2521;
  const g = X * -0.7297 + Y * 1.4753 + Z * 0.0252;
  const b = X * 0.0343 + Y * -0.0447 + Z * 1.0148;
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(gamma(Math.max(0, v)) * 255)));
  return { r: to255(r), g: to255(g), b: to255(b) };
}

function parse(cred: string): { base: string; key: string } {
  const [ip, key] = cred.split("|");
  if (!ip || !key) throw new Error('Hue credential must be "<bridge-ip>|<application-key>".');
  return { base: `https://${ip}/clip/v2`, key };
}

async function call(cred: string, path: string, init?: RequestInit): Promise<any> {
  const { base, key } = parse(cred);
  const res = await httpFetch(base + path, {
    ...init,
    headers: { "hue-application-key": key, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (Array.isArray(data?.errors) && data.errors.length)) {
    throw new Error(data?.errors?.[0]?.description || `Hue request failed (${res.status}).`);
  }
  return data;
}

export const hue: Connector = {
  id: "hue",
  label: "Philips Hue",
  credLabel: "Bridge address + key",
  credHint: '"<bridge-ip>|<application-key>" — from pressing the bridge link button.',

  // Ask Hue's discovery service which bridges are on this network. Returns their LAN
  // IPs (best-effort; the user can always type one in).
  async discover() {
    try {
      const res = await httpFetch("https://discovery.meethue.com/");
      const list = await res.json();
      return Array.isArray(list) ? list.map((b: any) => b.internalipaddress).filter(Boolean) : [];
    } catch {
      return [];
    }
  },

  // Exchange a link-button press for an application key. The user presses the round
  // button on the bridge, then we POST to the (v1) /api endpoint; the bridge answers
  // with a username we use as the CLIP v2 application key.
  async pair(address) {
    const res = await httpFetch(`https://${address}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devicetype: "aura#desktop" }),
    });
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : data;
    if (first?.error) {
      throw new Error(first.error.description || "Press the bridge's link button, then try again.");
    }
    const username = first?.success?.username;
    if (!username) throw new Error("Pairing failed — press the link button and try again.");
    return `${address}|${username}`;
  },

  async listDevices(cred) {
    const data = await call(cred, "/resource/light");
    const lights: any[] = data?.data ?? [];
    return lights.map(
      (l): Device => ({
        id: `hue:${l.id}`,
        name: l.metadata?.name || "Hue light",
        sourceId: "hue",
        canBrightness: !!l.dimming,
        canColor: !!l.color,
        canColorTemp: !!l.color_temperature,
        raw: { rid: l.id } satisfies HueRaw,
      })
    );
  },

  async getState(cred, device) {
    const { rid } = device.raw as HueRaw;
    const data = await call(cred, `/resource/light/${rid}`);
    const l = data?.data?.[0] ?? {};
    const state: LightState = { on: !!l.on?.on };
    if (typeof l.dimming?.brightness === "number") state.brightness = l.dimming.brightness;
    // Hue reports color temperature as "mirek" (micro-reciprocal kelvin). When it's
    // valid the light is in white mode; otherwise report its xy color.
    if (l.color_temperature?.mirek_valid && typeof l.color_temperature.mirek === "number") {
      state.kelvin = Math.round(1e6 / l.color_temperature.mirek);
    } else if (l.color?.xy) {
      state.color = xyToRgb(l.color.xy, l.dimming?.brightness ?? 100);
    }
    return state;
  },

  async setState(cred, device, patch) {
    const { rid } = device.raw as HueRaw;
    const body: Record<string, unknown> = {};
    if (patch.on !== undefined) body.on = { on: patch.on };
    if (patch.brightness !== undefined) {
      body.dimming = { brightness: Math.max(0, Math.min(100, Math.round(patch.brightness))) };
    }
    if (patch.color !== undefined) body.color = { xy: rgbToXy(patch.color) };
    if (patch.kelvin !== undefined) {
      // mirek is 1e6/kelvin, clamped to Hue's 153–500 range (~6535K–2000K).
      body.color_temperature = { mirek: Math.max(153, Math.min(500, Math.round(1e6 / patch.kelvin))) };
    }
    await call(cred, `/resource/light/${rid}`, { method: "PUT", body: JSON.stringify(body) });
  },
};
