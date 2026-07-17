// wearable/ring.ts
// Tier 0 — a ColMi-class smart ring (R02/R03/R06 and OEM cousins) talking to
// this page over Bluetooth. Unlike the strap there is no published standard
// here: the protocol is community reverse-engineered (tahnok's colmi_r02_client
// and the colmi.puxtril.com command notes, pinned 2026-07-17), and the ring
// still never learns what was listening — no account, no vendor app, no cloud,
// no network. The full protocol notes live in the Wick repo (~/dev/wick); this file
// implements only what a live sit needs.
//
// THE REFUSALS HAVE TEETH HERE. The ring's real-time command will cheerfully
// stream "blood pressure", "blood sugar" and "fatigue" — pseudo-measurements a
// £20 optical sensor cannot honestly make. Hearth never requests those types,
// and the parser drops any reading whose type isn't the one we asked for. The
// ring's daily logs also carry calories; the log commands aren't implemented at
// all, so those bytes are never even requested. And a ring sit never claims a
// variability reading: bpm arrives pre-chewed by the ring's firmware, with no
// raw beat-to-beat intervals to compute one honestly from (see live.ts).
//
// UNVERIFIED WITH A REAL RING — protocol from community documentation, asserted
// against its published byte examples in ring.test.ts; the live dance needs the
// physical ring, same status the strap and Fitbit connectors started with.

import type { Sample, Session } from "./live";

// What the ring offers that we deliberately never ask for, named so the test
// can prove the request packets for them are never built.
export const REFUSED = ["bloodPressure", "bloodSugar", "fatigue", "pressure", "calories"];

// Nordic-UART-shaped vendor service. Web Bluetooth requires lowercase UUIDs.
export const SERVICE = "6e40fff0-b5a3-f393-e0a9-e50e24dcca9e";
const WRITE_CHAR = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const NOTIFY_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// ---- packets ---------------------------------------------------------------
// Everything is a 16-byte frame: command, up to 14 payload bytes, then a
// checksum — the sum of the first 15 bytes, masked to a byte.

const CMD_START_REAL_TIME = 105;
const CMD_STOP_REAL_TIME = 106;

// Real-time reading types. HEART_RATE is the only one Hearth ever requests —
// the rest of the type space (2 blood pressure, 3 SpO2, 4 fatigue, 9 blood
// sugar, 10 "HRV") stays unrequested; see REFUSED above.
const TYPE_HEART_RATE = 1;

const ACTION_START = 1;
const ACTION_CONTINUE = 3;

// The ring stops streaming unless it's told "keep going" now and then.
const KEEPALIVE_MS = 3000;

export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += bytes[i];
  return sum & 0xff;
}

export function makePacket(cmd: number, sub: number[] = []): Uint8Array<ArrayBuffer> {
  const p = new Uint8Array(16);
  p[0] = cmd;
  sub.forEach((b, i) => { p[i + 1] = b; });
  p[15] = checksum(p);
  return p;
}

/** A frame is only believed when it's whole and its checksum agrees. */
export function validPacket(view: DataView): boolean {
  if (view.byteLength !== 16) return false;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, 16);
  return checksum(bytes) === bytes[15];
}

export const startPacket = () => makePacket(CMD_START_REAL_TIME, [TYPE_HEART_RATE, ACTION_START]);
export const continuePacket = () => makePacket(CMD_START_REAL_TIME, [TYPE_HEART_RATE, ACTION_CONTINUE]);
export const stopPacket = () => makePacket(CMD_STOP_REAL_TIME, [TYPE_HEART_RATE, 0, 0]);

/**
 * One real-time frame → one sample, or null for anything that isn't an honest
 * heartbeat: a corrupt frame, a type we didn't ask for, a bpm of zero (the
 * sensor still settling). An error code from the ring means "I'm not reading
 * you" — surfaced as contact:false, the same claim the strap's off-skin bit
 * makes, so the sit UI says so instead of showing a stale number.
 */
export function parseRealTime(view: DataView): Sample | null {
  if (!validPacket(view)) return null;
  if (view.getUint8(0) !== CMD_START_REAL_TIME) return null;
  if (view.getUint8(1) !== TYPE_HEART_RATE) return null;
  const errorCode = view.getUint8(2);
  if (errorCode !== 0) return { bpm: 0, contact: false, rr: [] };
  const bpm = view.getUint8(3);
  if (bpm === 0) return null;
  return { bpm, contact: null, rr: [] };
}

// ---- battery (parsed, not yet wired) ----------------------------------------
// One frame each way; kept here because rings die quietly and a future sit
// sheet should be able to say so. Golden-tested against the documented example.
const CMD_BATTERY = 3;
export const batteryPacket = () => makePacket(CMD_BATTERY);
export function parseBattery(view: DataView): { level: number; charging: boolean } | null {
  if (!validPacket(view) || view.getUint8(0) !== CMD_BATTERY) return null;
  return { level: view.getUint8(1), charging: view.getUint8(2) !== 0 };
}

// ---- the Bluetooth session ---------------------------------------------------
// Same shape as the strap's: the chooser is the permission, nothing persists.

export async function open(
  onSample: (s: Sample) => void,
  onDrop: () => void
): Promise<Session | null> {
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return null;
    throw new Error("This browser couldn't look for a ring just now.");
  }

  if (!device.gatt) throw new Error("That device can't hold a connection.");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);
  const notify = await service.getCharacteristic(NOTIFY_CHAR);
  const write = await service.getCharacteristic(WRITE_CHAR);

  const onValue = (e: Event) => {
    const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const sample = parseRealTime(value);
    if (sample) onSample(sample);
  };
  notify.addEventListener("characteristicvaluechanged", onValue);
  device.addEventListener("gattserverdisconnected", onDrop);
  await notify.startNotifications();
  await write.writeValue(startPacket());

  // Nudge the stream alive on a timer; a failed nudge means the ring is gone,
  // and the drop handler already owns that story.
  const keepalive = setInterval(() => {
    write.writeValue(continuePacket()).catch(() => undefined);
  }, KEEPALIVE_MS);

  return {
    name: device.name ?? "Smart ring",
    stop: () => {
      clearInterval(keepalive);
      notify.removeEventListener("characteristicvaluechanged", onValue);
      device.removeEventListener("gattserverdisconnected", onDrop);
      // Ask it to stop measuring before hanging up — an optical LED left
      // running is battery poured out on the floor.
      write.writeValue(stopPacket()).catch(() => undefined).finally(() => {
        try {
          device.gatt?.disconnect();
        } catch {
          // Already gone is the state we wanted.
        }
      });
    },
  };
}
