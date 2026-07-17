import { describe, expect, it } from "vitest";
import {
  MIN_RR_PAIRS, REFUSED, parseMeasurement, resting, rmssd, toReadings,
} from "./strap";

// Build a measurement packet the way a strap does: flags, then fields the
// flags promised, little-endian throughout.
function packet(
  flags: number,
  bpm: number,
  opts: { energy?: number; rr?: number[] } = {}
): DataView {
  const bytes: number[] = [flags];
  if (flags & 0x01) bytes.push(bpm & 0xff, bpm >> 8);
  else bytes.push(bpm);
  if (flags & 0x08) {
    const e = opts.energy ?? 0;
    bytes.push(e & 0xff, e >> 8);
  }
  for (const r of opts.rr ?? []) bytes.push(r & 0xff, r >> 8);
  return new DataView(new Uint8Array(bytes).buffer);
}

describe("parseMeasurement", () => {
  it("reads a plain 8-bit rate", () => {
    expect(parseMeasurement(packet(0x00, 72))).toEqual({ bpm: 72, contact: null, rr: [] });
  });

  it("reads a 16-bit rate when the flag says so", () => {
    expect(parseMeasurement(packet(0x01, 300)).bpm).toBe(300);
  });

  it("reports skin contact only when the strap can actually say", () => {
    expect(parseMeasurement(packet(0x00, 70)).contact).toBeNull();       // feature absent
    expect(parseMeasurement(packet(0x04, 70)).contact).toBe(false);      // supported, off skin
    expect(parseMeasurement(packet(0x06, 70)).contact).toBe(true);       // supported, on skin
  });

  it("converts R-R from 1/1024ths of a second to milliseconds", () => {
    const s = parseMeasurement(packet(0x10, 60, { rr: [1024] }));
    expect(s.rr).toEqual([1000]);
  });

  it("takes every R-R in the packet", () => {
    const s = parseMeasurement(packet(0x10, 60, { rr: [1024, 512, 2048] }));
    expect(s.rr).toEqual([1000, 500, 2000]);
  });

  it("steps over energy expended and never surfaces it", () => {
    // Energy present AND R-R present: if the calories bytes were read as data,
    // the R-R values would come out wrong — this asserts both refusal and walk.
    const s = parseMeasurement(packet(0x18, 65, { energy: 999, rr: [1024] }));
    expect(s.rr).toEqual([1000]);
    expect(JSON.stringify(s)).not.toContain("999");
    // The refusal is a public name, same discipline as Fitbit's REFUSED_FIELDS.
    expect(REFUSED).toContain("energyExpended");
    expect(Object.keys(s)).toEqual(["bpm", "contact", "rr"]);
  });
});

describe("rmssd", () => {
  it("computes the root mean square of successive differences", () => {
    // diffs 10, -20, 15 → sqrt((100+400+225)/3) = sqrt(241.666…)
    const v = rmssd([1000, 1010, 990, 1005]);
    expect(v).not.toBeNull();
    expect(v!.pairs).toBe(3);
    expect(v!.value).toBeCloseTo(Math.sqrt(725 / 3), 6);
  });

  it("drops implausible beats instead of averaging them in", () => {
    // A 100ms 'beat' is a mis-trigger, not a heart. Neither pair that touches
    // it survives; the clean pair on each side still counts.
    const v = rmssd([1000, 1010, 100, 990, 1000]);
    expect(v!.pairs).toBe(2); // (1000,1010) and (990,1000)
  });

  it("drops jumps over 20% — a missed beat reads as a doubled gap", () => {
    const v = rmssd([1000, 1300, 1000]);
    expect(v).toBeNull();
  });

  it("says nothing rather than guessing from nothing", () => {
    expect(rmssd([])).toBeNull();
    expect(rmssd([1000])).toBeNull();
  });
});

describe("resting", () => {
  const still = (n: number, bpm: number) => Array.from({ length: n }, () => bpm);
  const steadyRR = (n: number) => Array.from({ length: n }, (_, i) => 1000 + (i % 2 === 0 ? 15 : -15));

  it("reports the middle of what was seen, with its honest spread", () => {
    const r = resting([70, 60, 62, 61, 63, 62, 90, 62], []);
    expect(r!.bpm).toBe(62);
    expect(r!.low).toBeLessThanOrEqual(61);
    expect(r!.high).toBeGreaterThanOrEqual(70);
    expect(r!.samples).toBe(8);
  });

  it("includes variability only when enough clean pairs back it", () => {
    const enough = resting(still(120, 62), steadyRR(MIN_RR_PAIRS + 2));
    expect(enough!.hrv).not.toBeNull();

    const thin = resting(still(120, 62), steadyRR(5));
    expect(thin!.hrv).toBeNull();
    expect(thin!.rrPairs).toBeGreaterThan(0); // it was seen — just not enough to say
  });

  it("is quiet before there is anything to summarise", () => {
    expect(resting([], [])).toBeNull();
  });
});

describe("toReadings", () => {
  it("keys both readings to the same moment, so a re-save lands on the same records", () => {
    const at = 1_752_672_000_000;
    const rs = toReadings(
      { bpm: 62, low: 60, high: 64, samples: 120, hrv: 38, rrPairs: 90 }, at
    );
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ kind: "restingHR", value: 62, unit: "bpm", natural: `strap:rhr:${at}` });
    expect(rs[1]).toMatchObject({ kind: "hrv", value: 38, unit: "ms", natural: `strap:hrv:${at}` });
  });

  it("saves no variability reading when the sit couldn't honestly compute one", () => {
    const rs = toReadings({ bpm: 62, low: 60, high: 64, samples: 30, hrv: null, rrPairs: 4 }, 1);
    expect(rs).toHaveLength(1);
    expect(rs[0].kind).toBe("restingHR");
  });
});
