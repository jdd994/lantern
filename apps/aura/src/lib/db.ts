// db.ts
// Local storage for Aura. A controller, not a vault — so unlike the other apps it
// doesn't gate behind a passphrase (you shouldn't type a password to dim a lamp).
// Its data lives in IndexedDB: connected sources (+ their credential), a device
// cache, and your scenes.
//
// The API key is encrypted at rest with a device-local AES-GCM key that is
// generated once, marked non-extractable, and kept in the `keyring` store. Because
// it's non-extractable, its raw bytes never exist in JS and can't be exported —
// yet it survives reloads (CryptoKey objects are structured-cloneable into
// IndexedDB). Honest threat model: this defends against passive inspection or
// exfiltration of the database (a devtools dump, a profile backup) — those yield
// ciphertext, not a usable key. It does NOT defend against code running on this
// origin (which could ask the key to decrypt); no client-only scheme can, without
// a passphrase we've deliberately chosen not to demand. It raises the floor from
// "plaintext key sitting in the DB" without adding friction.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Device, LightState } from "./connectors";

export const DB_VERSION = 2;

// A connected brand, app-facing. id is the connector id ("govee"); cred is its API
// key in the clear (decrypted on read, encrypted on write — see below).
export type StoredSource = { id: string; cred: string; connectedAt: number };

// How a source is actually stored: the credential is encrypted (or, for a legacy
// record written before encryption, a plaintext `cred` we re-wrap on next write).
type EncCred = { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer };
type SourceRecord = { id: string; connectedAt: number; enc?: EncCred; cred?: string };

// A saved vibe: a name + the light state to restore for each device.
export type StoredScene = {
  id: string;
  name: string;
  createdAt: number;
  states: Record<string, LightState>; // deviceId → state
};

interface AuraDB extends DBSchema {
  sources: { key: string; value: SourceRecord };
  devices: { key: string; value: Device }; // cache, keyed by device.id
  scenes: { key: string; value: StoredScene };
  keyring: { key: string; value: { id: string; key: CryptoKey } };
}

let dbPromise: Promise<IDBPDatabase<AuraDB>> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB<AuraDB>("aura", DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("sources", { keyPath: "id" });
          d.createObjectStore("devices", { keyPath: "id" });
          d.createObjectStore("scenes", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          d.createObjectStore("keyring", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- device key (for encrypting credentials at rest) ---------------------
const KEYRING_ID = "device";
async function deviceKey(): Promise<CryptoKey> {
  const d = await db();
  const existing = await d.get("keyring", KEYRING_ID);
  if (existing) return existing.key;
  // Non-extractable: the raw bytes can never leave the browser, but the key still
  // persists across reloads because CryptoKey is structured-cloneable into idb.
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await d.put("keyring", { id: KEYRING_ID, key });
  return key;
}

async function encCred(plain: string): Promise<EncCred> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deviceKey(),
    new TextEncoder().encode(plain)
  );
  return { iv, ct };
}

async function decCred(enc: EncCred): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: enc.iv }, await deviceKey(), enc.ct);
  return new TextDecoder().decode(pt);
}

// ---- sources -------------------------------------------------------------
export async function allSources(): Promise<StoredSource[]> {
  const recs = await (await db()).getAll("sources");
  const out: StoredSource[] = [];
  for (const r of recs) {
    let cred = "";
    if (r.enc) {
      try {
        cred = await decCred(r.enc);
      } catch {
        cred = ""; // key gone or record tampered — treat as unusable, not a crash
      }
    } else if (typeof r.cred === "string") {
      cred = r.cred; // legacy plaintext; re-wrapped on next putSource
    }
    out.push({ id: r.id, cred, connectedAt: r.connectedAt });
  }
  return out;
}
export async function putSource(s: StoredSource): Promise<void> {
  const rec: SourceRecord = { id: s.id, connectedAt: s.connectedAt, enc: await encCred(s.cred) };
  await (await db()).put("sources", rec);
}
export async function deleteSource(id: string): Promise<void> {
  await (await db()).delete("sources", id);
}

// ---- devices (cache) -----------------------------------------------------
export async function allDevices(): Promise<Device[]> {
  return (await db()).getAll("devices");
}
export async function replaceDevicesForSource(sourceId: string, devices: Device[]): Promise<void> {
  const d = await db();
  const tx = d.transaction("devices", "readwrite");
  for (const existing of await tx.store.getAll()) {
    if (existing.sourceId === sourceId) await tx.store.delete(existing.id);
  }
  for (const dev of devices) await tx.store.put(dev);
  await tx.done;
}
export async function deleteDevicesForSource(sourceId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction("devices", "readwrite");
  for (const existing of await tx.store.getAll()) {
    if (existing.sourceId === sourceId) await tx.store.delete(existing.id);
  }
  await tx.done;
}

// ---- scenes --------------------------------------------------------------
export async function allScenes(): Promise<StoredScene[]> {
  return (await db()).getAll("scenes");
}
export async function putScene(s: StoredScene): Promise<void> {
  await (await db()).put("scenes", s);
}
export async function deleteScene(id: string): Promise<void> {
  await (await db()).delete("scenes", id);
}
