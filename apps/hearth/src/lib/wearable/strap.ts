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
// way down: the variability computed from them (see live.ts, where the sit
// arithmetic lives) is arithmetic on your own heartbeats, not a vendor's
// opinion of them.
//
// THE REFUSAL, SAME AS FITBIT'S: the measurement packet can carry an "energy
// expended" field — calories, volunteered mid-stream by the spec itself. The
// parser steps over those bytes to reach the R-R intervals and never reads them
// into a number. strap.test.ts asserts the step-over. No calories, no toggle.

import type { Sample, Session } from "./live";

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

// ---- the Bluetooth session -------------------------------------------------
// Web Bluetooth: the chooser the browser shows IS the permission — no pairing
// codes, no stored credentials, nothing for Hearth to keep. Which is why there's
// no connection record for this provider: there is genuinely nothing to store.

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
