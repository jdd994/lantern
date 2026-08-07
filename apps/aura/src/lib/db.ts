// db.ts
// Local storage for Aura. A controller, not a vault — so unlike the other apps it
// doesn't gate behind a passphrase (you shouldn't type a password to dim a lamp).
// Its data lives in IndexedDB: connected sources (+ their credential), a device
// cache, and your scenes.
//
// Multi-home: each home is its own database (see lib/homes.ts for naming), and
// `forHome(dbName)` hands back that home's store functions. The first home keeps
// the original "aura" database, so existing setups carry over untouched.
//
// The API key is encrypted at rest with a device-local AES-GCM key that is
// generated once, marked non-extractable, and kept in the `keyring` store of the
// ORIGINAL database — one device key for every home, so a credential connected
// in two homes doesn't mint two keys. Because it's non-extractable, its raw
// bytes never exist in JS and can't be exported — yet it survives reloads
// (CryptoKey objects are structured-cloneable into IndexedDB). Honest threat
// model: this defends against passive inspection or exfiltration of the
// database (a devtools dump, a profile backup) — those yield ciphertext, not a
// usable key. It does NOT defend against code running on this origin (which
// could ask the key to decrypt); no client-only scheme can, without a
// passphrase we've deliberately chosen not to demand. It raises the floor from
// "plaintext key sitting in the DB" without adding friction.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Device, LightState } from "./connectors";
import type { Room } from "./rooms";
import type { Automation } from "./automations";
import type { Color } from "./connectors";

export const DB_VERSION = 6;
const KEYRING_DB = "aura"; // the one shared keyring lives in the original db

// A user-made vibe: a named color mood you can apply like the built-in ones.
export type CustomVibe = { id: string; label: string; rgb: Color; brightness: number; createdAt: number };

// A connected brand, app-facing. id is the connector id ("govee"); cred is its API
// key in the clear (decrypted on read, encrypted on write — see below).
export type StoredSource = { id: string; cred: string; connectedAt: number };

// How a source is actually stored: the credential is encrypted (or, for a legacy
// record written before encryption, a plaintext `cred` we re-wrap on next write).
type EncCred = { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer };
type SourceRecord = { id: string; connectedAt: number; enc?: EncCred; cred?: string };

// A saved vibe: a name + the light state to restore for each device. A scene scoped
// to a room (roomId set) captures only that room's lights; a whole-home scene
// (roomId undefined) captures everything.
export type StoredScene = {
  id: string;
  name: string;
  createdAt: number;
  states: Record<string, LightState>; // deviceId → state
  roomId?: string;
};

interface AuraDB extends DBSchema {
  sources: { key: string; value: SourceRecord };
  devices: { key: string; value: Device }; // cache, keyed by device.id
  scenes: { key: string; value: StoredScene };
  rooms: { key: string; value: Room };
  automations: { key: string; value: Automation };
  customVibes: { key: string; value: CustomVibe };
  keyring: { key: string; value: { id: string; key: CryptoKey } };
  // Your own name for a light, keyed by device id — separate from the `devices`
  // cache on purpose: that store is fully replaced on every connect/refresh (the
  // brand's own name each time), so a name kept there would vanish on the next
  // refresh. This one only ever changes when you rename something.
  deviceNames: { key: string; value: { id: string; name: string } };
}

const dbPromises = new Map<string, Promise<IDBPDatabase<AuraDB>>>();
function open(dbName: string) {
  let p = dbPromises.get(dbName);
  if (!p) {
    p = openDB<AuraDB>(dbName, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("sources", { keyPath: "id" });
          d.createObjectStore("devices", { keyPath: "id" });
          d.createObjectStore("scenes", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          d.createObjectStore("keyring", { keyPath: "id" });
        }
        if (oldVersion < 3) {
          d.createObjectStore("rooms", { keyPath: "id" });
        }
        if (oldVersion < 4) {
          d.createObjectStore("automations", { keyPath: "id" });
        }
        if (oldVersion < 5) {
          d.createObjectStore("customVibes", { keyPath: "id" });
        }
        if (oldVersion < 6) {
          d.createObjectStore("deviceNames", { keyPath: "id" });
        }
      },
    });
    dbPromises.set(dbName, p);
  }
  return p;
}

