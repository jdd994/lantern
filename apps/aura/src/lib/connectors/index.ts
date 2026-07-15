// connectors/index.ts
// The brand-agnostic light-control interface. Each brand (Govee now, Hue next)
// implements a Connector; the rest of Aura only ever sees a normalized Device +
// LightState and never a brand's API shape. Modeled on Ballast's connectorFor().

export type Color = { r: number; g: number; b: number };

// A light's state, normalized across brands. brightness is 0–100.
export type LightState = {
  on: boolean;
  brightness?: number;
  color?: Color;
};

export type Device = {
  id: string; // stable id within its source
  name: string;
  sourceId: string; // which brand/source this belongs to
  canBrightness: boolean;
  canColor: boolean;
  // Brand-specific handle the connector needs to control it — opaque to the app.
  raw: unknown;
};

export type Connector = {
  id: string;
  label: string;
  // How the credential is obtained, shown in the connect sheet.
  credLabel: string;
  credHint: string;
  // When false, the connect sheet skips the key field (e.g. the Demo room).
  needsCred?: boolean;
  listDevices(cred: string): Promise<Device[]>;
  getState(cred: string, device: Device): Promise<LightState>;
  setState(cred: string, device: Device, patch: Partial<LightState>): Promise<void>;
};

import { govee } from "./govee";
import { demo } from "./demo";

export const connectors: Connector[] = [govee, demo];

export function connectorFor(sourceId: string): Connector | undefined {
  return connectors.find((c) => c.id === sourceId);
}
