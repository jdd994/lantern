// db.ts
// Local-first storage. Everything lives in IndexedDB, so the almanac opens
// instantly and works offline — in the venue basement, on the train, at the
// lake. The rule, same as its siblings: anything that says something about
// your plans — what, when, where, who's going — is CIPHERTEXT. Only
// bookkeeping the sync engine needs (ids, record timestamps, tombstones,
// dirty flags) stays in the clear.
//
// Even a happening's calendarId and a mark's happeningId live inside the
// ciphertext: the server never learns how records group, let alone what they
// say. It sees "record abc123 updated at 14:22, 180 bytes" and nothing else.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CipherBlob, WrappedKey } from "./crypto";

export const DB_VERSION = 1;

export type VaultMeta = {
  id: "vault";
  salt: number[];
  verifier: CipherBlob;
  createdAt: number;
  iterations: number;
  // Identity keypair, baked in from day one — a calendar kept with your circle
  // is co-authored by design. Public plaintext; private wrapped by the DEK.
  identityPublic?: string;
  identityPrivate?: WrappedKey;
  // Envelope encryption: the random data key (DEK) wrapped by the passphrase-
  // derived KEK. Changing the passphrase re-wraps this without re-encrypting
  // any data. Always present here — Almanac has no pre-envelope legacy vaults.
  wrappedDEK?: CipherBlob;
};

// Sync bookkeeping shared by syncable records. Plaintext, never secret.
type Syncable = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  dirty: boolean;
};

// content encrypts an encodeCalendar payload (title, note).
export type StoredCalendar = Syncable & { content: CipherBlob };
// content encrypts an encodeHappening payload (calendarId, title, startsAt…).
export type StoredHappening = Syncable & { content: CipherBlob };
// content encrypts an encodeMark payload (happeningId, who).
export type StoredMark = Syncable & { content: CipherBlob };

export type SyncState = { id: "state"; cursor: number; token?: string; accountEmail?: string };

export type DeviceEnrollment = {
  id: "device";
  credentialId: number[];
  prfSalt: number[];
  wrapped: CipherBlob;
};

// A recovery attempt's throwaway session keypair — see Driftless's db.ts for
// the full rationale. Plaintext-local, device-scoped, useless alone; this is
// why a recovery attempt only completes on the device it started on.
export type RecoverySession = {
  id: "session";
  requestId: string;
  publicKeyB64: string;
  privateKeyPkcs8B64: string;
};

interface AlmanacDB extends DBSchema {
  vault: { key: string; value: VaultMeta };
  calendars: { key: string; value: StoredCalendar };
  happenings: { key: string; value: StoredHappening };
  marks: { key: string; value: StoredMark };
  sync: { key: string; value: SyncState };
  device: { key: string; value: DeviceEnrollment };
  recoverySession: { key: string; value: RecoverySession };
}

