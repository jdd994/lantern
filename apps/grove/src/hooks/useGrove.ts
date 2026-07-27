// useGrove — the ONLY place state, IO, and the decrypted key meet (the same
// seam as useHearth/useJournal). The DEK lives in a ref, never React state,
// never storage. Everything below it is either pure (lib/model) or ciphertext
// (lib/db).

import { useCallback, useEffect, useRef, useState } from "react";
import { createVault as makeVault, openVault } from "@lantern/core/vault";
import { VERIFIER_TEXT, encryptString, decryptString } from "../lib/crypto";
import * as db from "../lib/db";
import {
  decodeKeepsake,
  decodePerson,
  decodeUnion,
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

export function useGrove() {
  const [status, setStatus] = useState<Status>("loading");
  const [people, setPeople] = useState<Person[]>([]);
  const [unions, setUnions] = useState<Union[]>([]);
  const [keepsakes, setKeepsakes] = useState<Keepsake[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const keyRef = useRef<CryptoKey | null>(null);

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
