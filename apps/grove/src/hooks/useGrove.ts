// useGrove — the ONLY place state, IO, and the decrypted key meet (the same
// seam as useHearth/useJournal). The DEK lives in a ref, never React state,
// never storage. Everything below it is either pure (lib/model) or ciphertext
// (lib/db).

import { useCallback, useEffect, useRef, useState } from "react";
import { createVault as makeVault, openVault } from "@lantern/core/vault";
import { VERIFIER_TEXT, encryptString, decryptString, encryptBytes, decryptBytes } from "../lib/crypto";
import * as db from "../lib/db";
import { bytesToBase64, prepareKeepsakeFile } from "../lib/media";
import {
  decodeKeepsake,
  decodePerson,
  decodeUnion,
  encodeKeepsake,
  encodePerson,
  encodeUnion,
  linkRelative,
  uid,
  type Keepsake,
  type Person,
  type Relation,
  type ChildLink,
  type Union,
} from "../lib/model";

export type Status = "loading" | "setup" | "locked" | "unlocked";
export type SaveError = { message: string; retry: () => void };

// A new person as the add flows describe one — the hook fills in id/timestamps.
export type PersonDraft = Omit<Person, "id" | "createdAt" | "updatedAt">;
// A new keepsake, likewise — the media file travels separately.
export type KeepsakeDraft = Omit<Keepsake, "id" | "createdAt" | "updatedAt" | "mediaId">;

