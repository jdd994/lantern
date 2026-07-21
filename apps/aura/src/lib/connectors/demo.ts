// connectors/demo.ts — a Demo room. Four make-believe lights that live in memory,
// so you can feel the whole app — dim, recolor, save a scene, recall it — without
// owning a single bulb or typing a key. On-brand for a calm app: try it before you
// wire up real hardware (or on a plane, away from home). State resets on reload;
// scenes you save still persist and still apply, because the device ids are fixed.
import type { Connector, Device, LightState, Sensor } from "./index";

const mk = (slug: string, name: string, canColor: boolean, canColorTemp = false): Device => ({
  id: `demo:${slug}`,
  name,
  sourceId: "demo",
  canBrightness: true,
  canColor,
  canColorTemp,
  raw: { slug },
});

const SEED: { device: Device; state: LightState }[] = [
  { device: mk("reading-lamp", "Reading lamp", true, true), state: { on: true, brightness: 55, color: { r: 231, g: 183, b: 90 } } },
  { device: mk("desk-strip", "Desk strip", true), state: { on: false, brightness: 100, color: { r: 120, g: 170, b: 255 } } },
  { device: mk("ceiling", "Ceiling", false, true), state: { on: true, brightness: 80, kelvin: 3500 } },
  { device: mk("candle", "Candle", true, true), state: { on: true, brightness: 22, color: { r: 255, g: 120, b: 40 } } },
];

// Live state, seeded fresh each page load.
const states = new Map<string, LightState>(SEED.map((s) => [s.device.id, { ...s.state }]));

// A touch of latency so it feels like reaching a real bulb.
const settle = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 90));

// A make-believe motion sensor, so sensor automations can be built and felt with no
// hardware. simulateDemoMotion() makes it "see" motion for a few seconds — long
// enough for the poller to catch the edge.
const DEMO_SENSOR: Sensor = { id: "demo:hall-motion", name: "Hallway motion (demo)", sourceId: "demo", raw: {} };
let motionUntil = 0;
export function simulateDemoMotion(): void {
  motionUntil = Date.now() + 8000;
}

export const demo: Connector = {
  id: "demo",
  label: "Demo room",
  descriptor: {
    id: "demo",
    label: "Demo room",
    tier: 0,
    discloses: "Four make-believe lights that live only in this browser tab. Nothing is sent anywhere.",
    takes: [],
    refuses: ["Never touches the network — there's no real hardware to talk to"],
  },
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

  async listSensors() {
    return settle([DEMO_SENSOR]);
  },

  async readSensor() {
    return { motion: Date.now() < motionUntil };
  },
};