let dbPromise: Promise<IDBPDatabase<AlmanacDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<AlmanacDB>("almanac", DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("vault", { keyPath: "id" });
          database.createObjectStore("calendars", { keyPath: "id" });
          database.createObjectStore("happenings", { keyPath: "id" });
          database.createObjectStore("marks", { keyPath: "id" });
          database.createObjectStore("sync", { keyPath: "id" });
          database.createObjectStore("device", { keyPath: "id" });
          database.createObjectStore("recoverySession", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- vault ---------------------------------------------------------------
export async function getVault(): Promise<VaultMeta | undefined> {
  return (await db()).get("vault", "vault");
}
export async function saveVault(meta: VaultMeta): Promise<void> {
  await (await db()).put("vault", meta);
}

// ---- calendars / happenings / marks ---------------------------------------
export async function allCalendars(): Promise<StoredCalendar[]> {
  return (await db()).getAll("calendars");
}
export async function putCalendar(c: StoredCalendar): Promise<void> {
  await (await db()).put("calendars", c);
}
export async function allHappenings(): Promise<StoredHappening[]> {
  return (await db()).getAll("happenings");
}
export async function putHappening(h: StoredHappening): Promise<void> {
  await (await db()).put("happenings", h);
}
export async function allMarks(): Promise<StoredMark[]> {
  return (await db()).getAll("marks");
}
export async function putMark(m: StoredMark): Promise<void> {
  await (await db()).put("marks", m);
}

// ---- sync + device -------------------------------------------------------
export async function getSyncState(): Promise<SyncState | undefined> {
  return (await db()).get("sync", "state");
}
export async function saveSyncState(s: SyncState): Promise<void> {
  await (await db()).put("sync", s);
}
export async function getDevice(): Promise<DeviceEnrollment | undefined> {
  return (await db()).get("device", "device");
}
export async function saveDevice(e: DeviceEnrollment): Promise<void> {
  await (await db()).put("device", e);
}
export async function clearDevice(): Promise<void> {
  await (await db()).delete("device", "device");
}

// ---- social recovery ------------------------------------------------------
export async function getRecoverySession(): Promise<RecoverySession | undefined> {
  return (await db()).get("recoverySession", "session");
}
export async function saveRecoverySession(s: RecoverySession): Promise<void> {
  await (await db()).put("recoverySession", s);
}
export async function clearRecoverySession(): Promise<void> {
  await (await db()).delete("recoverySession", "session");
}

// ---- generic sync accessors ---------------------------------------------
// The sync engine treats the syncable stores uniformly (a kind + an id).
// These map a kind to its store and give get/put/clear-dirty/mark-all by
// kind, so lib/sync.ts stays small.

export type SyncKind = "calendar" | "happening" | "mark";
export type AnyStored = StoredCalendar | StoredHappening | StoredMark;
const KIND_STORE: Record<SyncKind, "calendars" | "happenings" | "marks"> = {
  calendar: "calendars",
  happening: "happenings",
  mark: "marks",
};
export const SYNC_KINDS: SyncKind[] = ["calendar", "happening", "mark"];

export async function getStoredByKind(kind: SyncKind, id: string): Promise<AnyStored | undefined> {
  return (await db()).get(KIND_STORE[kind], id);
}
export async function putStoredByKind(kind: SyncKind, rec: AnyStored): Promise<void> {
  await (await db()).put(KIND_STORE[kind], rec);
}
// Clear the dirty flag after a successful push — only if the record hasn't
// changed since (updatedAt still matches), so a mid-sync edit is never dropped.
export async function clearDirtyByKind(kind: SyncKind, id: string, updatedAt: number): Promise<void> {
  const d = await db();
  const rec = await d.get(KIND_STORE[kind], id);
  if (rec && rec.dirty && rec.updatedAt === updatedAt) await d.put(KIND_STORE[kind], { ...rec, dirty: false });
}
// Records awaiting upload, including dirty tombstones. Every syncable store
// must appear here — a store that's missing is a store whose records are
// marked dirty and then never pushed, which looks exactly like "sync is fine"
// until a second device is empty.
export async function dirtyRecords(): Promise<Array<{ kind: SyncKind; rec: AnyStored }>> {
  const d = await db();
  const out: Array<{ kind: SyncKind; rec: AnyStored }> = [];
  for (const kind of SYNC_KINDS) {
    for (const rec of await d.getAll(KIND_STORE[kind])) if (rec.dirty) out.push({ kind, rec });
  }
  return out;
}
// Mark every syncable record dirty — used when connecting a NEW account, so
// everything local uploads even if it was previously synced elsewhere.
export async function markAllDirty(): Promise<void> {
  const d = await db();
  for (const kind of SYNC_KINDS) {
    const store = KIND_STORE[kind];
    for (const r of await d.getAll(store)) if (!r.dirty) await d.put(store, { ...r, dirty: true });
  }
}

const ALL_STORES = ["vault", "calendars", "happenings", "marks", "sync", "device", "recoverySession"] as const;

// Wipe everything (forget this device). Without the passphrase nothing
// readable remains anywhere anyway.
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, "readwrite");
  await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