// ---- device key (for encrypting credentials at rest) ---------------------
const KEYRING_ID = "device";
async function deviceKey(): Promise<CryptoKey> {
  const d = await open(KEYRING_DB);
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

// One home's stores, bound to its database.
export function forHome(dbName: string) {
  const db = () => open(dbName);
  return {
    // ---- sources ---------------------------------------------------------
    async allSources(): Promise<StoredSource[]> {
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
    },
    async putSource(s: StoredSource): Promise<void> {
      const rec: SourceRecord = { id: s.id, connectedAt: s.connectedAt, enc: await encCred(s.cred) };
      await (await db()).put("sources", rec);
    },
    async deleteSource(id: string): Promise<void> {
      await (await db()).delete("sources", id);
    },

    // ---- devices (cache) -------------------------------------------------
    async allDevices(): Promise<Device[]> {
      return (await db()).getAll("devices");
    },
    async replaceDevicesForSource(sourceId: string, devices: Device[]): Promise<void> {
      const d = await db();
      const tx = d.transaction("devices", "readwrite");
      for (const existing of await tx.store.getAll()) {
        if (existing.sourceId === sourceId) await tx.store.delete(existing.id);
      }
      for (const dev of devices) await tx.store.put(dev);
      await tx.done;
    },
    async deleteDevicesForSource(sourceId: string): Promise<void> {
      const d = await db();
      const tx = d.transaction("devices", "readwrite");
      for (const existing of await tx.store.getAll()) {
        if (existing.sourceId === sourceId) await tx.store.delete(existing.id);
      }
      await tx.done;
    },

    // ---- scenes ----------------------------------------------------------
    async allScenes(): Promise<StoredScene[]> {
      return (await db()).getAll("scenes");
    },
    async putScene(s: StoredScene): Promise<void> {
      await (await db()).put("scenes", s);
    },
    async deleteScene(id: string): Promise<void> {
      await (await db()).delete("scenes", id);
    },

    // ---- rooms -----------------------------------------------------------
    async allRooms(): Promise<Room[]> {
      return (await db()).getAll("rooms");
    },
    async putRoom(r: Room): Promise<void> {
      await (await db()).put("rooms", r);
    },
    async putRooms(rs: Room[]): Promise<void> {
      const d = await db();
      const tx = d.transaction("rooms", "readwrite");
      for (const r of rs) await tx.store.put(r);
      await tx.done;
    },
    async deleteRoom(id: string): Promise<void> {
      await (await db()).delete("rooms", id);
    },

    // ---- automations -----------------------------------------------------
    async allAutomations(): Promise<Automation[]> {
      return (await db()).getAll("automations");
    },
    async putAutomation(a: Automation): Promise<void> {
      await (await db()).put("automations", a);
    },
    async deleteAutomation(id: string): Promise<void> {
      await (await db()).delete("automations", id);
    },

    // ---- custom vibes ----------------------------------------------------
    async allCustomVibes(): Promise<CustomVibe[]> {
      return (await db()).getAll("customVibes");
    },
    async putCustomVibe(v: CustomVibe): Promise<void> {
      await (await db()).put("customVibes", v);
    },
    async deleteCustomVibe(id: string): Promise<void> {
      await (await db()).delete("customVibes", id);
    },

    // ---- device names (your own name for a light) ------------------------
    async allDeviceNames(): Promise<Record<string, string>> {
      const recs = await (await db()).getAll("deviceNames");
      return Object.fromEntries(recs.map((r) => [r.id, r.name]));
    },
    async putDeviceName(id: string, name: string): Promise<void> {
      await (await db()).put("deviceNames", { id, name });
    },
    async deleteDeviceName(id: string): Promise<void> {
      await (await db()).delete("deviceNames", id);
    },
  };
}

export type HomeDb = ReturnType<typeof forHome>;

// Close (and forget) a home's cached connection — an open handle would block
// indexedDB.deleteDatabase forever when a home is erased.
export async function closeHome(dbName: string): Promise<void> {
  const p = dbPromises.get(dbName);
  if (!p) return;
  dbPromises.delete(dbName);
  try {
    (await p).close();
  } catch {
    /* already closed */
  }
}
