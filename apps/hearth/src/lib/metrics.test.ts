import { describe, it, expect } from "vitest";
import {
  series, latest, change, chartPoints, toCanonical, recentAverage, METRIC_META,
  type Metric, type MetricKind,
} from "./metrics";

const mk = (at: string, value: number, unit = "kg"): Metric => ({
  id: at, at: new Date(at).getTime(), kind: "weight", value, unit,
});

// Readings `daysAgo` back, for the windowed average (which is relative to now).
const ago = (daysAgo: number, value: number, kind: MetricKind = "steps", unit = "steps"): Metric => ({
  id: `${kind}-${daysAgo}`, at: Date.now() - daysAgo * 86_400_000, kind, value, unit,
});

describe("metrics", () => {
  it("orders a series oldest → newest and finds the latest", () => {
    const ms = [mk("2026-07-10", 80), mk("2026-07-14", 78.5), mk("2026-07-12", 79.2)];
    const s = series(ms, "weight");
    expect(s.map((m) => m.value)).toEqual([80, 79.2, 78.5]);
    expect(latest(ms, "weight")!.value).toBe(78.5);
  });

  it("net change is latest minus first, in the latest unit", () => {
    const ms = [mk("2026-07-01", 82), mk("2026-07-14", 79.5)];
    expect(change(ms, "weight")).toEqual({ delta: -2.5, unit: "kg" });
  });

  it("stays quiet with fewer than two readings", () => {
    expect(change([mk("2026-07-14", 80)], "weight")).toBeNull();
    expect(change([], "weight")).toBeNull();
  });

  it("mixes units honestly: kg then lb sit on one scale", () => {
    // 80 kg, then 176.37 lb (== 80 kg) → net change ≈ 0
    const ms = [mk("2026-07-01", 80, "kg"), mk("2026-07-14", 176.37, "lb")];
    const c = change(ms, "weight")!;
    expect(c.unit).toBe("lb");
    expect(c.delta).toBeCloseTo(0, 1);
  });

  it("converts lb to canonical kg", () => {
    expect(toCanonical(220.462, "weight", "lb")).toBeCloseTo(100, 2);
  });

  it("chart points come out in the latest display unit", () => {
    const ms = [mk("2026-07-01", 80, "kg"), mk("2026-07-14", 170, "lb")];
    const pts = chartPoints(ms, "weight");
    expect(pts).toHaveLength(2);
    // first point (80 kg) rendered in lb ≈ 176.4
    expect(pts[0].value).toBeCloseTo(176.37, 1);
    expect(pts[1].value).toBeCloseTo(170, 5);
  });
});

describe("recentAverage", () => {
  it("averages only what's inside the window", () => {
    // 9000 is 30 days back and must not drag the fortnight's average down/up.
    const ms = [ago(1, 10_000), ago(3, 8_000), ago(5, 6_000), ago(30, 100)];
    const avg = recentAverage(ms, "steps", 14)!;
    expect(avg.value).toBe(8_000);
    expect(avg.n).toBe(3);
  });

  it("says nothing rather than widening the window when there's no recent data", () => {
    expect(recentAverage([ago(30, 9_000), ago(40, 8_000)], "steps", 14)).toBeNull();
    expect(recentAverage([], "steps", 14)).toBeNull();
  });

  it("reports in the latest reading's unit, mixing units honestly", () => {
    // 80 kg five days ago, then 180 lb yesterday → averaged on one scale, shown in lb.
    const ms = [ago(5, 80, "weight", "kg"), ago(1, 180, "weight", "lb")];
    const avg = recentAverage(ms, "weight", 14)!;
    expect(avg.unit).toBe("lb");
    expect(avg.value).toBeCloseTo((176.37 + 180) / 2, 1);
  });
});

describe("which kinds are daily", () => {
  // The distinction the Body card leans on: a daily kind gets an average,
  // because "up 2,431 steps since Jul 1" compares two arbitrary days and calls
  // the noise a trend. A slow-moving kind gets a real change since you started.
  it("marks the swingy kinds daily and leaves the slow-moving ones alone", () => {
    expect(METRIC_META.steps.daily).toBe(true);
    expect(METRIC_META.sleep.daily).toBe(true);
    expect(METRIC_META.weight.daily).toBeUndefined();
    expect(METRIC_META.waist.daily).toBeUndefined();
    expect(METRIC_META.bodyfat.daily).toBeUndefined();
    // Resting HR drifts slowly, like weight — its change over months is real.
    expect(METRIC_META.restingHR.daily).toBeUndefined();
  });
});
