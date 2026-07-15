// sync.ts — the shared reconcile engine.
//
// Moves ciphertext between a device and the server; it never needs the passphrase
// or the key (that's the design). Pull applies remote records last-write-wins by
// updatedAt; push uploads the dirty set in chunks and clears the flags. The engine
// itself is app-agnostic — everything app-specific (which kinds exist, which
// plaintext fields ride outside the ciphertext as `meta`, how to read/write each
// store, the network calls) is supplied by an adapter. Media, or any extra step,
// stays in the app: it composes its own syncNow from `pull` + `push`.

import type { CipherBlob } from "./crypto";

// A record on the wire: opaque content + optional non-secret `meta` the server
// stores and returns unread.
export type SyncRecord = {
  kind: string;
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  content: CipherBlob;
  meta?: Record<string, unknown>;
};

// The minimum the engine needs from a stored record.
export type Syncable = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  content: CipherBlob;
};

export type PullResult = { changes: SyncRecord[]; cursor: number; more: boolean };

export type SyncAdapter<Rec extends Syncable> = {
  // Every dirty record, tagged with its kind.
  collectDirty(): Promise<Array<{ kind: string; rec: Rec }>>;
  getByKind(kind: string, id: string): Promise<Rec | undefined>;
  putByKind(kind: string, rec: Rec): Promise<void>;
  clearDirty(kind: string, id: string, updatedAt: number): Promise<void>;
  // Pull cursor. saveCursor persists it (the app preserves any other sync state).
  getCursor(): Promise<number>;
  saveCursor(cursor: number, token: string): Promise<void>;
  // Non-secret plaintext this kind keeps outside the ciphertext (or undefined).
  metaFor(kind: string, rec: Rec): Record<string, unknown> | undefined;
  // Rebuild a stored record from a pulled one (dirty:false).
  fromRecord(rec: SyncRecord): Rec;
  // Network.
  push(token: string, changes: SyncRecord[]): Promise<unknown>;
  pull(token: string, since: number): Promise<PullResult>;
};

// The server caps a push; stay under it.
export const PUSH_CHUNK = 500;

export function createSyncEngine<Rec extends Syncable>(a: SyncAdapter<Rec>) {
  function toRecord(kind: string, rec: Rec): SyncRecord {
    return {
      kind,
      id: rec.id,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      deleted: rec.deleted,
      content: rec.content,
      meta: a.metaFor(kind, rec),
    };
  }

  // Apply one remote record locally, last-write-wins. True if it changed anything.
  async function applyRemote(rec: SyncRecord): Promise<boolean> {
    const local = await a.getByKind(rec.kind, rec.id);
    if (local && rec.updatedAt <= local.updatedAt) return false;
    await a.putByKind(rec.kind, a.fromRecord(rec));
    return true;
  }

  // Pull everything past the cursor, apply it, advance the cursor.
  async function pull(token: string): Promise<boolean> {
    let cursor = await a.getCursor();
    let changed = false;
    for (;;) {
      const res = await a.pull(token, cursor);
      for (const rec of res.changes) if (await applyRemote(rec)) changed = true;
      cursor = res.cursor;
      if (!res.more) break;
    }
    await a.saveCursor(cursor, token);
    return changed;
  }

  // Upload the dirty set in chunks, then clear the flags.
  async function push(token: string): Promise<void> {
    const dirty = await a.collectDirty();
    const changes = dirty.map(({ kind, rec }) => toRecord(kind, rec));
    if (changes.length === 0) return;
    for (let i = 0; i < changes.length; i += PUSH_CHUNK) {
      await a.push(token, changes.slice(i, i + PUSH_CHUNK));
    }
    for (const ch of changes) await a.clearDirty(ch.kind, ch.id, ch.updatedAt);
  }

  // Full sync: pull first (others' changes), then push ours. Apps that need an
  // extra step (e.g. media) compose their own from pull + push instead.
  async function syncNow(token: string): Promise<boolean> {
    const changed = await pull(token);
    await push(token);
    return changed;
  }

  return { pull, push, syncNow };
}

// ---- Media upload (shared) ------------------------------------------------
// Photos are large, already-encrypted blobs that go to object storage rather
// than the record table, so they sync on their own path — but the pattern is the
// same for every app that has media (Driftless strands, Ballast receipts, and
// Hearth's food pics later): upload each dirty blob, clear its flag on success,
// best-effort per item so one failure never blocks the rest. Download stays lazy
// (per image, on demand), so it isn't part of this loop. An app composes this
// into its own syncNow after push().
export type MediaBlob = { id: string; iv: Uint8Array; data: ArrayBuffer; type: string };

export type MediaSyncAdapter = {
  dirtyMedia(): Promise<MediaBlob[]>;
  upload(token: string, id: string, iv: Uint8Array, data: ArrayBuffer, type: string): Promise<unknown>;
  clearDirty(id: string): Promise<void>;
};

export function createMediaSync(a: MediaSyncAdapter) {
  return async function pushMedia(token: string): Promise<void> {
    for (const m of await a.dirtyMedia()) {
      try {
        await a.upload(token, m.id, m.iv, m.data, m.type);
        await a.clearDirty(m.id);
      } catch {
        // Leave it dirty; a later sync retries. One dead upload never blocks the rest.
      }
    }
  };
}
