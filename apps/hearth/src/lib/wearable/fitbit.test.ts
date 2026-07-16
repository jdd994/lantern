import { describe, expect, it } from "vitest";
import { importKeyRaw } from "../crypto";
import { stableId } from "./index";
import {
  REFUSED_FIELDS, mapFat, mapRestingHR, mapSleep, mapSteps, mapWeight, ymd,
} from "./fitbit";

describe("mapWeight", () => {
  it("takes the weight in kg at the logged time, and never the BMI", () => {
    const r = mapWeight({
      weight: [{ logId: 111, date: "2026-07-14", time: "08:12:00", weight: 80.4, bmi: 24.9, source: "API" }],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "weight", value: 80.4, unit: "kg" });
    expect(new Date(r[0].at).getHours()).toBe(8);
    // The verdict rode along in the payload and did not survive the mapping.
    expect(JSON.stringify(r)).not.toContain("24.9");
  });

  it("skips rows with no usable number", () => {
    expect(mapWeight({ weight: [{ date: "2026-07-14", weight: 0 }, { weight: 70 }] })).toEqual([]);
  });

  it("survives a shape it didn't expect", () => {
    expect(mapWeight({})).toEqual([]);
    expect(mapWeight(null)).toEqual([]);
  });
});

describe("mapFat", () => {
  it("maps body fat percent", () => {
    const r = mapFat({ fat: [{ logId: 9, date: "2026-07-14", time: "08:12:00", fat: 18.2 }] });
    expect(r[0]).toMatchObject({ kind: "bodyfat", value: 18.2, unit: "%" });
  });
});

describe("mapSleep", () => {
  it("converts minutes asleep to hours and drops Fitbit's efficiency grade", () => {
    const r = mapSleep({
      sleep: [{ logId: 5, dateOfSleep: "2026-07-15", minutesAsleep: 450, efficiency: 93, isMainSleep: true }],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "sleep", value: 7.5, unit: "h" });
    expect(JSON.stringify(r)).not.toContain("93");
  });

  it("ignores naps, so the trend is night-to-night", () => {
    const r = mapSleep({
      sleep: [
        { dateOfSleep: "2026-07-15", minutesAsleep: 450, isMainSleep: true },
        { dateOfSleep: "2026-07-15", minutesAsleep: 22, isMainSleep: false },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe(7.5);
  });
});

describe("mapRestingHR", () => {
  it("takes resting heart rate and leaves the zones behind", () => {
    const r = mapRestingHR({
      "activities-heart": [{
        dateTime: "2026-07-15",
        value: { restingHeartRate: 54, heartRateZones: [{ name: "Fat Burn", minutes: 30 }] },
      }],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "restingHR", value: 54, unit: "bpm" });
    expect(JSON.stringify(r)).not.toContain("Fat Burn");
  });

  it("skips days Fitbit has no resting rate for", () => {
    expect(mapRestingHR({ "activities-heart": [{ dateTime: "2026-07-15", value: {} }] })).toEqual([]);
  });
});

describe("mapSteps", () => {
  it("parses the string count Fitbit sends", () => {
    const r = mapSteps({ "activities-steps": [{ dateTime: "2026-07-15", value: "8432" }] });
    expect(r[0]).toMatchObject({ kind: "steps", value: 8432, unit: "steps" });
  });

  it("skips zero-step days rather than drawing a false floor", () => {
    // A 0 here means the band wasn't worn, not that someone never stood up.
    expect(mapSteps({ "activities-steps": [{ dateTime: "2026-07-15", value: "0" }] })).toEqual([]);
  });
});

describe("what we refuse", () => {
  // The guardrail as an executable claim: hand every mapper a payload stuffed
  // with the numbers Fitbit would love us to show, and prove none reach a Reading.
  it("never emits calories, scores, BMI or zones from a fully-loaded payload", () => {
    const readings = [
      ...mapWeight({ weight: [{ logId: 1, date: "2026-07-14", time: "08:00:00", weight: 80, bmi: 24.9 }] }),
      ...mapSleep({ sleep: [{ logId: 2, dateOfSleep: "2026-07-14", minutesAsleep: 400, efficiency: 88, isMainSleep: true }] }),
      ...mapRestingHR({ "activities-heart": [{ dateTime: "2026-07-14", value: { restingHeartRate: 55, caloriesOut: 2400, heartRateZones: [{ name: "Peak" }] } }] }),
      ...mapSteps({ "activities-steps": [{ dateTime: "2026-07-14", value: "9000", calories: 2400 }] }),
    ];
    const seen = new Set(readings.flatMap((r) => Object.keys(r)));
    for (const field of REFUSED_FIELDS) expect(seen.has(field)).toBe(false);
    // Readings carry a measurement and nothing else.
    expect([...seen].sort()).toEqual(["at", "kind", "natural", "unit", "value"]);
  });
});

describe("ymd", () => {
  it("uses the local day, because Fitbit's days are the wearer's days", () => {
    expect(ymd(new Date(2026, 6, 4, 23, 30).getTime())).toBe("2026-07-04");
  });
});

describe("stableId", () => {
  const rawKey = Array.from({ length: 32 }, (_, i) => i);

  it("is deterministic for the same vault and natural key", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, "fitbit:steps:2026-07-15"))
      .toBe(await stableId(key, "fitbit:steps:2026-07-15"));
  });

  it("differs per natural key", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, "fitbit:steps:2026-07-15"))
      .not.toBe(await stableId(key, "fitbit:steps:2026-07-16"));
  });

  it("differs per vault, so an id reveals nothing across accounts", async () => {
    const a = await importKeyRaw(rawKey);
    const b = await importKeyRaw(rawKey.map((n) => n + 1));
    expect(await stableId(a, "fitbit:steps:2026-07-15"))
      .not.toBe(await stableId(b, "fitbit:steps:2026-07-15"));
  });

  it("leaks nothing about the natural key it came from", async () => {
    const key = await importKeyRaw(rawKey);
    const id = await stableId(key, "fitbit:steps:2026-07-15");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("fitbit");
    expect(id).not.toContain("2026");
  });

  // GOLDEN VECTOR — pins ID_INFO, the frozen parameter. If this fails, someone
  // changed the derivation, and the next import will silently duplicate every
  // reading a person has instead of updating it. Same discipline as
  // VERIFIER_TEXT and the sharing InviteLabels. Don't "fix" the expectation.
  it("matches the frozen derivation", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, "fitbit:steps:2026-07-15")).toBe("7f3ee3988b99e6183453e1f77e7138a2");
  });
});
