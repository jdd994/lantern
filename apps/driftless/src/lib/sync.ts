// sync.ts — Driftless's binding to the shared reconcile engine (@lantern/core/sync).
// Entries and strands flow through the one engine (no `meta` — they keep nothing
// outside the ciphertext). Photos are large encrypted blobs on their own path, so
// syncNow composes the engine's pull + push with the shared media upload.
import { createSyncEngine, createMediaSync, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges, uploadMedia } from "./api";
import {
  dirtyEntries, dirtyStrands, dirtyDayNotes, dirtyMedia,
  clearEntryDirty, clearStrandDirty, clearDayNoteDirty, clearMediaDirty,
  getStoredEntry, getStoredStrand, getStoredDayNote,
  putStoredEntry, putStoredStrand, putStoredDayNote,
  getSyncState, saveSyncState,
  type StoredEntry, type StoredStrand, type StoredDayNote,
} from "./db";

type SyncedRecord = StoredEntry | StoredStrand | StoredDayNote;

const engine = createSyncEngine<SyncedRecord>({
  async collectDirty() {
    const [entries, strands, dayNotes] = await Promise.all([
      dirtyEntries(),
      dirtyStrands(),
      dirtyDayNotes(),
    ]);
    return [
      ...entries.map((rec) => ({ kind: "entry", rec })),
      ...strands.map((rec) => ({ kind: "strand", rec })),
      ...dayNotes.map((rec) => ({ kind: "dayNote", rec })),
    ];
  },
  getByKind: (kind, id) =>
    kind === "entry" ? getStoredEntry(id) : kind === "strand" ? getStoredStrand(id) : getStoredDayNote(id),
  putByKind: (kind, rec) =>
    kind === "entry"
      ? putStoredEntry(rec as StoredEntry)
      : kind === "strand"
        ? putStoredStrand(rec as StoredStrand)
        : putStoredDayNote(rec as StoredDayNote),
  clearDirty: (kind, id, updatedAt) =>
    kind === "entry"
      ? clearEntryDirty(id, updatedAt)
      : kind === "strand"
        ? clearStrandDirty(id, updatedAt)
        : clearDayNoteDirty(id, updatedAt),
  async getCursor() {
    return (await getSyncState())?.cursor ?? 0;
  },
  async saveCursor(cursor, token) {
    const st = await getSyncState();
    await saveSyncState({ ...(st ?? { id: "state" }), id: "state", cursor, token });
  },
  metaFor: () => undefined,
  fromRecord: (rec: SyncRecord): SyncedRecord => ({
    id: rec.id,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    deleted: rec.deleted,
    dirty: false,
    content: rec.content,
  }),
  push: pushChanges,
  pull: pullChanges,
});

export const pull = engine.pull;
export const push = engine.push;

// Shared media upload, wired to Driftless's stores + R2 endpoint.
export const pushMedia = createMediaSync({
  dirtyMedia,
  upload: uploadMedia,
  clearDirty: clearMediaDirty,
});

// Full sync: others' changes, then ours, then any pending photos.
export async function syncNow(token: string): Promise<boolean> {
  const changed = await engine.pull(token);
  await engine.push(token);
  await pushMedia(token);
  return changed;
}
