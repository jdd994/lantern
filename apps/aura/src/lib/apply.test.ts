import { describe, expect, it } from "vitest";
import { easeFrame, easeStart } from "./apply";
import type { LightState } from "./connectors";

const target: Partial<LightState> = { on: true, brightness: 90, color: { r: 255, g: 250, b: 242 } };

describe("easeStart", () => {
  it("an off light starts dark, already in the vibe's hue", () => {
    const s = easeStart({ on: false, color: { r: 0, g: 0, b: 255 } }, target);
    expect(s.brightness).toBe(0);
    expect(s.color).toEqual(target.color);
  });

  it("an unknown light is treated as off", () => {
    expect(easeStart(undefined, target).brightness).toBe(0);
  });

  it("a lit light starts from its own brightness and color", () => {
    const s = easeStart({ on: true, brightness: 30, color: { r: 255, g: 80, b: 95 } }, target);
    expect(s).toEqual({ brightness: 30, color: { r: 255, g: 80, b: 95 }, kelvin: undefined });
  });

  it("a lit bulb in white mode jumps into color mode at the start", () => {
    const s = easeStart({ on: true, brightness: 50, kelvin: 2700 }, target);
    expect(s.color).toEqual(target.color);
    expect(s.kelvin).toBeUndefined();
  });

  it("a white-only target blends kelvin, from the bulb's own if it has one", () => {
    const white: Partial<LightState> = { on: true, brightness: 90, kelvin: 5000 };
    expect(easeStart({ on: true, kelvin: 2200 }, white).kelvin).toBe(2200);
    expect(easeStart({ on: true, color: { r: 1, g: 2, b: 3 } }, white).kelvin).toBe(5000);
  });
});

describe("easeFrame", () => {
  const start = { brightness: 0, color: { r: 255, g: 100, b: 0 } };

  it("walks brightness and color linearly, never saying on", () => {
    const mid = easeFrame(start, target, 0.5);
    expect(mid.on).toBeUndefined();
    expect(mid.brightness).toBe(45);
    expect(mid.color).toEqual({ r: 255, g: 175, b: 121 });
    expect(easeFrame(start, target, 1)).toEqual({ brightness: 90, color: target.color });
  });

  it("the first frame is lit at the floor, not brightness 0", () => {
    expect(easeFrame(start, target, 0).brightness).toBe(1);
  });

  it("clamps the fraction", () => {
    expect(easeFrame(start, target, 1.7)).toEqual(easeFrame(start, target, 1));
    expect(easeFrame(start, target, -1)).toEqual(easeFrame(start, target, 0));
  });

  it("blends kelvin for a white-only target and leaves color out", () => {
    const white: Partial<LightState> = { on: true, brightness: 20, kelvin: 2100 };
    const f = easeFrame({ brightness: 80, kelvin: 4100 }, white, 0.5);
    expect(f).toEqual({ brightness: 50, kelvin: 3100 });
  });

  it("only touches what the target names", () => {
    const f = easeFrame({ brightness: 10 }, { on: true, brightness: 40 }, 0.25);
    expect(f).toEqual({ brightness: 18 });
  });
});