export function useGrove() {
  const [status, setStatus] = useState<Status>("loading");
  const [people, setPeople] = useState<Person[]>([]);
  const [unions, setUnions] = useState<Union[]>([]);
  const [keepsakes, setKeepsakes] = useState<Keepsake[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const keyRef = useRef<CryptoKey | null>(null);
  const mediaUrls = useRef<Map<string, string>>(new Map()); // mediaId → data: URL (decrypted, in-memory only)

  useEffect(() => {
    void db.getVault().then((v) => setStatus(v ? "locked" : "setup"));
  }, []);

  const loadAll = useCallback(async (dek: CryptoKey) => {
    const decode = async <T,>(
      rows: Array<{ id: string; createdAt: number; updatedAt: number; deleted: boolean; content: Parameters<typeof decryptString>[1] }>,
      dec: (plain: string, shell: { id: string; createdAt: number; updatedAt: number }) => T
    ): Promise<T[]> => {
      const out: T[] = [];
      for (const s of rows) {
        if (s.deleted) continue;
        try {
          out.push(dec(await decryptString(dek, s.content), { id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt }));
        } catch {
          // A record that won't decrypt is corrupt bookkeeping, not the tree —
          // skip it rather than refuse the whole unlock.
        }
      }
      return out;
    };
    setPeople(await decode(await db.allPeople(), decodePerson));
    setUnions(await decode(await db.allUnions(), decodeUnion));
    setKeepsakes(await decode(await db.allKeepsakes(), decodeKeepsake));
  }, []);

  const setup = useCallback(async (passphrase: string) => {
    setBusy(true);
    setError(null);
    try {
      const { dek, secrets } = await makeVault(passphrase, VERIFIER_TEXT);
      await db.saveVault({ id: "vault", createdAt: Date.now(), ...secrets });
      keyRef.current = dek;
      setStatus("unlocked");
      void requestDurableStorage();
    } finally {
      setBusy(false);
    }
  }, []);

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const v = await db.getVault();
        if (!v) {
          setStatus("setup");
          return false;
        }
        const opened = await openVault(passphrase, v, VERIFIER_TEXT);
        if (!opened) {
          setError("That's not it — try again.");
          return false;
        }
        keyRef.current = opened.dek;
        await loadAll(opened.dek);
        setStatus("unlocked");
        void requestDurableStorage();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [loadAll]
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    mediaUrls.current.clear(); // free decrypted scans from memory with the key
    setPeople([]);
    setUnions([]);
    setKeepsakes([]);
    setError(null);
    setSaveError(null);
    setStatus("locked");
  }, []);

  // Optimistic-then-persist, like the siblings: memory updates first so the
  // tree feels instant; a failed write surfaces a retry, never a silent loss.
  const guardedPersist = useCallback((persist: () => Promise<void>) => {
    const run = () => {
      setSaveError(null);
      persist().catch(() => {
        setSaveError({ message: "Couldn't save to this device — nothing was lost from view.", retry: run });
      });
    };
    run();
  }, []);

  const persistPerson = useCallback(
    (p: Person) => {
      const key = keyRef.current;
      if (!key) return;
      guardedPersist(async () => {
        const content = await encryptString(key, encodePerson(p));
        await db.putPerson({ id: p.id, createdAt: p.createdAt, updatedAt: p.updatedAt, deleted: false, dirty: true, content });
      });
    },
    [guardedPersist]
  );

  const persistUnion = useCallback(
    (u: Union) => {
      const key = keyRef.current;
      if (!key) return;
      guardedPersist(async () => {
        const content = await encryptString(key, encodeUnion(u));
        await db.putUnion({ id: u.id, createdAt: u.createdAt, updatedAt: u.updatedAt, deleted: false, dirty: true, content });
      });
    },
    [guardedPersist]
  );

  const addPerson = useCallback(
    (draft: PersonDraft): string => {
      const now = Date.now();
      const p: Person = { ...draft, id: uid(), createdAt: now, updatedAt: now };
      setPeople((prev) => [...prev, p]);
      persistPerson(p);
      return p.id;
    },
    [persistPerson]
  );

  const updatePerson = useCallback(
    (id: string, patch: Partial<PersonDraft>) => {
      setPeople((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const next = { ...p, ...patch, updatedAt: Date.now() };
          persistPerson(next);
          return next;
        })
      );
    },
    [persistPerson]
  );

  const persistKeepsake = useCallback(
    (k: Keepsake, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      guardedPersist(async () => {
        const content = await encryptString(key, encodeKeepsake(k));
        await db.putKeepsake({ id: k.id, createdAt: k.createdAt, updatedAt: k.updatedAt, deleted, dirty: true, content });
      });
    },
    [guardedPersist]
  );

  // Attach a keepsake: encrypt the scan (if any) and the record together, so a
  // treasure never lands half-here. The file is prepared first — a preparation
  // failure (unreadable HEIC, oversized PDF) surfaces with a retry and nothing
  // is stored.
  const addKeepsake = useCallback(
    async (draft: KeepsakeDraft, file?: File): Promise<void> => {
      const key = keyRef.current;
      if (!key) return;
      let mediaId: string | undefined;
      if (file) {
        let prepared: { bytes: ArrayBuffer; type: string };
        try {
          prepared = await prepareKeepsakeFile(file);
        } catch (e) {
          setSaveError({
            message: e instanceof Error ? e.message : "Couldn't read that file.",
            retry: () => void addKeepsake(draft, file),
          });
          return;
        }
        const cb = await encryptBytes(key, prepared.bytes);
        mediaId = uid();
        try {
          await db.putMedia({ id: mediaId, type: prepared.type, createdAt: Date.now(), iv: cb.iv, data: cb.data, deleted: false, dirty: true });
        } catch {
          setSaveError({ message: "Couldn't save that scan to this device.", retry: () => void addKeepsake(draft, file) });
          return;
        }
      }
      const now = Date.now();
      const k: Keepsake = { ...draft, mediaId, id: uid(), createdAt: now, updatedAt: now };
      setKeepsakes((prev) => [...prev, k]);
      persistKeepsake(k);
    },
    [persistKeepsake]
  );

  // Removing a treasure is deliberate but honest: tombstones for the record
  // and its scan (so the removal syncs later), decrypted bytes dropped now.
  const removeKeepsake = useCallback(
    (k: Keepsake) => {
      setKeepsakes((prev) => prev.filter((x) => x.id !== k.id));
      persistKeepsake({ ...k, updatedAt: Date.now() }, true);
      if (k.mediaId) {
        const mediaId = k.mediaId;
        mediaUrls.current.delete(mediaId);
        void db.deleteMedia(mediaId);
      }
    },
    [persistKeepsake]
  );

  // Decrypt a stored scan to an in-memory data: URL (cached; a data: URL, not
  // blob:, so it displays under a strict CSP). Null if the media isn't on this
  // device — e.g. added on another device, before media sync lands.
  const getMediaUrl = useCallback(async (id: string): Promise<string | null> => {
    const cached = mediaUrls.current.get(id);
    if (cached) return cached;
    const key = keyRef.current;
    if (!key) return null;
    const m = await db.getMedia(id);
    if (!m || m.deleted) return null;
    try {
      const bytes = await decryptBytes(key, { iv: m.iv, data: m.data });
      const url = `data:${m.type};base64,${bytesToBase64(bytes)}`;
      mediaUrls.current.set(id, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  // Add a relative and place them in one gesture — the person and their
  // union link land together, so nobody is ever added invisibly.
  const addRelative = useCallback(
    (anchorId: string, relation: Relation, draft: PersonDraft, childKind?: ChildLink["kind"]): string => {
      const now = Date.now();
      const p: Person = { ...draft, id: uid(), createdAt: now, updatedAt: now };
      setPeople((prev) => [...prev, p]);
      persistPerson(p);
      setUnions((prev) => {
        const upserts = linkRelative(anchorId, p.id, relation, prev, childKind, now);
        for (const u of upserts) persistUnion(u);
        const changed = new Set(upserts.map((u) => u.id));
        return [...prev.filter((u) => !changed.has(u.id)), ...upserts];
      });
      return p.id;
    },
    [persistPerson, persistUnion]
  );

  return {
    status,
    people,
    unions,
    keepsakes,
    busy,
    error,
    saveError,
    setup,
    unlock,
    lock,
    addPerson,
    updatePerson,
    addRelative,
    addKeepsake,
    removeKeepsake,
    getMediaUrl,
  };
}

// Ask the browser not to evict the vault under storage pressure. Best-effort;
// declining is fine, losing a family's tree to eviction is not.
async function requestDurableStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // unsupported — nothing to do
  }
}
