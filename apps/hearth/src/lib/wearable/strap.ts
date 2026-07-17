// wearable/strap.ts
// Tier 0 — a heart-rate strap talking to this page over Bluetooth. Not a vendor
// integration: the Heart Rate Service (GATT 0x180D) is a published Bluetooth SIG
// standard, so this one connector works with any compliant device — a Polar
// H10/H9, a Garmin HRM-Dual, a Wahoo TICKR, a Coros armband. Nothing here can be
// deprecated by a vendor, because there is no vendor: no account, no OAuth, no
// API origin in the CSP, no network at all. The strap doesn't even learn that
// the thing listening is Hearth.
//
// WHY A CHEST STRAP IS THE HONEST DEVICE: it reads the heart's electrical signal
// (ECG), not an optical guess through skin — validation studies use the Polar
// H10 as the *reference* to judge other wearables against. And the standard
// profile carries raw beat-to-beat R-R intervals, which is measurement all the
// way down: variability computed from them here is arithmetic on your own
// heartbeats, not a vendor's opinion of them.
//
// THE REFUSAL, SAME AS FITBIT'S: the measurement packet can carry an "energy
// expended" field — calories, volunteered mid-stream by the spec itself. The
// parser steps over those bytes to reach the R-R intervals and never reads them
// into a number. strap.test.ts asserts the step-over. No calories, no toggle.

import type { Reading } from "./index";

// What the spec offers that we deliberately leave on the floor, named so the
// test can prove we leave it there.
export const REFUSED = ["energyExpended"];

// ---- the measurement packet (GATT 0x2A37) ---------------------------------
// One notification per beat-to-second. Layout is flag-driven:
//   byte 0        flags — bit0: bpm is uint16 (else uint8)
//                         bits1-2: sensor contact (bit2 = feature supported,
//                                  bit1 = skin contact detected)
//                         bit3: energy expended present (uint16, REFUSED)
//                         bit4: R-R intervals present (uint16s, 1/1024 s each)
//   then          bpm, [energy], R-R…  — all little-endian.

export type Sample = {
  bpm: number;
  // true/false when the strap reports skin contact; null when it can't say.
  // The strap telling you "I'm not actually reading you right now" is honesty
  // built into the protocol — it gets rendered, never papered over.
  contact: boolean | null;
  // Beat-to-beat gaps in milliseconds. The prize of the whole profile.
  rr: number[];
};

export function parseMeasurement(view: DataView): Sample {
  const flags = view.getUint8(0);
  let at = 1;

  const wide = (flags & 0x01) !== 0;
  const bpm = wide ? view.getUint16(at, true) : view.getUint8(at);
  at += wide ? 2 : 1;

  const contact = (flags & 0x04) !== 0 ? (flags & 0x02) !== 0 : null;

  // Energy expended: two bytes of calories the spec insists on offering.
  // Stepped over, never read. This line is the enforcement.
  if ((flags & 0x08) !== 0) at += 2;

  const rr: number[] = [];
  if ((flags & 0x10) !== 0) {
    for (; at + 2 <= view.byteLength; at += 2) {
      rr.push((view.getUint16(at, true) * 1000) / 1024);
    }
  }
  return { bpm, contact, rr };
}

// ---- resting arithmetic ----------------------------------------------------
// Pure summaries of a quiet sit. The honesty rule shapes both: report the
// middle of what was actually seen with its real spread, and when there isn't
// enough clean signal to say something true, say nothing rather than guess.

// An R-R gap outside a plausible human beat, or jumping more than 20% from its
// neighbour, is almost always the strap mis-triggering (a moved electrode, a
// missed beat) rather than your heart. Standard artifact rule; applied openly.
const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;
const RR_MAX_JUMP = 0.2;

// Fewer clean pairs than this and an RMSSD is noise wearing a number's clothes.
// A two-minute sit at ordinary heart rates clears it comfortably.
export const MIN_RR_PAIRS = 40;

