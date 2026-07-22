// The Home Assistant connector's promises, pinned. The descriptor says Aura
// never touches entities beyond lights and motion sensors — these tests are
// where that refusal is kept, the same way Ballast pins its takes/refuses.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { url: string; init?: RequestInit }[] = [];
let respond: (url: string) => unknown = () => [];

vi.mock("../platform", () => ({
  isTauri: () => false,
  httpFetch: async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => respond(url),
    } as Response;
  },
}));

import { homeAssistant } from "./ha";

const CRED = "http://ha.local:8123|token-abc";

const entity = (id: string, state: string, attributes: Record<string, unknown> = {}) => ({
  entity_id: id,
  state,
  attributes,
});

beforeEach(() => {
  calls.length = 0;
  respond = () => [];
});

describe("credential parsing", () => {
  it("hits /api under the given base, bearer token attached", async () => {
    await homeAssistant.listDevices(CRED);
    expect(calls[0].url).toBe("http://ha.local:8123/api/states");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
  });

  it("tolerates a trailing slash and a missing scheme", async () => {
    await homeAssistant.listDevices("ha.local:8123/|tok");
    expect(calls[0].url).toBe("http://ha.local:8123/api/states");
  });

  it("refuses a credential without both halves", async () => {
    await expect(homeAssistant.listDevices("just-a-token")).rejects.toThrow(/url.*token/i);
  });
});

describe("listDevices", () => {
  it("takes lights and ONLY lights — the refusal, kept", async () => {
    respond = () => [
      entity("light.bed", "off", { supported_color_modes: ["color_temp", "hs"], friendly_name: "Bed" }),
      entity("camera.front_door", "idle"),
      entity("lock.front_door", "locked"),
      entity("switch.heater", "on"),
      entity("media_player.tv", "off"),
    ];
    const devices = await homeAssistant.listDevices(CRED);
    expect(devices.map((d) => d.id)).toEqual(["ha:light.bed"]);
  });

  it("reads capabilities from supported_color_modes", async () => {
    respond = () => [
      entity("light.a", "on", { supported_color_modes: ["color_temp", "hs"] }),
      entity("light.b", "on", { supported_color_modes: ["rgbww"] }),
      entity("light.c", "on", { supported_color_modes: ["brightness"] }),
      entity("light.d", "on", { supported_color_modes: ["onoff"] }),
    ];
    const [a, b, c, d] = await homeAssistant.listDevices(CRED);
    expect([a.canBrightness, a.canColor, a.canColorTemp]).toEqual([true, true, true]);
    expect([b.canBrightness, b.canColor, b.canColorTemp]).toEqual([true, true, false]);
    expect([c.canBrightness, c.canColor, c.canColorTemp]).toEqual([true, false, false]);
    expect([d.canBrightness, d.canColor, d.canColorTemp]).toEqual([false, false, false]);
  });
});

describe("getState", () => {
  const device = { raw: { entityId: "light.bed" } } as Parameters<typeof homeAssistant.getState>[1];

  it("converts brightness 0–255 → 0–100", async () => {
    respond = () => entity("light.bed", "on", { brightness: 180, color_mode: "hs", rgb_color: [255, 128, 0] });
    const s = await homeAssistant.getState(CRED, device);
    expect(s).toEqual({ on: true, brightness: 71, color: { r: 255, g: 128, b: 0 } });
  });

  it("reports kelvin in white mode, color otherwise", async () => {
    respond = () =>
      entity("light.bed", "on", {
        brightness: 255,
        color_mode: "color_temp",
        color_temp_kelvin: 2700,
        rgb_color: [255, 200, 150],
      });
    const s = await homeAssistant.getState(CRED, device);
    expect(s.kelvin).toBe(2700);
    expect(s.color).toBeUndefined();
  });
});

describe("setState", () => {
  const device = { raw: { entityId: "light.bed" } } as Parameters<typeof homeAssistant.setState>[1];
  const body = () => JSON.parse(String(calls[0].init?.body));

  it("speaks brightness_pct, rgb_color, and kelvin through turn_on", async () => {
    await homeAssistant.setState(CRED, device, { brightness: 71, color: { r: 1, g: 2, b: 3 } });
    expect(calls[0].url).toContain("/api/services/light/turn_on");
    expect(body()).toEqual({ entity_id: "light.bed", brightness_pct: 71, rgb_color: [1, 2, 3] });
  });

  it("turns off through turn_off, carrying the fade", async () => {
    await homeAssistant.setState(CRED, device, { on: false }, { transitionMs: 1500 });
    expect(calls[0].url).toContain("/api/services/light/turn_off");
    expect(body()).toEqual({ entity_id: "light.bed", transition: 1.5 });
  });

  it("converts transitionMs → seconds on turn_on too", async () => {
    await homeAssistant.setState(CRED, device, { kelvin: 2700 }, { transitionMs: 400 });
    expect(body()).toEqual({ entity_id: "light.bed", transition: 0.4, color_temp_kelvin: 2700 });
  });
});

describe("sensors", () => {
  it("takes motion/occupancy/presence and nothing else — the refusal, kept", async () => {
    respond = () => [
      entity("binary_sensor.backyard", "on", { device_class: "motion", friendly_name: "Backyard" }),
      entity("binary_sensor.hall", "off", { device_class: "occupancy" }),
      entity("binary_sensor.basement_wet", "on", { device_class: "moisture" }),
      entity("binary_sensor.door", "on", { device_class: "door" }),
      entity("camera.yard", "recording"),
    ];
    const sensors = await homeAssistant.listSensors!(CRED);
    expect(sensors.map((s) => s.id)).toEqual(["ha:sensor:binary_sensor.backyard", "ha:sensor:binary_sensor.hall"]);
  });

  it("reads motion as state === on", async () => {
    respond = () => entity("binary_sensor.backyard", "on", { device_class: "motion" });
    const sensor = { raw: { entityId: "binary_sensor.backyard" } } as Parameters<
      NonNullable<typeof homeAssistant.readSensor>
    >[1];
    expect(await homeAssistant.readSensor!(CRED, sensor)).toEqual({ motion: true });
  });
});

describe("the descriptor's word", () => {
  it("is tier 1 and says where commands go", () => {
    expect(homeAssistant.descriptor.tier).toBe(1);
    expect(homeAssistant.descriptor.discloses).toMatch(/your own Home Assistant/i);
    expect(homeAssistant.descriptor.refuses.join(" ")).toMatch(/no cameras, no locks, no history/i);
  });
});
