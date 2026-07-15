// connectors/govee.ts
// Govee, via its current cloud "platform" API (openapi.api.govee.com). The API
// sets CORS headers, so the browser calls it directly — no proxy. The user's key
// (from the Govee Home app → Settings → Apply for API Key) is the only credential.
// Everything here maps Govee's capability model to Aura's normalized LightState.

import type { Connector, Device, LightState } from "./index";
import { intToRgb, rgbToInt } from "../color";

const BASE = "https://openapi.api.govee.com/router/api/v1";

const CAP_ONOFF = "devices.capabilities.on_off";
const CAP_RANGE = "devices.capabilities.range";
const CAP_COLOR = "devices.capabilities.color_setting";

type GoveeCapability = { type: string; instance: string; state?: { value: unknown } };
type GoveeDevice = { sku: string; device: string; deviceName?: string; capabilities?: GoveeCapability[] };
type GoveeRaw = { sku: string; device: string };

async function call(cred: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Govee-API-Key": cred, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data?.code === "number" && data.code !== 200)) {
    throw new Error(data?.message || data?.msg || `Govee request failed (${res.status}).`);
  }
  return data;
}

export const govee: Connector = {
  id: "govee",
  label: "Govee",
  credLabel: "Govee API key",
  credHint:
    "In the Govee Home app: Settings → Apply for API Key. It arrives by email. Paste it here — it stays on this device.",

  async listDevices(cred) {
    const data = await call(cred, "/user/devices");
    const list: GoveeDevice[] = data?.data ?? [];
    return list.map((d): Device => {
      const caps = d.capabilities ?? [];
      return {
        id: `govee:${d.sku}:${d.device}`,
        name: d.deviceName || d.sku,
        sourceId: "govee",
        canBrightness: caps.some((c) => c.type === CAP_RANGE && c.instance === "brightness"),
        canColor: caps.some((c) => c.type === CAP_COLOR && c.instance === "colorRgb"),
        raw: { sku: d.sku, device: d.device } satisfies GoveeRaw,
      };
    });
  },

  async getState(cred, device) {
    const { sku, device: dev } = device.raw as GoveeRaw;
    const data = await call(cred, "/device/state", {
      requestId: crypto.randomUUID(),
      payload: { sku, device: dev },
    });
    const caps: GoveeCapability[] = data?.payload?.capabilities ?? [];
    const find = (type: string, instance: string) =>
      caps.find((c) => c.type === type && c.instance === instance)?.state?.value;

    const power = find(CAP_ONOFF, "powerSwitch");
    const brightness = find(CAP_RANGE, "brightness");
    const colorRgb = find(CAP_COLOR, "colorRgb");

    const state: LightState = { on: power === 1 || power === true };
    if (typeof brightness === "number") state.brightness = brightness;
    if (typeof colorRgb === "number") state.color = intToRgb(colorRgb);
    return state;
  },

  async setState(cred, device, patch) {
    const { sku, device: dev } = device.raw as GoveeRaw;
    // Govee controls one capability per call; apply each field present in the patch.
    const control = (type: string, instance: string, value: unknown) =>
      call(cred, "/device/control", {
        requestId: crypto.randomUUID(),
        payload: { sku, device: dev, capability: { type, instance, value } },
      });

    if (patch.on !== undefined) await control(CAP_ONOFF, "powerSwitch", patch.on ? 1 : 0);
    if (patch.brightness !== undefined) {
      await control(CAP_RANGE, "brightness", Math.max(0, Math.min(100, Math.round(patch.brightness))));
    }
    if (patch.color !== undefined) await control(CAP_COLOR, "colorRgb", rgbToInt(patch.color));
  },
};
