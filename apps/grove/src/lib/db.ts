// db.ts
// Local-first storage. Everything lives in IndexedDB, so the tree opens
// instantly and works offline. The rule, same as its siblings: anything that
// says something about the family — who they are, when they lived, what the
// letters say — is CIPHERTEXT. Only bookkeeping the sync engine needs (ids,
// record timestamps, tombstones, dirty flags) stays in the clear.
//
// One deliberate difference from Hearth/Ballast: NO plaintext lived-time
// fields. Hearth keeps a food log's `at` outside the ciphertext so a day can
// be windowed cheaply; here the lived dates (births, deaths, marriages) are
// exactly the metadata a genealogy leaks — from birthdates alone a server
// could sketch the family. The graph is small (a family, not a feed), so we
// decrypt everything on unlock, like Driftless, and window nothing.
//
// A server (later) would see: "record abc123 updated at 14:22, 300 bytes."
// Never a name, a date, or a word of a letter.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CipherBlob, WrappedKey } from "./crypto";

export const DB_VERSION = 1;

export type VaultMeta = {
  id: "vault";
  salt: number[];
  verifier: CipherBlob;
  createdAt: number;
  iterations: number;
  // Identity keypair, baked in from day one — a tree is co-authored by
  // design, so this app will need it sooner than its siblings did. Public
  // plaintext; private wrapped by the DEK.
  identityPublic?: string;
  identityPrivate?: WrappedKey;
  // Envelope encryption: the random data key (DEK) wrapped by the passphrase-
  // derived KEK. Changing the passphrase re-wraps this without re-encrypting
  // any data. Always present here — Grove has no pre-envelope legacy vaults.
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

// content encrypts an encodePerson payload (names, events, remembrance…).
export type StoredPerson = Syncable & { content: CipherBlob };
// content encrypts an encodeUnion payload (partners, child links, marriages).
export type StoredUnion = Syncable & { content: CipherBlob };
// content encrypts an encodeKeepsake payload (caption, transcription, about).
export type StoredKeepsake = Syncable & { content: CipherBlob };

// A keepsake's attached scan or photo, stored as encrypted raw bytes — the
// same shape Driftless uses for polaroids, so the media-sync path
// (@lantern/core MediaSyncAdapter, object storage) composes unchanged when
// sync lands. `type` is the mime; a letter may well be application/pdf.
export type StoredMedia = {
  id: string;
  type: string;
  createdAt: number;
  iv: Uint8Array;
  data: ArrayBuffer; // ciphertext
  deleted: boolean;
  dirty: boolean;
};

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

interface GroveDB extends DBSchema {
  vault: { key: string; value: VaultMeta };
  people: { key: string; value: StoredPerson };
  unions: { key: string; value: StoredUnion };
  keepsakes: { key: string; value: StoredKeepsake };
  media: { key: string; value: StoredMedia };
  sync: { key: string; value: SyncState };
  device: { key: string; value: DeviceEnrollment };
  recoverySession: { key: string; value: RecoverySession };
}

let dbPromise: Promise<IDBPDatabase<GroveDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<GroveDB>("grove", DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("vault", { keyPath: "id" });
          database.createObjectStore("people", { keyPath: "id" });
          database.createObjectStore("unions", { keyPath: "id" });
          database.createObjectStore("keepsakes", { keyPath: "id" });
          database.createObjectStore("media", { keyPath: "id" });
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

// ---- people / unions / keepsakes -----------------------------------------
export async function allPeople(): Promise<StoredPerson[]> {
  return (await db()).getAll("people");
}
export async function putPerson(p: StoredPerson): Promise<void> {
  await (await db()).put("people", p);
}
export async function allUnions(): Promise<StoredUnion[]> {
  return (await db()).getAll("unions");
}
export async function putUnion(u: StoredUnion): Promise<void> {
  await (await db()).put("unions", u);
}
export async function allKeepsakes(): Promise<StoredKeepsake[]> {
  return (await db()).getAll("keepsakes");
}
export async function putKeepsake(k: StoredKeepsake): Promise<void> {
  await (await db()).put("keepsakes", k);
}

// ---- media ---------------------------------------------------------------
export async function getMedia(id: string): Promise<StoredMedia | undefined> {
  return (await db()).get("media", id);
}
export async function putMedia(m: StoredMedia): Promise<void> {
  await (await db()).put("media", m);
}
export async function allMedia(): Promise<StoredMedia[]> {
  return (await db()).getAll("media");
}
// Soft delete, like every syncable record: the tombstone stays (deleted +
// dirty) so the removal can sync and win last-write-wins when sync lands.
export async function deleteMedia(id: string): Promise<void> {
  const d = await db();
  const m = await d.get("media", id);
  if (m && !m.deleted) await d.put("media", { ...m, deleted: true, dirty: true });
}
// Blobs awaiting upload (tombstones excluded — a deleted scan is removed
// remotely by deleteMediaRemote, never uploaded).
export async function dirtyMedia(): Promise<StoredMedia[]> {
  return (await allMedia()).filter((m) => m.dirty && !m.deleted);
}
export async function clearMediaDirty(id: string): Promise<void> {
  const d = await db();
  const m = await d.get("media", id);
  if (m && m.dirty) await d.put("media", { ...m, dirty: false });
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
// The sync engine treats the three syncable stores uniformly (a kind + an
// id). These map a kind to its store and give get/put/clear-dirty/mark-all by
// kind, so the future lib/sync.ts stays small.

export type SyncKind = "person" | "union" | "keepsake";
export type AnyStored = StoredPerson | StoredUnion | StoredKeepsake;
const KIND_STORE: Record<SyncKind, "people" | "unions" | "keepsakes"> = {
  person: "people",
  union: "unions",
  keepsake: "keepsakes",
};
export const SYNC_KINDS: SyncKind[] = ["person", "union", "keepsake"];

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
// the whole local tree uploads even if it was previously synced elsewhere.
// Media rides along: a keepsake without its scan is only half backed up.
export async function markAllDirty(): Promise<void> {
  const d = await db();
  for (const kind of SYNC_KINDS) {
    const store = KIND_STORE[kind];
    for (const r of await d.getAll(store)) if (!r.dirty) await d.put(store, { ...r, dirty: true });
  }
  for (const m of await d.getAll("media")) if (!m.dirty && !m.deleted) await d.put("media", { ...m, dirty: true });
}

const ALL_STORES = [
  "vault", "people", "unions", "keepsakes", "media", "sync", "device", "recoverySession",
] as const;

// Wipe everything (forget this device). Without the passphrase nothing
// readable remains anywhere anyway.
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, "readwrite");
  await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
