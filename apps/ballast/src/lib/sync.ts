// sync.ts — Ballast's binding to the shared reconcile engine (@lantern/core/sync).
// The engine does pull (LWW) + push (dirty, chunked); this file only supplies the
// app-specific parts: which kinds exist, the plaintext each keeps outside the
// ciphertext as `meta` (a snapshot's accountId + at, a transaction's at), how to
// read/write the stores, and the network calls.
import { createSyncEngine, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges, type SyncRecord as ApiRecord } from "./api";
import {
  dirtyRecords, getStoredByKind, putStoredByKind, clearDirtyByKind, getSyncState, saveSyncState,
  type AnyStored, type SyncKind, type StoredSnapshot, type StoredTransaction,
} from "./db";

function metaFor(kind: string, rec: AnyStored): Record<string, unknown> | undefined {
  if (kind === "snapshot") {
    const s = rec as StoredSnapshot;
    return { accountId: s.accountId, at: s.at };
  }
  if (kind === "transaction") return { at: (rec as StoredTransaction).at };
  return undefined;
}

function fromRecord(rec: SyncRecord): AnyStored {
  const base = {
    id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    deleted: rec.deleted, dirty: false, content: rec.content,
  };
  const m = rec.meta ?? {};
  if (rec.kind === "snapshot") {
    return { ...base, accountId: String(m.accountId ?? ""), at: Number(m.at ?? rec.createdAt) } as StoredSnapshot;
  }
  if (rec.kind === "transaction") return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredTransaction;
  return base as AnyStored;
}

const engine = createSyncEngine<AnyStored>({
  async collectDirty() {
    const d = await dirtyRecords();
    return [
      ...d.accounts.map((rec) => ({ kind: "account", rec })),
      ...d.snapshots.map((rec) => ({ kind: "snapshot", rec })),
      ...d.transactions.map((rec) => ({ kind: "transaction", rec })),
      ...d.goals.map((rec) => ({ kind: "goal", rec })),
    ];
  },
  getByKind: (kind, id) => getStoredByKind(kind as SyncKind, id),
  putByKind: (kind, rec) => putStoredByKind(kind as SyncKind, rec),
  clearDirty: (kind, id, updatedAt) => clearDirtyByKind(kind as SyncKind, id, updatedAt),
  async getCursor() {
    return (await getSyncState())?.cursor ?? 0;
  },
  async saveCursor(cursor, token) {
    const st = await getSyncState();
    await saveSyncState({ ...(st ?? { id: "state" }), id: "state", cursor, token });
  },
  metaFor,
  fromRecord,
  push: (token, changes) => pushChanges(token, changes as unknown as ApiRecord[]),
  pull: (token, since) => pullChanges(token, since),
});

export const pull = engine.pull;
export const push = engine.push;
export const syncNow = engine.syncNow;
