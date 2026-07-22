// connectors/index.ts
// The brand-agnostic light-control interface. Each brand (Govee now, Hue next)
// implements a Connector; the rest of Aura only ever sees a normalized Device +
// LightState and never a brand's API shape. Modeled on Ballast's connectorFor().

export type Color = { r: number; g: number; b: number };

// A light's state, normalized across brands. brightness is 0–100; kelvin is a white
// color temperature (~2000 warm … 6500 cool). color and kelvin are mutually
// exclusive on a bulb — setting one is what the light is doing.
export type LightState = {
  on: boolean;
  brightness?: number;
  color?: Color;
  kelvin?: number;
};

export type Device = {
  id: string; // stable id within its source
  name: string;
  sourceId: string; // which brand/source this belongs to
  canBrightness: boolean;
  canColor: boolean;
  canColorTemp: boolean;
  // Brand-specific handle the connector needs to control it — opaque to the app.
  raw: unknown;
};

// A sensor, normalized across brands (motion/presence for now). Like devices, the
// app never sees a brand's API shape — just this.
export type Sensor = {
  id: string;
  name: string;
  sourceId: string;
  raw: unknown;
};

export type SensorReading = { motion: boolean };

export type Connector = {
  id: string;
  label: string;
  // The shared family consent contract (tier + who-learns-what), so picking a
  // brand is an informed choice up front — not a credential field that happens
  // to have a brand name over it. See @lantern/core/connect.
  descriptor: ProviderDescriptor;
  // How the credential is obtained, shown in the connect sheet.
  credLabel: string;
  credHint: string;
  // When a connector needs more than one piece of information (e.g. Home
  // Assistant's URL + token) and has no pairing handshake to walk through
  // instead, it lists its fields here; the connect sheet renders one input per
  // field and joins the values with "|" into the single cred string every
  // connector's methods receive — so a connector with credFields still only
  // ever has to parse one delimited string, same as one without.
  credFields?: { key: string; label: string; hint?: string; placeholder?: string; type?: "text" | "password" }[];
  // When false, the connect sheet skips the key field (e.g. the Demo room).
  needsCred?: boolean;
  // Optional pairing flow (e.g. Hue): find bridges on the network, then exchange a
  // link-button press for a credential. When present, the connect sheet shows a
  // pairing UI instead of a paste field.
  discover?(): Promise<string[]>;
  pair?(address: string): Promise<string>; // returns the credential to store
  listDevices(cred: string): Promise<Device[]>;
  getState(cred: string, device: Device): Promise<LightState>;
  // opts.transitionMs asks for a gentle fade *where the brand supports it natively*
  // (Hue does; Govee doesn't and simply snaps). We never emulate it client-side —
  // that would mean a burst of calls per light straight into a rate limit.
  setState(
    cred: string,
    device: Device,
    patch: Partial<LightState>,
    opts?: { transitionMs?: number }
  ): Promise<void>;
  // Optional: brands with motion/presence sensors implement these; the automation
  // engine polls them and fires on the moment motion starts.
  listSensors?(cred: string): Promise<Sensor[]>;
  readSensor?(cred: string, sensor: Sensor): Promise<SensorReading>;
};

import { govee } from "./govee";
import { demo } from "./demo";
import { hue } from "./hue";
import { homeAssistant } from "./ha";
import { isTauri } from "../platform";
import type { ProviderDescriptor, Tier } from "@lantern/core/connect";

// Philips Hue (local CLIP v2) and Home Assistant are only offered in the Tauri
// shell — a browser PWA can't reach a LAN device (mixed-content/TLS/CORS), but
// native HTTP can. In the web build they're simply absent from the picker.
export const connectors: Connector[] = isTauri() ? [govee, demo, hue, homeAssistant] : [govee, demo];

export function connectorFor(sourceId: string): Connector | undefined {
  return connectors.find((c) => c.id === sourceId);
}

// Aura's own wording for the family trust rungs — rendered wherever a tier
// badge appears (connect sheet, capability ledger). The words stay with the
// app; only the rungs are shared.
export function tierWording(tier: Tier): string {
  switch (tier) {
    case 0: return "Nothing leaves this device";
    case 1: return "Local network only";
    case 2: return "Direct to the brand";
    default: return "Via a third party";
  }
}
