import { describe, expect, it } from "vitest";
import { actionsOf, dueAutomations, fireTimeOn, nextFire, ymd, type Automation } from "./automations";

const at = (h: number, m: number): Date => {
  const d = new Date(2021, 5, 1); // fixed local day
  d.setHours(h, m, 0, 0);
  return d;
};

const timeAuto = (minutes: number, over: Partial<Automation> = {}): Automation => ({
  id: "a",
  name: "test",
  enabled: true,
  trigger: { kind: "time", minutes },
  action: { kind: "allOff" },
  ...over,
});

describe("dueAutomations (time triggers)", () => {
  it("fires within the grace window after the trigger time", () => {
    const a = timeAuto(9 * 60); // 09:00
    expect(dueAutomations([a], at(9, 2), null)).toHaveLength(1); // 2 min after
    expect(dueAutomations([a], at(9, 20), null)).toHaveLength(0); // past grace
    expect(dueAutomations([a], at(8, 59), null)).toHaveLength(0); // before
  });

  it("does not fire when disabled or already run today", () => {
    expect(dueAutomations([timeAuto(9 * 60, { enabled: false })], at(9, 1), null)).toHaveLength(0);
    const ran = timeAuto(9 * 60, { lastRun: ymd(at(9, 1)) });
    expect(dueAutomations([ran], at(9, 1), null)).toHaveLength(0);
  });
});

describe("sun triggers", () => {
  const coords = { lat: 51.5074, lon: -0.1278 }; // London

  it("needs coords — a sun automation with none never fires and has no fire time", () => {
    const a: Automation = {
      id: "s",
      name: "sunset",
      enabled: true,
      trigger: { kind: "sun", event: "sunset", offsetMin: 0 },
      action: { kind: "allOff" },
    };
    expect(fireTimeOn(a, new Date(2021, 5, 1), null)).toBeNull();
    expect(dueAutomations([a], new Date(2021, 5, 1, 21, 0), null)).toHaveLength(0);
  });

  it("applies the offset (sunset − 15 min fires earlier than sunset)", () => {
    const day = new Date(2021, 5, 1);
    const base: Automation = {
      id: "s",
      name: "sunset",
      enabled: true,
      trigger: { kind: "sun", event: "sunset", offsetMin: 0 },
      action: { kind: "allOff" },
    };
    const early: Automation = { ...base, trigger: { kind: "sun", event: "sunset", offsetMin: -15 } };
    const t0 = fireTimeOn(base, day, coords)!;
    const t1 = fireTimeOn(early, day, coords)!;
    expect(t0.getTime() - t1.getTime()).toBe(15 * 60_000);
  });
});

describe("weekday filter + multi-action", () => {
  it("only fires on allowed weekdays (2021-06-01 is a Tuesday = day 2)", () => {
    const tue = timeAuto(9 * 60, { days: [2] });
    const monOnly = timeAuto(9 * 60, { days: [1] });
    expect(dueAutomations([tue], at(9, 1), null)).toHaveLength(1);
    expect(dueAutomations([monOnly], at(9, 1), null)).toHaveLength(0);
    expect(dueAutomations([timeAuto(9 * 60, { days: [] })], at(9, 1), null)).toHaveLength(1); // empty = every day
  });

  it("nextFire skips disallowed weekdays", () => {
    // On Tue 2021-06-01 08:00, a Wednesday-only 09:00 fires next day (the 2nd).
    const wed = timeAuto(9 * 60, { days: [3] });
    expect(nextFire(wed, at(8, 0), null)!.getDate()).toBe(2);
  });

  it("actionsOf reads new list, falls back to legacy single action", () => {
    expect(actionsOf(timeAuto(0, { actions: [{ kind: "allOff" }, { kind: "allOff" }] }))).toHaveLength(2);
    expect(actionsOf(timeAuto(0))).toEqual([{ kind: "allOff" }]); // legacy `action`
  });
});

describe("nextFire", () => {
  it("returns today's time when still ahead, else tomorrow", () => {
    const a = timeAuto(22 * 60); // 22:00
    const morning = nextFire(a, at(8, 0), null)!;
    expect(morning.getDate()).toBe(1); // later today
    const night = nextFire(a, at(23, 0), null)!;
    expect(night.getDate()).toBe(2); // rolled to tomorrow
  });
});
