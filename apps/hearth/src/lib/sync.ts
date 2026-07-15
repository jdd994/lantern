// sync.ts — Hearth's binding to the shared reconcile engine (@lantern/core/sync).
// The engine does the reconcile; this supplies Hearth's kinds, the `meta` a food
// log and a metric keep outside the ciphertext (their `at`), the store access,
// and the network calls.
import { createSyncEngine, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges } from "./api";
import {
  dirtyRecords, getStoredByKind, putStoredByKind, clearDirtyByKind, getSyncState, saveSyncState,
  type AnyStored, type SyncKind, type StoredFoodLog, type StoredMetric,
} from "./db";

function metaFor(kind: string, rec: AnyStored): Record<string, unknown> | undefined {
  if (kind === "foodLog") return { at: (rec as StoredFoodLog).at };
  if (kind === "metric") return { at: (rec as StoredMetric).at };
  return undefined;
}

function fromRecord(rec: SyncRecord): AnyStored {
  const base = {
    id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    deleted: rec.deleted, dirty: false, content: rec.content,
  };
  const m = rec.meta ?? {};
  if (rec.kind === "foodLog") return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredFoodLog;
  if (rec.kind === "metric") return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredMetric;
  return base as AnyStored;
}

const engine = createSyncEngine<AnyStored>({
  async collectDirty() {
    const d = await dirtyRecords();
    return [
      ...d.foodLogs.map((rec) => ({ kind: "foodLog", rec })),
      ...d.metrics.map((rec) => ({ kind: "metric", rec })),
      ...d.goals.map((rec) => ({ kind: "goal", rec })),
      ...d.recipes.map((rec) => ({ kind: "recipe", rec })),
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
  push: pushChanges,
  pull: pullChanges,
});

export const pull = engine.pull;
export const push = engine.push;
export const syncNow = engine.syncNow;