const plausible = (ms: number) => ms >= RR_MIN_MS && ms <= RR_MAX_MS;

/**
 * RMSSD — the root mean square of successive R-R differences, the standard
 * short-reading variability measure. Computed only over consecutive plausible
 * pairs; returns the count so the caller can decide whether it's enough to say
 * out loud. Null when no pair survives.
 */
export function rmssd(rr: number[]): { value: number; pairs: number } | null {
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < rr.length; i++) {
    const a = rr[i - 1];
    const b = rr[i];
    if (!plausible(a) || !plausible(b)) continue;
    if (Math.abs(b - a) > RR_MAX_JUMP * a) continue;
    const d = b - a;
    sum += d * d;
    pairs++;
  }
  return pairs === 0 ? null : { value: Math.sqrt(sum / pairs), pairs };
}

export type Resting = {
  bpm: number;          // median — the middle of what was seen, not a hopeful mean
  low: number;          // 10th percentile —
  high: number;         //   90th: "mostly between low and high", honestly
  samples: number;
  hrv: number | null;   // RMSSD in ms, only when enough clean pairs backed it
  rrPairs: number;
};

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** Summarise a sit. Null until there's anything at all to summarise. */
export function resting(bpms: number[], rr: number[]): Resting | null {
  if (bpms.length === 0) return null;
  const sorted = [...bpms].sort((a, b) => a - b);
  const v = rmssd(rr);
  return {
    bpm: Math.round(pct(sorted, 0.5)),
    low: Math.round(pct(sorted, 0.1)),
    high: Math.round(pct(sorted, 0.9)),
    samples: bpms.length,
    hrv: v && v.pairs >= MIN_RR_PAIRS ? Math.round(v.value) : null,
    rrPairs: v?.pairs ?? 0,
  };
}

/**
 * The readings a saved sit produces. Variability is included only when the
 * summary could honestly compute it. `at` keys the naturals: a saved sit is one
 * moment, and re-saving the same sit (double-tap, StrictMode) lands on the same
 * records instead of duplicating them.
 */
export function toReadings(r: Resting, at: number): Reading[] {
  const out: Reading[] = [
    { kind: "restingHR", value: r.bpm, unit: "bpm", at, natural: `strap:rhr:${at}` },
  ];
  if (r.hrv !== null) {
    out.push({ kind: "hrv", value: r.hrv, unit: "ms", at, natural: `strap:hrv:${at}` });
  }
  return out;
}

// ---- the Bluetooth session -------------------------------------------------
// Web Bluetooth: the chooser the browser shows IS the permission — no pairing
// codes, no stored credentials, nothing for Hearth to keep. Which is why there's
// no connection record for this provider: there is genuinely nothing to store.

export const supported = (): boolean =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;

export type Session = {
  name: string;
  stop: () => void;
};

/**
 * Open the browser's device chooser and start listening. Returns null when the
 * person closes the chooser — choosing nothing is a complete answer, not an
 * error. `onDrop` fires if the strap goes away mid-sit (walked off, battery).
 */
export async function open(
  onSample: (s: Sample) => void,
  onDrop: () => void
): Promise<Session | null> {
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return null;
    throw new Error("This browser couldn't look for a strap just now.");
  }

  if (!device.gatt) throw new Error("That device can't hold a connection.");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService("heart_rate");
  const ch = await service.getCharacteristic("heart_rate_measurement");
  const onValue = (e: Event) => {
    const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) onSample(parseMeasurement(value));
  };
  ch.addEventListener("characteristicvaluechanged", onValue);
  device.addEventListener("gattserverdisconnected", onDrop);
  await ch.startNotifications();

  return {
    name: device.name ?? "Heart-rate strap",
    stop: () => {
      ch.removeEventListener("characteristicvaluechanged", onValue);
      device.removeEventListener("gattserverdisconnected", onDrop);
      try {
        device.gatt?.disconnect();
      } catch {
        // Already gone is the state we wanted.
      }
    },
  };
}
