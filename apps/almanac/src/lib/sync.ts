// sync.ts — Almanac's binding to the shared reconcile engine (@lantern/core/sync).
// The engine does the reconcile; this supplies Almanac's kinds, the store
// access, and the network calls. Deliberately NO metaFor: nothing about a plan
// rides outside the ciphertext — not a title, not a date, not even which
// calendar a record belongs to. The server sees "record abc123, 180 bytes, updated at
// 14:22" and nothing else.
import { createSyncEngine, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges } from "./api";
import {
  dirtyRecords, getStoredByKind, putStoredByKind, clearDirtyByKind, getSyncState, saveSyncState,
  type AnyStored, type SyncKind,
} from "./db";

function fromRecord(rec: SyncRecord): AnyStored {
  return {
    id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    deleted: rec.deleted, dirty: false, content: rec.content,
  };
}

const engine = createSyncEngine<AnyStored>({
  collectDirty: () => dirtyRecords(),
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
  metaFor: () => undefined,
  fromRecord,
  push: pushChanges,
  pull: pullChanges,
});

export const pull = engine.pull;
export const push = engine.push;

export async function syncNow(token: string): Promise<boolean> {
  const changed = await engine.pull(token);
  await engine.push(token);
  return changed;
}
