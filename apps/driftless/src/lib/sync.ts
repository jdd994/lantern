// sync.ts — Driftless's binding to the shared reconcile engine (@lantern/core/sync).
// Entries and strands flow through the one engine (no `meta` — they keep nothing
// outside the ciphertext). Photos are large encrypted blobs on their own path, so
// syncNow composes the engine's pull + push with the shared media upload.
import { createSyncEngine, createMediaSync, type SyncRecord } from "@lantern/core/sync";
import { pushChanges, pullChanges, uploadMedia, type SyncRecord as ApiRecord } from "./api";
import {
  dirtyEntries, dirtyStrands, dirtyMedia,
  clearEntryDirty, clearStrandDirty, clearMediaDirty,
  getStoredEntry, getStoredStrand, putStoredEntry, putStoredStrand,
  getSyncState, saveSyncState,
  type StoredEntry, type StoredStrand,
} from "./db";

type EntryOrStrand = StoredEntry | StoredStrand;

const engine = createSyncEngine<EntryOrStrand>({
  async collectDirty() {
    const [entries, strands] = await Promise.all([dirtyEntries(), dirtyStrands()]);
    return [
      ...entries.map((rec) => ({ kind: "entry", rec })),
      ...strands.map((rec) => ({ kind: "strand", rec })),
    ];
  },
  getByKind: (kind, id) => (kind === "entry" ? getStoredEntry(id) : getStoredStrand(id)),
  putByKind: (kind, rec) =>
    kind === "entry" ? putStoredEntry(rec as StoredEntry) : putStoredStrand(rec as StoredStrand),
  clearDirty: (kind, id, updatedAt) =>
    kind === "entry" ? clearEntryDirty(id, updatedAt) : clearStrandDirty(id, updatedAt),
  async getCursor() {
    return (await getSyncState())?.cursor ?? 0;
  },
  async saveCursor(cursor, token) {
    const st = await getSyncState();
    await saveSyncState({ ...(st ?? { id: "state" }), id: "state", cursor, token });
  },
  metaFor: () => undefined,
  fromRecord: (rec: SyncRecord): EntryOrStrand => ({
    id: rec.id,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    deleted: rec.deleted,
    dirty: false,
    content: rec.content,
  }),
  push: (token, changes) => pushChanges(token, changes as unknown as ApiRecord[]),
  pull: (token, since) => pullChanges(token, since),
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
