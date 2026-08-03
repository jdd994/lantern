// db.ts
// Local-first storage. Everything lives in IndexedDB, so a list opens
// instantly and works offline — at the airport, at the trailhead, in the
// basement where the boxes are. The rule, same as its siblings: anything that
// says something about your plans — what you're bringing, where you're going,
// who's bringing what — is CIPHERTEXT. Only bookkeeping the sync engine needs
// (ids, record timestamps, tombstones, dirty flags) stays in the clear.
//
// Even an item's listId lives inside the ciphertext: the server never learns
// how records group into lists, let alone what's on them. It sees
// "record abc123 updated at 14:22, 180 bytes" and nothing else.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CipherBlob, WrappedKey } from "./crypto";

export const DB_VERSION = 1;

export type VaultMeta = {
  id: "vault";
  salt: number[];
  verifier: CipherBlob;
  createdAt: number;
  iterations: number;
  // Identity keypair, baked in from day one — a list you pack together is
  // co-authored by design. Public plaintext; private wrapped by the DEK.
  identityPublic?: string;
  identityPrivate?: WrappedKey;
  // Envelope encryption: the random data key (DEK) wrapped by the passphrase-
  // derived KEK. Changing the passphrase re-wraps this without re-encrypting
  // any data. Always present here — Manifest has no pre-envelope legacy vaults.
  wrappedDEK?: CipherBlob;
  // Paper recovery kit (@lantern/core/kit): DEK wrapped under a printed
  // code's derived key. Rides with the envelope to the server.
  recoveryKit?: { salt: number[]; wrapped: CipherBlob; createdAt: number };
};

// Sync bookkeeping shared by syncable records. Plaintext, never secret.
type Syncable = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  dirty: boolean;
};

// content encrypts an encodeList payload (title, note).
export type StoredList = Syncable & { content: CipherBlob };
// content encrypts an encodeItem payload (listId, text, checked, claimedBy…).
export type StoredItem = Syncable & { content: CipherBlob };

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

interface ManifestDB extends DBSchema {
  vault: { key: string; value: VaultMeta };
  lists: { key: string; value: StoredList };
  items: { key: string; value: StoredItem };
  sync: { key: string; value: SyncState };
  device: { key: string; value: DeviceEnrollment };
  recoverySession: { key: string; value: RecoverySession };
}

let dbPromise: Promise<IDBPDatabase<ManifestDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<ManifestDB>("manifest", DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("vault", { keyPath: "id" });
          database.createObjectStore("lists", { keyPath: "id" });
          database.createObjectStore("items", { keyPath: "id" });
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

// ---- lists / items --------------------------------------------------------
export async function allLists(): Promise<StoredList[]> {
  return (await db()).getAll("lists");
}
export async function putList(l: StoredList): Promise<void> {
  await (await db()).put("lists", l);
}
export async function allItems(): Promise<StoredItem[]> {
  return (await db()).getAll("items");
}
export async function putItem(i: StoredItem): Promise<void> {
  await (await db()).put("items", i);
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

export type SyncKind = "list" | "item";
export type AnyStored = StoredList | StoredItem;
const KIND_STORE: Record<SyncKind, "lists" | "items"> = {
  list: "lists",
  item: "items",
};
export const SYNC_KINDS: SyncKind[] = ["list", "item"];

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

const ALL_STORES = ["vault", "lists", "items", "sync", "device", "recoverySession"] as const;

// Wipe everything (forget this device). Without the passphrase nothing
// readable remains anywhere anyway.
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(ALL_STORES, "readwrite");
  await Promise.all(ALL_STORES.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}
