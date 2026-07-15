// connectors/demo.ts — a Demo room. Four make-believe lights that live in memory,
// so you can feel the whole app — dim, recolor, save a scene, recall it — without
// owning a single bulb or typing a key. On-brand for a calm app: try it before you
// wire up real hardware (or on a plane, away from home). State resets on reload;
// scenes you save still persist and still apply, because the device ids are fixed.
import type { Connector, Device, LightState } from "./index";

const mk = (slug: string, name: string, canColor: boolean): Device => ({
  id: `demo:${slug}`,
  name,
  sourceId: "demo",
  canBrightness: true,
  canColor,
  raw: { slug },
});

const SEED: { device: Device; state: LightState }[] = [
  { device: mk("reading-lamp", "Reading lamp", true), state: { on: true, brightness: 55, color: { r: 231, g: 183, b: 90 } } },
  { device: mk("desk-strip", "Desk strip", true), state: { on: false, brightness: 100, color: { r: 120, g: 170, b: 255 } } },
  { device: mk("ceiling", "Ceiling", false), state: { on: true, brightness: 80 } },
  { device: mk("candle", "Candle", true), state: { on: true, brightness: 22, color: { r: 255, g: 120, b: 40 } } },
];

// Live state, seeded fresh each page load.
const states = new Map<string, LightState>(SEED.map((s) => [s.device.id, { ...s.state }]));

// A touch of latency so it feels like reaching a real bulb.
const settle = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 90));

export const demo: Connector = {
  id: "demo",
  label: "Demo room",
  credLabel: "",
  credHint: "",
  needsCred: false,

  async listDevices() {
    return settle(SEED.map((s) => s.device));
  },

  async getState(_cred, device) {
    return settle({ ...(states.get(device.id) ?? { on: false }) });
  },

  async setState(_cred, device, patch) {
    const cur = states.get(device.id) ?? { on: false };
    states.set(device.id, { ...cur, ...patch });
    await settle(null);
  },
};
