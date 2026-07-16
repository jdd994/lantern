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
  // How the credential is obtained, shown in the connect sheet.
  credLabel: string;
  credHint: string;
  // When false, the connect sheet skips the key field (e.g. the Demo room).
  needsCred?: boolean;
  // Optional pairing flow (e.g. Hue): find bridges on the network, then exchange a
  // link-button press for a credential. When present, the connect sheet shows a
  // pairing UI instead of a paste field.
  discover?(): Promise<string[]>;
  pair?(address: string): Promise<string>; // returns the credential to store
  listDevices(cred: string): Promise<Device[]>;
  getState(cred: string, device: Device): Promise<LightState>;
  setState(cred: string, device: Device, patch: Partial<LightState>): Promise<void>;
  // Optional: brands with motion/presence sensors implement these; the automation
  // engine polls them and fires on the moment motion starts.
  listSensors?(cred: string): Promise<Sensor[]>;
  readSensor?(cred: string, sensor: Sensor): Promise<SensorReading>;
};

import { govee } from "./govee";
import { demo } from "./demo";
import { hue } from "./hue";
import { isTauri } from "../platform";

// Philips Hue (local CLIP v2) is only offered in the Tauri shell — a browser PWA
// can't reach a LAN bridge (mixed-content/TLS/CORS), but native HTTP can. In the
// web build it's simply absent from the picker.
export const connectors: Connector[] = isTauri() ? [govee, demo, hue] : [govee, demo];

export function connectorFor(sourceId: string): Connector | undefined {
  return connectors.find((c) => c.id === sourceId);
}
