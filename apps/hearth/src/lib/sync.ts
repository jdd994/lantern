// sync.ts — Hearth's binding to the shared reconcile engine (@lantern/core/sync).
// The engine does the reconcile; this supplies Hearth's kinds, the `meta` a food
// log and a metric keep outside the ciphertext (their `at`), the store access,
// and the network calls.
import { createSyncEngine, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges } from "./api";
import {
  dirtyRecords, getStoredByKind, putStoredByKind, clearDirtyByKind, getSyncState, saveSyncState,
  type AnyStored, type SyncKind, type StoredFoodLog, type StoredMetric, type StoredMealPlan,
  type StoredRun,
} from "./db";

// `at` lives OUTSIDE the ciphertext (it's the day/time the record belongs to), so
// it must travel as meta and be put back on the way in. A kind with an `at` that
// isn't listed here loses its day on the round trip.
function metaFor(kind: string, rec: AnyStored): Record<string, unknown> | undefined {
  if (kind === "foodLog") return { at: (rec as StoredFoodLog).at };
  if (kind === "metric") return { at: (rec as StoredMetric).at };
  if (kind === "mealPlan") return { at: (rec as StoredMealPlan).at };
  if (kind === "run") return { at: (rec as StoredRun).at };
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
  if (rec.kind === "mealPlan") return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredMealPlan;
  if (rec.kind === "run") return { ...base, at: Number(m.at ?? rec.createdAt) } as StoredRun;
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
      ...d.mealPlans.map((rec) => ({ kind: "mealPlan", rec })),
      ...d.pantry.map((rec) => ({ kind: "pantryItem", rec })),
      ...d.runs.map((rec) => ({ kind: "run", rec })),
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
