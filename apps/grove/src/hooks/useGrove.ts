// useGrove — the ONLY place state, IO, and the decrypted key meet (the same
// seam as useHearth/useJournal). The DEK lives in a ref, never React state,
// never storage. Everything below it is either pure (lib/model), ciphertext
// (lib/db), or ciphertext-in-motion (lib/api, lib/sync).
//
// Two secrets, two jobs — the family invariant: the account says WHOSE
// ciphertext this is; the passphrase decrypts it and never leaves the device.
//
// The shared tree: one co-authored family tree, riding the same shared-strand
// machinery as Driftless's strands and Hearth's kitchens. Its records merge
// into this device's local vault (LWW by updatedAt), so your account always
// keeps your own encrypted copy of what the family wrote together. Writes
// mirror to the tree best-effort; the personal channel is the offline-safe
// outbox, and the unplaced shelf catches any union that loses a race.

import { useCallback, useEffect, useRef, useState } from "react";
import { createVault as makeVault, openVault, rewrapVault, setPassphraseFromDEK } from "@lantern/core/vault";
import { importPublicKeyB64, wrapDEKForRecipient, unwrapDEK } from "@lantern/core/sharing";
import {
  VERIFIER_TEXT, encryptString, decryptString, encryptBytes, decryptBytes,
  generateDEK, generateIdentityKeypair, exportPublicKeyB64, exportPrivateKeyB64,
  importPrivateKeyB64, unwrapPrivateKey, sealJSON, openJSON, PBKDF2_ITERATIONS,
  createRecoveryCircle, approveAsGuardian, reconstructDEK,
} from "../lib/crypto";
import * as db from "../lib/db";
import * as api from "../lib/api";
import { syncNow as engineSyncNow } from "../lib/sync";
import { bytesToBase64, prepareKeepsakeFile } from "../lib/media";
import { fromGedcom, toGedcom, type GedcomTree } from "../lib/gedcom";
import {
  decodeKeepsake,
  decodePerson,
  decodeUnion,
  encodeKeepsake,
  encodePerson,
  encodeUnion,
  linkRelative,
  uid,
  unlinkPerson,
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

// The family's co-authored tree, as this device sees it.
export type SharedTree = {
  strandId: string;
  ownerId: string;
  role: string;
  dekEpoch: number;
  title: string;
  members: api.StrandMember[];
};

type TreeMeta = { title: string };
const TREE_META_ID = "meta";
const TREE_KINDS = new Set(["person", "union", "keepsake"]);

export function useGrove() {
  const [status, setStatus] = useState<Status>("loading");
  const [people, setPeople] = useState<Person[]>([]);
  const [unions, setUnions] = useState<Union[]>([]);
  const [keepsakes, setKeepsakes] = useState<Keepsake[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  // ---- account & sync state ----
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ---- guardians & recovery state ----
  const [guardianCircle, setGuardianCircle] = useState<api.RecoveryCircleInfo | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<api.RecoveryStatus>(null);
  const [pendingGuardianRequests, setPendingGuardianRequests] = useState<api.PendingForMe[]>([]);

  // ---- the shared tree ----
  const [tree, setTree] = useState<SharedTree | null>(null);
  const [treeBusy, setTreeBusy] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null); // sync auth token — NOT the encryption key
  const myUserIdRef = useRef<string | null>(null);
  const identityRef = useRef<CryptoKeyPair | null>(null);
  const treeKeys = useRef<Map<string, { dek: CryptoKey; dekEpoch: number }>>(new Map());
  const treeRef = useRef<SharedTree | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTreeRef = useRef<(() => Promise<void>) | null>(null); // breaks the runSync↔syncTree declaration cycle
  const mediaUrls = useRef<Map<string, string>>(new Map()); // mediaId → data: URL (decrypted, in-memory only)

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    void (async () => {
      const v = await db.getVault();
      const st = await db.getSyncState();
      if (st?.token) {
        tokenRef.current = st.token;
        setAccount(st.accountEmail ?? null);
        void api.fetchMe(st.token).then(({ userId }) => (myUserIdRef.current = userId)).catch(() => {});
      }
      setStatus(v ? "locked" : "setup");
    })();
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

  // ---- sync ----------------------------------------------------------------

  const runSync = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const changed = await engineSyncNow(token);
      if (changed) await loadAll(key);
    } catch (e) {
      // Never fatal: dirty records stay dirty and go next time.
      setSyncError(e instanceof Error ? e.message : "Couldn't sync just now.");
    } finally {
      setSyncing(false);
    }
    // Family freshness rides personal sync: every pass also checks the shared
    // tree. Converges — a merge marks records dirty once, the next pass finds
    // nothing new.
    void syncTreeRef.current?.();
  }, [loadAll]);

  // Debounced after every write, so edits batch up instead of chattering.
  const scheduleSync = useCallback(() => {
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(), 1500);
  }, [runSync]);

  // ---- guardians & recovery (read surfaces; setup lives after identity) ----

  const loadGuardianCircle = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      setGuardianCircle(await api.fetchCircle(token));
    } catch {
      setGuardianCircle(null); // none configured (404), or offline
    }
  }, []);

  const refreshRecoveryStatus = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { request } = await api.fetchRecoveryStatus(token);
      setRecoveryStatus(request);
    } catch {
      // offline / transient
    }
  }, []);

  const refreshPendingGuardianRequests = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { requests } = await api.fetchPendingForMe(token);
      setPendingGuardianRequests(requests);
    } catch {
      // offline / transient
    }
  }, []);

  // ---- identity -------------------------------------------------------------
  // The identity keypair, unwrapped with the vault key. It's what makes the
  // tree's key deliverable to you and to nobody else.
  const ensureIdentity = useCallback(async (): Promise<CryptoKeyPair | null> => {
    if (identityRef.current) return identityRef.current;
    const key = keyRef.current;
    const vault = await db.getVault();
    if (!key || !vault?.identityPublic || !vault?.identityPrivate) return null;
    try {
      identityRef.current = {
        publicKey: await importPublicKeyB64(vault.identityPublic),
        privateKey: await unwrapPrivateKey(key, vault.identityPrivate),
      };
      return identityRef.current;
    } catch {
      return null;
    }
  }, []);

  // ---- the shared tree -------------------------------------------------------

  // Merge one decrypted tree record into the local vault, LWW by updatedAt.
  // Re-encrypted under MY vault key with dirty:true, so my own account keeps a
  // copy of what the family wrote. Never echoes back to the tree — only
  // deliberate writes push there.
  const mergeTreeRecord = useCallback(
    async (kind: db.SyncKind, rec: { id: string; createdAt: number; updatedAt: number; deleted: boolean }, payload: string): Promise<boolean> => {
      const key = keyRef.current;
      if (!key) return false;
      const local = await db.getStoredByKind(kind, rec.id);
      if (local && local.updatedAt >= rec.updatedAt) return false;
      await db.putStoredByKind(kind, {
        id: rec.id,
        createdAt: local?.createdAt ?? rec.createdAt,
        updatedAt: rec.updatedAt,
        deleted: rec.deleted,
        dirty: true,
        content: await encryptString(key, payload),
      });
      return true;
    },
    []
  );

  const syncTree = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    const kp = await ensureIdentity();
    if (!kp) return;
    setTreeBusy(true);
    setTreeError(null);
    try {
      const { strands } = await api.sharedMine(token);
      // One family tree for now; further trees would need their own view.
      const s = strands[0];
      if (!s) {
        setTree(null);
        return;
      }
      let entry = treeKeys.current.get(s.strandId);
      // New to us, or re-keyed because someone was removed — unwrap our copy again.
      if (!entry || entry.dekEpoch !== s.dekEpoch) {
        try {
          entry = { dek: await unwrapDEK(kp.privateKey, s.ephemeralPub, s.wrappedDEK), dekEpoch: s.dekEpoch };
          treeKeys.current.set(s.strandId, entry);
        } catch {
          return; // can't unwrap our copy — skip rather than guess
        }
      }
      const { changes } = await api.sharedPull(token, s.strandId, 0);
      let title = "Our tree";
      let merged = false;
      for (const ch of changes) {
        try {
          if (ch.kind === TREE_META_ID) {
            if (!ch.deleted) title = (await openJSON<TreeMeta>(entry.dek, ch.content)).title || title;
          } else if (TREE_KINDS.has(ch.kind)) {
            const payload = await decryptString(entry.dek, ch.content);
            if (await mergeTreeRecord(ch.kind as db.SyncKind, ch, payload)) merged = true;
          }
        } catch {
          // one unreadable record shouldn't blank the whole tree
        }
      }
      let members: api.StrandMember[] = [];
      try {
        members = (await api.sharedMembers(token, s.strandId)).members;
      } catch {
        // membership list is a nicety; the tree still renders
      }
      setTree({ strandId: s.strandId, ownerId: s.ownerId, role: s.role, dekEpoch: s.dekEpoch, title, members });
      if (merged) {
        await loadAll(key);
        scheduleSync(); // the merged family records back up to my own account too
      }
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : "Couldn't reach the family tree just now.");
    } finally {
      setTreeBusy(false);
    }
  }, [ensureIdentity, mergeTreeRecord, loadAll, scheduleSync]);

  useEffect(() => {
    syncTreeRef.current = syncTree;
  }, [syncTree]);

  // Mirror one record to the shared tree, best-effort — the personal channel
  // is the outbox of record; a failed mirror is healed by the next syncTree.
  const pushToTree = useCallback(
    (kind: db.SyncKind, rec: { id: string; createdAt: number; updatedAt: number }, payload: string, deleted = false) => {
      const token = tokenRef.current;
      const t = treeRef.current;
      const entry = t ? treeKeys.current.get(t.strandId) : undefined;
      if (!token || !t || !entry) return;
      void (async () => {
        try {
          await api.sharedPush(token, t.strandId, [{
            kind,
            id: rec.id,
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
            deleted,
            dekEpoch: entry.dekEpoch,
            content: await encryptString(entry.dek, payload),
          }]);
        } catch {
          // offline / transient — the record is safe locally and in the
          // personal channel; the family sees it after the next mirror.
        }
      })();
    },
    []
  );

  // Push everything local into a tree — used once at planting, so the family
  // starts from your whole tree, not an empty one.
  const pushAllToTree = useCallback(async (strandId: string, dek: CryptoKey, dekEpoch: number) => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    const changes: api.SharedRecord[] = [];
    for (const kind of db.SYNC_KINDS) {
      for (const rec of kind === "person" ? await db.allPeople() : kind === "union" ? await db.allUnions() : await db.allKeepsakes()) {
        if (rec.deleted) continue;
        try {
          const payload = await decryptString(key, rec.content);
          changes.push({
            kind, id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
            deleted: false, dekEpoch, content: await encryptString(dek, payload),
          });
        } catch {
          // skip what won't decrypt; it can't be shared honestly
        }
      }
    }
    for (let i = 0; i < changes.length; i += 100) {
      await api.sharedPush(token, strandId, changes.slice(i, i + 100));
    }
  }, []);

  const createTree = useCallback(
    async (title: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Connect an account first — the tree is shared through it.";
      const kp = await ensureIdentity();
      if (!kp) return "This vault has no identity key. Re-create it to share.";
      setTreeBusy(true);
      setTreeError(null);
      try {
        const dek = await generateDEK();
        const strandId = uid();
        const mine = await wrapDEKForRecipient(await exportPublicKeyB64(kp.publicKey), dek);
        await api.createShared(token, strandId, mine.ephemeralPub, mine.wrappedDEK);
        treeKeys.current.set(strandId, { dek, dekEpoch: 1 });
        const now = Date.now();
        await api.sharedPush(token, strandId, [{
          kind: TREE_META_ID, id: TREE_META_ID, createdAt: now, updatedAt: now,
          deleted: false, dekEpoch: 1,
          content: await sealJSON(dek, { title: title.trim() || "Our tree" } as TreeMeta),
        }]);
        await pushAllToTree(strandId, dek, 1);
        await syncTree();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't plant the shared tree.";
      } finally {
        setTreeBusy(false);
      }
    },
    [ensureIdentity, pushAllToTree, syncTree]
  );

  // Invite by an address you already know — there's no directory to browse. We
  // fetch their public key and wrap THE TREE's key to it; the server only ever
  // relays the wrapped copy.
  const inviteToTree = useCallback(async (email: string): Promise<string | null> => {
    const token = tokenRef.current;
    const t = treeRef.current;
    const entry = t ? treeKeys.current.get(t.strandId) : undefined;
    if (!token || !t || !entry) return "The tree isn't ready yet.";
    setTreeBusy(true);
    try {
      const em = email.trim().toLowerCase();
      const { identityPublicKey } = await api.fetchKeys(token, em);
      if (!identityPublicKey) return "They have an account, but no key to share with yet — ask them to open Grove once.";
      const wrapped = await wrapDEKForRecipient(identityPublicKey, entry.dek);
      await api.inviteToStrand(token, t.strandId, em, wrapped.ephemeralPub, wrapped.wrappedDEK, entry.dekEpoch);
      await syncTree();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't invite them just now.";
    } finally {
      setTreeBusy(false);
    }
  }, [syncTree]);

  const leaveTree = useCallback(async (): Promise<string | null> => {
    const token = tokenRef.current;
    const t = treeRef.current;
    if (!token || !t) return "No shared tree to leave.";
    try {
      await api.sharedLeave(token, t.strandId);
      treeKeys.current.delete(t.strandId);
      setTree(null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't leave just now.";
    }
  }, []);

  // ---- unlock lifecycle ------------------------------------------------------

  const finishUnlock = useCallback(
    async (dek: CryptoKey) => {
      keyRef.current = dek;
      await loadAll(dek);
      setStatus("unlocked");
      void requestDurableStorage();
      if (tokenRef.current) {
        void runSync().then(() => void syncTree());
        void loadGuardianCircle();
        void refreshRecoveryStatus();
        void refreshPendingGuardianRequests();
      }
    },
    [loadAll, runSync, syncTree, loadGuardianCircle, refreshRecoveryStatus, refreshPendingGuardianRequests]
  );

  const setup = useCallback(async (passphrase: string) => {
    setBusy(true);
    setError(null);
    try {
      const { dek, secrets } = await makeVault(passphrase, VERIFIER_TEXT);
      await db.saveVault({ id: "vault", createdAt: Date.now(), ...secrets });
      await finishUnlock(dek);
    } finally {
      setBusy(false);
    }
  }, [finishUnlock]);

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
        await finishUnlock(opened.dek);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [finishUnlock]
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    identityRef.current = null;
    treeKeys.current.clear();
    mediaUrls.current.clear(); // free decrypted scans from memory with the key
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setPeople([]);
    setUnions([]);
    setKeepsakes([]);
    setTree(null);
    setError(null);
    setSaveError(null);
    setStatus("locked");
  }, []);

  // ---- account ---------------------------------------------------------------

  // Connect this device's existing vault to a NEW account. The vault envelope
  // (salt/verifier/wrappedDEK) travels; the passphrase never does.
  const connectCreate = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setSyncError(null);
      try {
        const vault = await db.getVault();
        if (!vault || !vault.identityPrivate) return false;
        const em = email.trim().toLowerCase();
        const { token, userId } = await api.register(
          em, password,
          { salt: vault.salt, verifier: vault.verifier, iterations: vault.iterations, wrappedDEK: vault.wrappedDEK },
          vault.identityPublic ?? "",
          vault.identityPrivate
        );
        tokenRef.current = token;
        myUserIdRef.current = userId;
        setAccount(em);
        const st = await db.getSyncState();
        await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0, token, accountEmail: em });
        await db.markAllDirty(); // the whole local tree uploads to the new account
        await runSync();
        return true;
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : "Couldn't create the account.");
        return false;
      }
    },
    [runSync]
  );

  // Sign in from another device: adopt the vault envelope from the server, so
  // the same passphrase re-derives the same key here.
  const connectSignIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setSyncError(null);
      try {
        const em = email.trim().toLowerCase();
        const { token, userId } = await api.login(em, password);
        const dto = await api.fetchVault(token);
        tokenRef.current = token;
        myUserIdRef.current = userId;
        setAccount(em);
        const local = await db.getVault();
        if (!local) {
          await db.saveVault({
            id: "vault",
            createdAt: Date.now(),
            salt: dto.salt,
            verifier: dto.verifier,
            iterations: dto.iterations ?? PBKDF2_ITERATIONS,
            wrappedDEK: dto.wrappedDEK ?? undefined,
            identityPublic: dto.identityPublicKey ?? undefined,
            identityPrivate: dto.identityPrivWrapped ?? undefined,
          });
          setStatus("locked"); // unlocking with the same passphrase pulls the tree down
        }
        await db.saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
        if (keyRef.current) {
          await runSync();
          void syncTree();
        }
        return true;
      } catch (e) {
        tokenRef.current = null;
        setAccount(null);
        setSyncError(e instanceof Error ? e.message : "Couldn't sign in.");
        return false;
      }
    },
    [runSync, syncTree]
  );

  const disconnect = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    tokenRef.current = null;
    myUserIdRef.current = null;
    setAccount(null);
    setTree(null);
    treeKeys.current.clear();
    const st = await db.getSyncState();
    await db.saveSyncState({ id: "state", cursor: st?.cursor ?? 0 });
  }, []);

  const deleteAccountFn = useCallback(async (): Promise<boolean> => {
    const token = tokenRef.current;
    if (!token) return false;
    setSyncing(true);
    setSyncError(null);
    try {
      await api.deleteAccount(token);
      await disconnect();
      return true;
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Couldn't delete the account.");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [disconnect]);

  // Change the passphrase: the DEK is re-wrapped, nothing is re-encrypted, and
  // if an account is connected the new envelope travels to the server too.
  const changePassphrase = useCallback(
    async (current: string, next: string): Promise<string | null> => {
      const dek = keyRef.current;
      if (!dek) return "Unlock the tree first.";
      const vault = await db.getVault();
      if (!vault) return "No vault on this device.";
      const fresh = await rewrapVault(dek, current, next, vault, VERIFIER_TEXT);
      if (!fresh) return "That current passphrase isn't right.";
      const updated = { ...vault, ...fresh };
      await db.saveVault(updated);
      const token = tokenRef.current;
      if (token) {
        try {
          await api.updateVault(token, {
            salt: updated.salt, verifier: updated.verifier,
            iterations: updated.iterations, wrappedDEK: updated.wrappedDEK!,
          });
        } catch {
          return "Changed on this device, but the server didn't update — sync when you're back online and try again.";
        }
      }
      return null;
    },
    []
  );

  // ---- guardians: setup & approvals (need the identity keypair) --------------

  // Configure (or rotate) K-of-N guardians. Each guardian's codeword must have
  // been told to them OUT LOUD, never typed anywhere but here.
  const setupGuardians = useCallback(
    async (guardians: { email: string; codeword: string }[], k: number, delayMs: number): Promise<string | null> => {
      const token = tokenRef.current;
      const dek = keyRef.current;
      if (!token || !dek) return "Unlock the tree first.";
      if (k < 2 || k > guardians.length) return "Pick at least 2, and no more than the number of guardians.";
      try {
        const resolved = await Promise.all(
          guardians.map(async (g) => {
            const em = g.email.trim().toLowerCase();
            const { identityPublicKey } = await api.fetchKeys(token, em);
            if (!identityPublicKey) throw new Error(`${em} doesn't have an account yet.`);
            return { userId: em, identityPublicKey, codeword: g.codeword };
          })
        );
        const circle = await createRecoveryCircle(dek, resolved, { k, n: resolved.length, delayMs });
        const entries: api.GuardianEntry[] = circle.shares.map((s) => ({
          email: s.userId,
          shareIndex: s.shareIndex,
          ephemeralPub: s.ephemeralPub,
          wrapped: s.wrapped,
          codewordSalt: s.codewordSalt,
          codewordIterations: s.codewordIterations,
        }));
        await api.setCircle(token, k, resolved.length, delayMs, circle.recoveryWrappedDEK, entries);
        await loadGuardianCircle();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't set up guardians.";
      }
    },
    [loadGuardianCircle]
  );

  // Help a family member: unwrap my share (needs my identity key AND the
  // codeword they told me out loud), re-wrap it to their device, submit.
  const approveGuardianRequest = useCallback(
    async (requestId: string, codeword: string): Promise<string | null> => {
      const token = tokenRef.current;
      const entry = pendingGuardianRequests.find((r) => r.requestId === requestId);
      if (!token || !entry) return "That request isn't open anymore.";
      const kp = await ensureIdentity();
      if (!kp) return "Unlock the tree first.";
      try {
        const wrappedShareForRequester = await approveAsGuardian(kp.privateKey, entry.myShare, codeword, entry.sessionPub);
        await api.approveRecovery(token, requestId, wrappedShareForRequester);
        await refreshPendingGuardianRequests();
        return null;
      } catch {
        return "That codeword isn't right.";
      }
    },
    [pendingGuardianRequests, refreshPendingGuardianRequests, ensureIdentity]
  );

  const cancelPendingRecovery = useCallback(async (): Promise<string | null> => {
    const token = tokenRef.current;
    const requestId = recoveryStatus?.requestId;
    if (!token || !requestId) return "No pending request.";
    try {
      await api.cancelRecoveryRequest(token, requestId);
      await refreshRecoveryStatus();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't cancel it.";
    }
  }, [recoveryStatus, refreshRecoveryStatus]);

  // ---- recovery: the locked-out side ------------------------------------------

  // Start a request: a fresh throwaway session keypair, saved locally in the
  // clear (this device only — see db.ts's RecoverySession), then ask the
  // server to open the request so guardians can see it.
  const startRecoveryRequest = useCallback(async (): Promise<
    { requestId: string; k: number; n: number; delayMs: number; guardianEmails: string[] } | string
  > => {
    const token = tokenRef.current;
    if (!token) return "Sign in to your account first.";
    try {
      const session = await generateIdentityKeypair();
      const publicKeyB64 = await exportPublicKeyB64(session.publicKey);
      const privateKeyPkcs8B64 = await exportPrivateKeyB64(session.privateKey);
      const result = await api.startRequest(token, publicKeyB64);
      await db.saveRecoverySession({ id: "session", requestId: result.requestId, publicKeyB64, privateKeyPkcs8B64 });
      return result;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't start recovery.";
    }
  }, []);

  const pollRecoveryRequest = useCallback(async (requestId: string) => {
    const token = tokenRef.current;
    if (!token) return null;
    try {
      return await api.fetchRecoveryRequest(token, requestId);
    } catch {
      return null;
    }
  }, []);

  const cancelRecoveryRequest = useCallback(async (requestId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token) return "Not signed in.";
    try {
      await api.cancelRecoveryRequest(token, requestId);
      await db.clearRecoverySession();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't cancel it.";
    }
  }, []);

  // Once the delay window has cleared server-side: reconstruct the DEK from
  // the approved shares, set a fresh passphrase from it, unlock.
  const finishRecoveryRequest = useCallback(
    async (requestId: string, newPassphrase: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Not signed in.";
      if (newPassphrase.length < 8) return "Use at least 8 characters for the new passphrase.";
      try {
        const poll = await api.fetchRecoveryRequest(token, requestId);
        if (!poll.recoveryWrappedDEK || !poll.approvalShares) {
          return "Not ready yet — the delay window hasn't cleared.";
        }
        const session = await db.getRecoverySession();
        if (!session || session.requestId !== requestId) {
          return "This recovery attempt was started on a different device — finish it there.";
        }
        const sessionPriv = await importPrivateKeyB64(session.privateKeyPkcs8B64);
        const dek = await reconstructDEK(sessionPriv, poll.approvalShares, poll.k, poll.recoveryWrappedDEK);

        const vault = await db.getVault();
        if (!vault) return "No tree on this device.";
        const fresh = await setPassphraseFromDEK(dek, newPassphrase, VERIFIER_TEXT);
        const updated = { ...vault, ...fresh };
        await db.saveVault(updated);
        try {
          await api.updateVault(token, {
            salt: updated.salt, verifier: updated.verifier,
            iterations: updated.iterations, wrappedDEK: updated.wrappedDEK!,
          });
        } catch {
          // this device is already recovered; the server just lags until next sync
        }

        await finishUnlock(dek);

        await api.completeRecoveryRequest(token, requestId).catch(() => {});
        await db.clearRecoverySession();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't finish recovery — the shares didn't reconstruct your key.";
      }
    },
    [finishUnlock]
  );

  // ---- writes: encrypt → update memory → persist → mirror ---------------------

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
    (p: Person, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodePerson(p);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putPerson({ id: p.id, createdAt: p.createdAt, updatedAt: p.updatedAt, deleted, dirty: true, content });
      });
      pushToTree("person", p, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToTree, scheduleSync]
  );

  const persistUnion = useCallback(
    (u: Union, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeUnion(u);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putUnion({ id: u.id, createdAt: u.createdAt, updatedAt: u.updatedAt, deleted, dirty: true, content });
      });
      pushToTree("union", u, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToTree, scheduleSync]
  );

  const persistKeepsake = useCallback(
    (k: Keepsake, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeKeepsake(k);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putKeepsake({ id: k.id, createdAt: k.createdAt, updatedAt: k.updatedAt, deleted, dirty: true, content });
      });
      pushToTree("keepsake", k, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToTree, scheduleSync]
  );

  const stamp = useCallback(<T extends { author?: string }>(draft: T): T => {
    // Attribution, not a score: whose hand last touched the record.
    const me = myUserIdRef.current;
    return me ? { ...draft, author: me } : draft;
  }, []);

  const addPerson = useCallback(
    (draft: PersonDraft): string => {
      const now = Date.now();
      const p: Person = { ...stamp(draft), id: uid(), createdAt: now, updatedAt: now };
      setPeople((prev) => [...prev, p]);
      persistPerson(p);
      return p.id;
    },
    [persistPerson, stamp]
  );

  const updatePerson = useCallback(
    (id: string, patch: Partial<PersonDraft>) => {
      setPeople((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const next = stamp({ ...p, ...patch, updatedAt: Date.now() });
          persistPerson(next);
          return next;
        })
      );
    },
    [persistPerson, stamp]
  );

  // Removing someone is deliberate and complete: their record, their union
  // links, any union left saying nothing, and their keepsakes' references all
  // go in one gesture — tombstones throughout, so the removal syncs later.
  // Keepsakes themselves stay: the letter still exists even if the person
  // entry was a mistake; it just stops pointing at them.
  const removePerson = useCallback(
    (p: Person) => {
      const now = Date.now();
      setPeople((prev) => prev.filter((x) => x.id !== p.id));
      persistPerson({ ...p, updatedAt: now }, true);
      setUnions((prev) => {
        const { upserts, emptied } = unlinkPerson(p.id, prev, now);
        for (const u of upserts) persistUnion(u);
        for (const id of emptied) {
          const u = prev.find((x) => x.id === id);
          if (u) persistUnion({ ...u, updatedAt: now }, true);
        }
        const gone = new Set(emptied);
        const changed = new Set(upserts.map((u) => u.id));
        return [...prev.filter((u) => !gone.has(u.id) && !changed.has(u.id)), ...upserts];
      });
      setKeepsakes((prev) =>
        prev.map((k) => {
          if (!k.about.includes(p.id)) return k;
          const next = { ...k, about: k.about.filter((id) => id !== p.id), updatedAt: now };
          persistKeepsake(next);
          return next;
        })
      );
    },
    [persistPerson, persistUnion, persistKeepsake]
  );

  // Add a relative and place them in one gesture — the person and their
  // union link land together, so nobody is ever added invisibly.
  const addRelative = useCallback(
    (anchorId: string, relation: Relation, draft: PersonDraft, childKind?: ChildLink["kind"]): string => {
      const now = Date.now();
      const p: Person = { ...stamp(draft), id: uid(), createdAt: now, updatedAt: now };
      setPeople((prev) => [...prev, p]);
      persistPerson(p);
      setUnions((prev) => {
        const upserts = linkRelative(anchorId, p.id, relation, prev, childKind, now);
        for (const u of upserts) persistUnion(stamp(u));
        const changed = new Set(upserts.map((u) => u.id));
        return [...prev.filter((u) => !changed.has(u.id)), ...upserts];
      });
      return p.id;
    },
    [persistPerson, persistUnion, stamp]
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
      const k: Keepsake = { ...stamp(draft), mediaId, id: uid(), createdAt: now, updatedAt: now };
      setKeepsakes((prev) => [...prev, k]);
      persistKeepsake(k);
    },
    [persistKeepsake, stamp]
  );

  // Removing a treasure is deliberate but honest: tombstones for the record
  // and its scan (so the removal syncs), decrypted bytes dropped now, and the
  // server's blob freed best-effort.
  const removeKeepsake = useCallback(
    (k: Keepsake) => {
      setKeepsakes((prev) => prev.filter((x) => x.id !== k.id));
      persistKeepsake({ ...k, updatedAt: Date.now() }, true);
      if (k.mediaId) {
        const mediaId = k.mediaId;
        mediaUrls.current.delete(mediaId);
        void db.deleteMedia(mediaId);
        const token = tokenRef.current;
        if (token) void api.deleteMediaRemote(token, mediaId).catch(() => {});
      }
    },
    [persistKeepsake]
  );

  // ---- portability: GEDCOM in and out -----------------------------------------

  // Export is pure and instant: the tree as it stands, living people
  // privatized unless the caller deliberately opted out.
  const exportGedcom = useCallback(
    (privatizeLiving: boolean): string =>
      toGedcom({ people, unions, keepsakes }, { privatizeLiving }),
    [people, unions, keepsakes]
  );

  // Import adds — it never overwrites and never merges. Everything lands
  // encrypted under this vault's key with fresh ids, marked dirty for the
  // personal channel; if a shared tree is planted, the whole tree re-mirrors
  // in chunks (idempotent under LWW) rather than spamming one push per record.
  const importGedcom = useCallback(
    async (text: string): Promise<{ people: number; unions: number; keepsakes: number } | string> => {
      const key = keyRef.current;
      if (!key) return "Unlock the tree first.";
      let parsed: GedcomTree;
      try {
        parsed = fromGedcom(text);
      } catch {
        return "That file didn't read as GEDCOM.";
      }
      if (!parsed.people.length && !parsed.unions.length && !parsed.keepsakes.length) {
        return "No people found in that file — is it a .ged export?";
      }
      const me = myUserIdRef.current ?? undefined;
      try {
        for (const p of parsed.people) {
          if (me) p.author = me;
          await db.putPerson({ id: p.id, createdAt: p.createdAt, updatedAt: p.updatedAt, deleted: false, dirty: true, content: await encryptString(key, encodePerson(p)) });
        }
        for (const u of parsed.unions) {
          if (me) u.author = me;
          await db.putUnion({ id: u.id, createdAt: u.createdAt, updatedAt: u.updatedAt, deleted: false, dirty: true, content: await encryptString(key, encodeUnion(u)) });
        }
        for (const k of parsed.keepsakes) {
          if (me) k.author = me;
          await db.putKeepsake({ id: k.id, createdAt: k.createdAt, updatedAt: k.updatedAt, deleted: false, dirty: true, content: await encryptString(key, encodeKeepsake(k)) });
        }
      } catch {
        return "Couldn't save the imported records to this device.";
      }
      setPeople((prev) => [...prev, ...parsed.people]);
      setUnions((prev) => [...prev, ...parsed.unions]);
      setKeepsakes((prev) => [...prev, ...parsed.keepsakes]);
      scheduleSync();
      const t = treeRef.current;
      const entry = t ? treeKeys.current.get(t.strandId) : undefined;
      if (t && entry) void pushAllToTree(t.strandId, entry.dek, entry.dekEpoch).catch(() => {});
      return { people: parsed.people.length, unions: parsed.unions.length, keepsakes: parsed.keepsakes.length };
    },
    [scheduleSync, pushAllToTree]
  );

  // Decrypt a stored scan to an in-memory data: URL (cached; a data: URL, not
  // blob:, so it displays under a strict CSP). If the blob isn't on this
  // device (added on another), pull the ciphertext from storage and keep it.
  const getMediaUrl = useCallback(async (id: string): Promise<string | null> => {
    const cached = mediaUrls.current.get(id);
    if (cached) return cached;
    const key = keyRef.current;
    if (!key) return null;
    let m = await db.getMedia(id);
    if (m?.deleted) return null;
    if (!m) {
      const token = tokenRef.current;
      if (!token) return null;
      try {
        const dl = await api.downloadMedia(token, id);
        if (!dl) return null;
        m = { id, type: dl.type, createdAt: Date.now(), iv: dl.iv, data: dl.data, deleted: false, dirty: false };
        await db.putMedia(m);
      } catch {
        return null;
      }
    }
    try {
      const bytes = await decryptBytes(key, { iv: m.iv, data: m.data });
      const url = `data:${m.type};base64,${bytesToBase64(bytes)}`;
      mediaUrls.current.set(id, url);
      return url;
    } catch {
      return null;
    }
  }, []);

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
    removePerson,
    addRelative,
    addKeepsake,
    removeKeepsake,
    getMediaUrl,
    exportGedcom,
    importGedcom,
    // account & sync
    account,
    syncing,
    syncError,
    connectCreate,
    connectSignIn,
    disconnect,
    deleteAccount: deleteAccountFn,
    changePassphrase,
    syncNow: runSync,
    // guardians & recovery
    guardianCircle,
    recoveryStatus,
    pendingGuardianRequests,
    loadGuardianCircle,
    setupGuardians,
    approveGuardianRequest,
    cancelPendingRecovery,
    startRecoveryRequest,
    pollRecoveryRequest,
    cancelRecoveryRequest,
    finishRecoveryRequest,
    // the shared tree
    tree,
    treeBusy,
    treeError,
    createTree,
    inviteToTree,
    leaveTree,
    syncTree,
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
