import { describe, expect, it } from "vitest";
import {
  REFUSED, batteryPacket, checksum, continuePacket, makePacket, parseBattery,
  parseRealTime, startPacket, stopPacket, validPacket,
} from "./ring";

const view = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

// A well-formed 16-byte frame with the checksum the ring would compute.
function frame(bytes: number[]): DataView {
  const p = new Uint8Array(16);
  bytes.forEach((b, i) => { p[i] = b; });
  p[15] = checksum(p);
  return new DataView(p.buffer);
}

describe("packets", () => {
  it("frames 16 bytes with a sum-of-first-15 checksum", () => {
    const p = makePacket(3);
    expect(p).toHaveLength(16);
    expect(p[0]).toBe(3);
    expect(p[15]).toBe(3);
  });

  it("matches the community-documented battery example byte for byte", () => {
    // The documented response is b'\x03\x40\x00…\x43' — same framing both ways,
    // so our request framing is pinned by their capture.
    expect([...batteryPacket()]).toEqual([3, ...Array(14).fill(0), 3]);
    const documented = frame([0x03, 0x40]);
    expect(new Uint8Array(documented.buffer)[15]).toBe(0x43);
    expect(parseBattery(documented)).toEqual({ level: 64, charging: false });
  });

  it("only ever asks for heart rate — the refused reading types are unrequestable", () => {
    // The ring will stream blood pressure (2), fatigue (4), blood sugar (9)…
    // There is no packet builder for them: every request this module can make
    // names reading type 1. That's the enforcement, and REFUSED is the promise.
    for (const p of [startPacket(), continuePacket(), stopPacket()]) {
      expect(p[1]).toBe(1);
    }
    expect(REFUSED).toEqual(
      expect.arrayContaining(["bloodPressure", "bloodSugar", "fatigue", "calories"])
    );
  });

  it("builds start/continue/stop the way the documented client does", () => {
    expect([...startPacket().slice(0, 3)]).toEqual([105, 1, 1]);
    expect([...continuePacket().slice(0, 3)]).toEqual([105, 1, 3]);
    expect([...stopPacket().slice(0, 4)]).toEqual([106, 1, 0, 0]);
  });
});

describe("validPacket", () => {
  it("rejects frames that are short or lie about their checksum", () => {
    expect(validPacket(view([105, 1, 0, 72]))).toBe(false);
    const bad = new Uint8Array(16);
    bad[0] = 105; bad[15] = 99; // wrong sum
    expect(validPacket(new DataView(bad.buffer))).toBe(false);
    expect(validPacket(frame([105, 1, 0, 72]))).toBe(true);
  });
});

describe("parseRealTime", () => {
  it("reads an honest heartbeat", () => {
    expect(parseRealTime(frame([105, 1, 0, 72]))).toEqual({ bpm: 72, contact: null, rr: [] });
  });

  it("believes the ring when it says it isn't reading you", () => {
    // A non-zero error code is the ring's off-body flag — same claim as the
    // strap's contact bit, so it becomes the same Sample shape.
    expect(parseRealTime(frame([105, 1, 2, 0]))).toEqual({ bpm: 0, contact: false, rr: [] });
  });

  it("drops a zero bpm — a sensor still settling is not a heartbeat", () => {
    expect(parseRealTime(frame([105, 1, 0, 0]))).toBeNull();
  });

  it("drops reading types it never asked for", () => {
    // Type 3 is SpO2; if the ring volunteers anything but heart rate, it's not
    // taken — not even into memory.
    expect(parseRealTime(frame([105, 3, 0, 98]))).toBeNull();
  });

  it("drops corrupt and foreign frames", () => {
    const corrupt = new Uint8Array(16);
    corrupt[0] = 105; corrupt[1] = 1; corrupt[3] = 72; corrupt[15] = 1;
    expect(parseRealTime(new DataView(corrupt.buffer))).toBeNull();
    expect(parseRealTime(frame([3, 64, 0]))).toBeNull(); // a battery frame
  });
});

describe("parseBattery", () => {
  it("reads level and charging, and refuses foreign frames", () => {
    expect(parseBattery(frame([3, 81, 1]))).toEqual({ level: 81, charging: true });
    expect(parseBattery(frame([105, 1, 0, 72]))).toBeNull();
  });
});
