import { describe, expect, it } from "vitest";
import { REFUSED, parseMeasurement } from "./strap";

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
