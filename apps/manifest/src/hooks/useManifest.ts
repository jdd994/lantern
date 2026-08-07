// useManifest — the ONLY place state, IO, and the decrypted key meet (the same
// seam as useGrove/useHearth/useJournal). The DEK lives in a ref, never React
// state, never storage. Everything below it is either pure (lib/model),
// ciphertext (lib/db), or ciphertext-in-motion (lib/api, lib/sync).
//
// Two secrets, two jobs — the family invariant: the account says WHOSE
// ciphertext this is; the passphrase decrypts it and never leaves the device.
//
// Shared lists: unlike Grove's single family tree, Manifest shares per list —
// each shared list is its own strand (strandId == list id), riding the same
// machinery as Driftless's strands and Hearth's kitchens. Shared records merge
// into this device's local vault (LWW by updatedAt), so your account always
// keeps your own encrypted copy of what the group packed together. Writes
// mirror to the strand best-effort; the personal channel is the offline-safe
// outbox.

import { useCallback, useEffect, useRef, useState } from "react";
import { createVault as makeVault, openVault, rewrapVault, setPassphraseFromDEK, verifyDEK } from "@lantern/core/vault";
import { makeRecoveryKit, openRecoveryKit } from "@lantern/core/kit";
import { importPublicKeyB64, wrapDEKForRecipient, unwrapDEK } from "@lantern/core/sharing";
import {
  VERIFIER_TEXT, encryptString, decryptString,
  generateDEK, generateIdentityKeypair, exportPublicKeyB64, exportPrivateKeyB64,
  importPrivateKeyB64, unwrapPrivateKey, PBKDF2_ITERATIONS,
  exportKeyRaw, importKeyRaw,
  createRecoveryCircle, approveAsGuardian, reconstructDEK,
  randomLinkSecret, deriveInviteKeys, linkWrapDEK, linkUnwrapDEK,
  sha256B64, b64url, fromB64url, toBase64,
} from "../lib/crypto";
import * as db from "../lib/db";
import * as api from "../lib/api";
import { biometricSupported, enrollBiometric, unlockBiometric } from "../lib/biometric";
import { syncNow as engineSyncNow } from "../lib/sync";
import {
  cloneList as modelCloneList,
  decodeItem, decodeList, encodeItem, encodeList,
  fromMarkdown, itemsFor, nextPosition, toMarkdown, uid,
  type Checklist, type Item,
} from "../lib/model";

export type Status = "loading" | "setup" | "locked" | "unlocked";
export type SaveError = { message: string; retry: () => void };

// A shared list, as this device sees it. Keyed by list id (== strand id).
export type SharedList = {
  listId: string;
  ownerId: string;
  role: string;
  dekEpoch: number;
  members: api.StrandMember[];
};

const SHARED_KINDS = new Set<string>(["list", "item"]);

export function useManifest() {
  const [status, setStatus] = useState<Status>("loading");
  const [lists, setLists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  // ---- biometric quick unlock (per-device, opt-in) ----
  const [canBiometric, setCanBiometric] = useState(false);
  // Paper recovery kit — when this vault minted one (null = none).
  const [recoveryKitAt, setRecoveryKitAt] = useState<number | null>(null);
  const [hasBiometric, setHasBiometric] = useState(false);

  // ---- account & sync state ----
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ---- guardians & recovery state ----
  const [guardianCircle, setGuardianCircle] = useState<api.RecoveryCircleInfo | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<api.RecoveryStatus>(null);
  const [pendingGuardianRequests, setPendingGuardianRequests] = useState<api.PendingForMe[]>([]);

  // ---- shared lists ----
  const [shared, setShared] = useState<Record<string, SharedList>>({});
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);

  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null); // sync auth token — NOT the encryption key
  const myUserIdRef = useRef<string | null>(null);
  const accountRef = useRef<string | null>(null); // email, for claims ("I've got it")
  const identityRef = useRef<CryptoKeyPair | null>(null);
  const strandKeys = useRef<Map<string, { dek: CryptoKey; dekEpoch: number }>>(new Map());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncSharedRef = useRef<(() => Promise<void>) | null>(null); // breaks the runSync↔syncShared declaration cycle

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    void (async () => {
      const [v, st, device, supported] = await Promise.all([
        db.getVault(),
        db.getSyncState(),
        db.getDevice(),
        biometricSupported(),
      ]);
      setCanBiometric(supported);
      setHasBiometric(!!device);
      setRecoveryKitAt(v?.recoveryKit?.createdAt ?? null);
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
          // A record that won't decrypt is corrupt bookkeeping, not the lists —
          // skip it rather than refuse the whole unlock.
        }
      }
      return out;
    };
    setLists(await decode(await db.allLists(), decodeList));
    setItems(await decode(await db.allItems(), decodeItem));
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
    // Group freshness rides personal sync: every pass also checks the shared
    // lists. Converges — a merge marks records dirty once, the next pass finds
    // nothing new.
    void syncSharedRef.current?.();
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
  // The identity keypair, unwrapped with the vault key. It's what makes a
  // shared list's key deliverable to you and to nobody else.
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

  // ---- shared lists -----------------------------------------------------------

  // Merge one decrypted shared record into the local vault, LWW by updatedAt.
  // Re-encrypted under MY vault key with dirty:true, so my own account keeps a
  // copy of what the group wrote. Never echoes back to the strand — only
  // deliberate writes push there.
  const mergeSharedRecord = useCallback(
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

  const syncShared = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    const kp = await ensureIdentity();
    if (!kp) return;
    setSharedBusy(true);
    setSharedError(null);
    try {
      const { strands } = await api.sharedMine(token);
      const next: Record<string, SharedList> = {};
      let merged = false;
      for (const s of strands) {
        let entry = strandKeys.current.get(s.strandId);
        // New to us, or re-keyed because someone was removed — unwrap our copy again.
        if (!entry || entry.dekEpoch !== s.dekEpoch) {
          try {
            entry = { dek: await unwrapDEK(kp.privateKey, s.ephemeralPub, s.wrappedDEK), dekEpoch: s.dekEpoch };
            strandKeys.current.set(s.strandId, entry);
          } catch {
            continue; // can't unwrap our copy — skip rather than guess
          }
        }
        // Lists are small (a packing list, not a feed) — pull from 0 every
        // time, same trade Grove makes for the family tree.
        const { changes } = await api.sharedPull(token, s.strandId, 0);
        for (const ch of changes) {
          try {
            if (!SHARED_KINDS.has(ch.kind)) continue;
            const payload = await decryptString(entry.dek, ch.content);
            if (await mergeSharedRecord(ch.kind as db.SyncKind, ch, payload)) merged = true;
          } catch {
            // one unreadable record shouldn't blank the whole list
          }
        }
        let members: api.StrandMember[] = [];
        try {
          members = (await api.sharedMembers(token, s.strandId)).members;
        } catch {
          // membership list is a nicety; the list still renders
        }
        next[s.strandId] = { listId: s.strandId, ownerId: s.ownerId, role: s.role, dekEpoch: s.dekEpoch, members };
      }
      // Keys for strands we no longer belong to have nothing left to unlock.
      for (const id of [...strandKeys.current.keys()]) if (!next[id]) strandKeys.current.delete(id);
      setShared(next);
      if (merged) {
        await loadAll(key);
        scheduleSync(); // the merged group records back up to my own account too
      }
    } catch (e) {
      setSharedError(e instanceof Error ? e.message : "Couldn't reach the shared lists just now.");
    } finally {
      setSharedBusy(false);
    }
  }, [ensureIdentity, mergeSharedRecord, loadAll, scheduleSync]);

  useEffect(() => {
    syncSharedRef.current = syncShared;
  }, [syncShared]);

  // Mirror one record to its list's strand, best-effort — the personal channel
  // is the outbox of record; a failed mirror is healed by the next syncShared.
  const pushToShared = useCallback(
    (kind: db.SyncKind, listId: string, rec: { id: string; createdAt: number; updatedAt: number }, payload: string, deleted = false) => {
      const token = tokenRef.current;
      const entry = strandKeys.current.get(listId);
      if (!token || !entry) return;
      void (async () => {
        try {
          await api.sharedPush(token, listId, [{
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
          // personal channel; the group sees it after the next mirror.
        }
      })();
    },
    []
  );

  // Push one list and everything on it into its strand — used once at sharing,
  // so the group starts from the whole list, not an empty one.
  const pushAllToList = useCallback(async (listId: string, dek: CryptoKey, dekEpoch: number) => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    const changes: api.SharedRecord[] = [];
    for (const rec of await db.allLists()) {
      if (rec.deleted || rec.id !== listId) continue;
      try {
        const payload = await decryptString(key, rec.content);
        changes.push({
          kind: "list", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt; it can't be shared honestly
      }
    }
    for (const rec of await db.allItems()) {
      if (rec.deleted) continue;
      try {
        const payload = await decryptString(key, rec.content);
        const it = decodeItem(payload, { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
        if (it.listId !== listId) continue;
        changes.push({
          kind: "item", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt
      }
    }
    for (let i = 0; i < changes.length; i += 100) {
      await api.sharedPush(token, listId, changes.slice(i, i + 100));
    }
  }, []);

  const shareList = useCallback(
    async (listId: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Connect an account first — a shared list travels through it.";
      const kp = await ensureIdentity();
      if (!kp) return "This vault has no identity key. Re-create it to share.";
      setSharedBusy(true);
      setSharedError(null);
      try {
        const dek = await generateDEK();
        const mine = await wrapDEKForRecipient(await exportPublicKeyB64(kp.publicKey), dek);
        await api.createShared(token, listId, mine.ephemeralPub, mine.wrappedDEK);
        strandKeys.current.set(listId, { dek, dekEpoch: 1 });
        await pushAllToList(listId, dek, 1);
        await syncShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't share the list.";
      } finally {
        setSharedBusy(false);
      }
    },
    [ensureIdentity, pushAllToList, syncShared]
  );

  // Invite by an address you already know — there's no directory to browse. We
  // fetch their public key and wrap THE LIST's key to it; the server only ever
  // relays the wrapped copy.
  const inviteToList = useCallback(async (listId: string, email: string): Promise<string | null> => {
    const token = tokenRef.current;
    const entry = strandKeys.current.get(listId);
    if (!token || !entry) return "The shared list isn't ready yet.";
    setSharedBusy(true);
    try {
      const em = email.trim().toLowerCase();
      const { identityPublicKey } = await api.fetchKeys(token, em);
      if (!identityPublicKey) return "They have an account, but no key to share with yet — ask them to open Manifest once.";
      const wrapped = await wrapDEKForRecipient(identityPublicKey, entry.dek);
      await api.inviteToStrand(token, listId, em, wrapped.ephemeralPub, wrapped.wrappedDEK, entry.dekEpoch);
      await syncShared();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't invite them just now.";
    } finally {
      setSharedBusy(false);
    }
  }, [syncShared]);

  const leaveList = useCallback(async (listId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token || !shared[listId]) return "No shared list to leave.";
    try {
      await api.sharedLeave(token, listId);
      strandKeys.current.delete(listId);
      setShared((prev) => {
        const next = { ...prev };
        delete next[listId];
        return next;
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't leave just now.";
    }
  }, [shared]);

  // Re-key a shared list: mint a fresh DEK, re-encrypt the list + every item
  // under it at the next epoch (pushAllToList overwrites in place — the server
  // keeps one row per record), and re-wrap that DEK to each remaining member.
  // A removed member holds only the old DEK — which now decrypts nothing new —
  // so future content stays out of reach. Remaining members detect the epoch
  // bump on their next sync and re-unwrap transparently.
  const rotateListDEK = useCallback(async (listId: string) => {
    const token = tokenRef.current;
    const entry = strandKeys.current.get(listId);
    if (!token || !entry) return;
    const newDek = await generateDEK();
    const newEpoch = entry.dekEpoch + 1;
    await pushAllToList(listId, newDek, newEpoch);
    const { members } = await api.sharedMembers(token, listId);
    for (const m of members) {
      if (!m.identityPublicKey) continue;
      const w = await wrapDEKForRecipient(m.identityPublicKey, newDek);
      await api.inviteToStrand(token, listId, m.email, w.ephemeralPub, w.wrappedDEK, newEpoch);
    }
    strandKeys.current.set(listId, { dek: newDek, dekEpoch: newEpoch });
  }, [pushAllToList]);

  // Owner removes a member, then re-keys so they can't read anything new.
  const removeListMember = useCallback(
    async (listId: string, userId: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token || !strandKeys.current.get(listId)) return "This shared list isn't ready.";
      try {
        await api.sharedRemove(token, listId, userId);
        await rotateListDEK(listId);
        await syncShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't remove them just now.";
      }
    },
    [rotateListDEK, syncShared]
  );

  // ---- invite links ----------------------------------------------------------

  // Mint a shareable invite link for a list: a random secret → HKDF wrapKey
  // (encrypts the list's DEK, opaque to the server) + joinProof (server stores
  // only its hash). The secret rides in the URL fragment, never sent anywhere.
  const createListInviteLink = useCallback(
    async (listId: string): Promise<{ link: string } | { error: string }> => {
      const token = tokenRef.current;
      const entry = strandKeys.current.get(listId);
      if (!token || !entry) return { error: "This list isn't shared yet." };
      try {
        const linkSecret = randomLinkSecret();
        const { wrapKey, joinProof } = await deriveInviteKeys(linkSecret);
        const inviteId = uid();
        const wrappedDEK = await linkWrapDEK(wrapKey, entry.dek);
        const joinProofHash = await sha256B64(joinProof);
        const expiresAt = Date.now() + 7 * 86_400_000; // 7 days
        await api.createInviteLink(token, listId, inviteId, wrappedDEK, joinProofHash, entry.dekEpoch, expiresAt, 20);
        return { link: `${location.origin}/#join=${inviteId}.${b64url(linkSecret)}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't create a link." };
      }
    },
    []
  );

  const fetchListInvites = useCallback(async (listId: string): Promise<api.InviteInfo[]> => {
    const token = tokenRef.current;
    if (!token) return [];
    try {
      return (await api.listInvites(token, listId)).invites;
    } catch {
      return [];
    }
  }, []);

  const revokeListInvite = useCallback(async (listId: string, inviteId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token) return "Not connected.";
    try {
      await api.revokeInvite(token, listId, inviteId);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't revoke that link.";
    }
  }, []);

  // Redeem an invite link: prove the joinProof → get the wrapped DEK → unwrap
  // with the link's wrapKey → re-wrap to our own identity → register membership.
  // Returns the joined list's id, or an error string.
  const joinViaInvite = useCallback(
    async (inviteId: string, linkSecretB64: string): Promise<{ listId: string } | { error: string }> => {
      const token = tokenRef.current;
      if (!token) return { error: "Connect an account to join." };
      const kp = await ensureIdentity();
      if (!kp) return { error: "Sharing isn't ready yet — try again in a moment." };
      try {
        const { wrapKey, joinProof } = await deriveInviteKeys(fromB64url(linkSecretB64));
        const proofB64 = toBase64(joinProof);
        const claim = await api.joinClaim(token, inviteId, proofB64);
        const dek = await linkUnwrapDEK(wrapKey, claim.wrappedDEK);
        const selfPub = await exportPublicKeyB64(kp.publicKey);
        const { ephemeralPub, wrappedDEK } = await wrapDEKForRecipient(selfPub, dek);
        await api.joinFinish(token, inviteId, proofB64, ephemeralPub, wrappedDEK);
        await syncShared();
        return { listId: claim.strandId };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't join with that link." };
      }
    },
    [ensureIdentity, syncShared]
  );

  // ---- unlock lifecycle ------------------------------------------------------

  const finishUnlock = useCallback(
    async (dek: CryptoKey) => {
      keyRef.current = dek;
      await loadAll(dek);
      setError(null); // a losing race's complaint must not outlive the unlock
      setStatus("unlocked");
      void requestDurableStorage();
      if (tokenRef.current) {
        void runSync().then(() => void syncShared());
        void loadGuardianCircle();
        void refreshRecoveryStatus();
        void refreshPendingGuardianRequests();
      }
    },
    [loadAll, runSync, syncShared, loadGuardianCircle, refreshRecoveryStatus, refreshPendingGuardianRequests]
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

  // Quick unlock: the passkey's PRF secret (released only after the device's
  // own biometric check) unwraps this device's copy of the DEK. A wrapped key
  // that no longer verifies is stale (e.g. recovery minted a new vault) — it
  // clears itself rather than lingering as a door to nowhere.
  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setError(null);
    const [vault, device] = await Promise.all([db.getVault(), db.getDevice()]);
    if (!vault || !device) return false;
    // A rejected ceremony (cancelled, or a second request while one is up —
    // StrictMode fires the auto-offer twice in dev) is a quiet no, not a crash.
    const raw = await unlockBiometric(device).catch(() => null);
    if (!raw) {
      setError("Couldn't unlock with biometrics. Use your passphrase.");
      return false;
    }
    const key = await importKeyRaw(raw);
    if (!(await verifyDEK(key, vault.verifier, VERIFIER_TEXT))) {
      await db.clearDevice();
      setHasBiometric(false);
      setError("This device's quick unlock is out of date. Use your passphrase.");
      return false;
    }
    await finishUnlock(key);
    return true;
  }, [finishUnlock]);

  // Enroll THIS device: a platform passkey wraps the vault key; the wrap never
  // syncs and is meaningless anywhere else. Opt-in, never the default — the
  // passphrase stays the durable root.
  const enableBiometric = useCallback(async (): Promise<boolean> => {
    const key = keyRef.current;
    if (!key) return false;
    const enrollment = await enrollBiometric(await exportKeyRaw(key));
    if (!enrollment) {
      setError("This device can't do biometric unlock.");
      return false;
    }
    await db.saveDevice({ id: "device", ...enrollment });
    setHasBiometric(true);
    return true;
  }, []);

  const lock = useCallback(() => {
    keyRef.current = null;
    identityRef.current = null;
    strandKeys.current.clear();
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setLists([]);
    setItems([]);
    setShared({});
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
        await db.markAllDirty(); // everything local uploads to the new account
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
            recoveryKit: dto.recoveryKit ?? undefined,
          });
          setRecoveryKitAt(dto.recoveryKit?.createdAt ?? null);
          setStatus("locked"); // unlocking with the same passphrase pulls the lists down
        }
        await db.saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
        if (keyRef.current) {
          await runSync();
          void syncShared();
        }
        return true;
      } catch (e) {
        tokenRef.current = null;
        setAccount(null);
        setSyncError(e instanceof Error ? e.message : "Couldn't sign in.");
        return false;
      }
    },
    [runSync, syncShared]
  );

  const disconnect = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    tokenRef.current = null;
    myUserIdRef.current = null;
    setAccount(null);
    setShared({});
    strandKeys.current.clear();
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
  // ---- paper recovery kit ----------------------------------------------------
  // The solo answer: a printed code in a fire safe. The code never touches a
  // wire; the vault (and, when connected, the server) hold only the DEK
  // wrapped under the code's derived key. See @lantern/core/kit.

  const createRecoveryKit = useCallback(async (): Promise<{ code: string } | string> => {
    const dek = keyRef.current;
    if (!dek) return "Unlock first.";
    const vault = await db.getVault();
    if (!vault) return "No vault on this device.";
    const { code, kit } = await makeRecoveryKit(dek);
    await db.saveVault({ ...vault, recoveryKit: kit });
    setRecoveryKitAt(kit.createdAt);
    const token = tokenRef.current;
    if (token) {
      try {
        await api.updateRecoveryKit(token, kit);
      } catch {
        // offline / unmigrated server — the kit still works on this device
      }
    }
    return { code };
  }, []);

  const removeRecoveryKit = useCallback(async (): Promise<string | null> => {
    const vault = await db.getVault();
    if (!vault) return "No vault on this device.";
    const { recoveryKit: _gone, ...rest } = vault;
    await db.saveVault(rest);
    setRecoveryKitAt(null);
    const token = tokenRef.current;
    if (token) {
      try {
        await api.updateRecoveryKit(token, null);
      } catch {
        // best-effort; the local removal already killed the paper here
      }
    }
    return null;
  }, []);

  // The locked-out door: the code off the paper opens the vault and mints a
  // fresh passphrase — same ending as guardian recovery.
  const recoverWithKit = useCallback(
    async (code: string, newPassphrase: string): Promise<string | null> => {
      if (newPassphrase.length < 8) return "Use at least 8 characters for the new passphrase.";
      let vault = await db.getVault();
      // A replacement device may hold the envelope but not the kit yet — the
      // server copy covers it when an account is connected.
      if (vault && !vault.recoveryKit && tokenRef.current) {
        try {
          const dto = await api.fetchVault(tokenRef.current);
          if (dto.recoveryKit) {
            vault = { ...vault, recoveryKit: dto.recoveryKit };
            await db.saveVault(vault);
          }
        } catch {
          // offline — fall through to the local answer
        }
      }
      if (!vault?.recoveryKit) return "This vault has no recovery kit — the paper can't help here.";
      const dek = await openRecoveryKit(code, vault.recoveryKit);
      if (!dek || !(await verifyDEK(dek, vault.verifier, VERIFIER_TEXT))) {
        return "That code doesn't open this vault. Check the paper — dashes and case don't matter.";
      }
      const fresh = await setPassphraseFromDEK(dek, newPassphrase, VERIFIER_TEXT);
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
          // this device is already recovered; the server lags until next sync
        }
      }
      await finishUnlock(dek);
      return null;
    },
    [finishUnlock]
  );

  const changePassphrase = useCallback(
    async (current: string, next: string): Promise<string | null> => {
      const dek = keyRef.current;
      if (!dek) return "Unlock your lists first.";
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
      if (!token || !dek) return "Unlock your lists first.";
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

  // Help someone back in: unwrap my share (needs my identity key AND the
  // codeword they told me out loud), re-wrap it to their device, submit.
  const approveGuardianRequest = useCallback(
    async (requestId: string, codeword: string): Promise<string | null> => {
      const token = tokenRef.current;
      const entry = pendingGuardianRequests.find((r) => r.requestId === requestId);
      if (!token || !entry) return "That request isn't open anymore.";
      const kp = await ensureIdentity();
      if (!kp) return "Unlock your lists first.";
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
        if (!vault) return "No vault on this device.";
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
  // list feels instant at the door; a failed write surfaces a retry, never a
  // silent loss.
  const guardedPersist = useCallback((persist: () => Promise<void>) => {
    const run = () => {
      setSaveError(null);
      persist().catch(() => {
        setSaveError({ message: "Couldn't save to this device — nothing was lost from view.", retry: run });
      });
    };
    run();
  }, []);

  const persistList = useCallback(
    (l: Checklist, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeList(l);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putList({ id: l.id, createdAt: l.createdAt, updatedAt: l.updatedAt, deleted, dirty: true, content });
      });
      pushToShared("list", l.id, l, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  const persistItem = useCallback(
    (i: Item, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeItem(i);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putItem({ id: i.id, createdAt: i.createdAt, updatedAt: i.updatedAt, deleted, dirty: true, content });
      });
      pushToShared("item", i.listId, i, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  const stamp = useCallback(<T extends { author?: string }>(draft: T): T => {
    // Attribution, not a score: whose hand last touched the record.
    const me = myUserIdRef.current;
    return me ? { ...draft, author: me } : draft;
  }, []);

  const addList = useCallback(
    (title: string, note?: string): string => {
      const now = Date.now();
      const l = stamp<Checklist>({ id: uid(), title: title.trim(), note: note?.trim() || undefined, createdAt: now, updatedAt: now });
      setLists((prev) => [...prev, l]);
      persistList(l);
      return l.id;
    },
    [persistList, stamp]
  );

  const updateList = useCallback(
    (list: Checklist, patch: Partial<Pick<Checklist, "title" | "note">>) => {
      const next = stamp({ ...list, ...patch, updatedAt: Date.now() });
      setLists((prev) => prev.map((l) => (l.id === list.id ? next : l)));
      persistList(next);
    },
    [persistList, stamp]
  );

  // Removing a list is deliberate and complete: the list and everything on it,
  // tombstones throughout, so the removal syncs — and mirrors to the strand if
  // it was shared (the group loses it too; the UI says so before this runs).
  const removeList = useCallback(
    (list: Checklist) => {
      const now = Date.now();
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      persistList({ ...list, updatedAt: now }, true);
      setItems((prev) => {
        for (const i of prev) if (i.listId === list.id) persistItem({ ...i, updatedAt: now }, true);
        return prev.filter((i) => i.listId !== list.id);
      });
    },
    [persistList, persistItem]
  );

  const addItem = useCallback(
    (listId: string, text: string): string => {
      const now = Date.now();
      const i = stamp<Item>({
        id: uid(), listId, text: text.trim(), checked: false,
        position: nextPosition(items.filter((x) => x.listId === listId)),
        createdAt: now, updatedAt: now,
      });
      setItems((prev) => [...prev, i]);
      persistItem(i);
      return i.id;
    },
    [items, persistItem, stamp]
  );

  const updateItem = useCallback(
    (item: Item, patch: Partial<Pick<Item, "text" | "checked" | "claimedBy" | "position">>) => {
      const next = stamp({ ...item, ...patch, updatedAt: Date.now() });
      setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)));
      persistItem(next);
    },
    [persistItem, stamp]
  );

  const toggleItem = useCallback(
    (item: Item) => updateItem(item, { checked: !item.checked }),
    [updateItem]
  );

  // Nudge an item up or down among its neighbors (within its checked/unchecked
  // group — packed things stay settled at the bottom). A swap of positions,
  // so it syncs as two ordinary item updates.
  const moveItem = useCallback(
    (item: Item, dir: -1 | 1) => {
      const group = itemsFor(item.listId, items).filter((i) => i.checked === item.checked);
      const idx = group.findIndex((i) => i.id === item.id);
      const other = group[idx + dir];
      if (idx === -1 || !other) return;
      updateItem(item, { position: other.position });
      updateItem(other, { position: item.position });
    },
    [items, updateItem]
  );

  // A claim is a volunteering, never an assignment: the only value the app
  // will ever write into claimedBy is *your own* address — or nothing.
  const setClaim = useCallback(
    (item: Item, mine: boolean) => {
      const me = accountRef.current;
      if (mine && !me) return;
      updateItem(item, { claimedBy: mine ? me ?? undefined : undefined });
    },
    [updateItem]
  );

  const removeItem = useCallback(
    (item: Item) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      persistItem({ ...item, updatedAt: Date.now() }, true);
    },
    [persistItem]
  );

  // Lists remember: a fresh, private copy for the next departure — everything
  // unchecked, every claim released. Returns the new list's id.
  const duplicateList = useCallback(
    (list: Checklist, title: string): string => {
      const { list: fresh, items: freshItems } = modelCloneList(list, items, title);
      const l = stamp(fresh);
      setLists((prev) => [...prev, l]);
      persistList(l);
      const stamped = freshItems.map((i) => stamp(i));
      setItems((prev) => [...prev, ...stamped]);
      for (const i of stamped) persistItem(i);
      return l.id;
    },
    [items, persistList, persistItem, stamp]
  );

  // Every list as plain Markdown — readable anywhere, forever.
  const exportMarkdown = useCallback((): string => toMarkdown(lists, items), [lists, items]);

  // The way back in. Import adds — it never overwrites and never merges.
  // Everything lands as fresh private lists under this vault's key.
  const importMarkdown = useCallback(
    (text: string): { lists: number; items: number } | string => {
      if (!keyRef.current) return "Unlock your lists first.";
      const parsed = fromMarkdown(text);
      if (!parsed.length) return "No checklists found in that file — headings (##) and - [ ] lines are what count.";
      const now = Date.now();
      const newLists: Checklist[] = [];
      const newItems: Item[] = [];
      for (const p of parsed) {
        const l = stamp<Checklist>({ id: uid(), title: p.title || "Imported list", note: p.note, createdAt: now, updatedAt: now });
        newLists.push(l);
        p.items.forEach((it, idx) => {
          newItems.push(stamp<Item>({
            id: uid(), listId: l.id, text: it.text, checked: it.checked,
            position: idx + 1, createdAt: now, updatedAt: now,
          }));
        });
      }
      setLists((prev) => [...prev, ...newLists]);
      setItems((prev) => [...prev, ...newItems]);
      for (const l of newLists) persistList(l);
      for (const i of newItems) persistItem(i);
      return { lists: newLists.length, items: newItems.length };
    },
    [persistList, persistItem, stamp]
  );

  return {
    status,
    lists,
    items,
    busy,
    error,
    saveError,
    setup,
    unlock,
    lock,
    canBiometric,
    hasBiometric,
    unlockWithBiometric,
    enableBiometric,
    // lists & items
    addList,
    updateList,
    removeList,
    addItem,
    updateItem,
    toggleItem,
    moveItem,
    setClaim,
    removeItem,
    duplicateList,
    exportMarkdown,
    importMarkdown,
    // account & sync
    account,
    syncing,
    syncError,
    connectCreate,
    connectSignIn,
    disconnect,
    deleteAccount: deleteAccountFn,
    changePassphrase,
    recoveryKitAt,
    createRecoveryKit,
    removeRecoveryKit,
    recoverWithKit,
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
    // shared lists
    shared,
    sharedBusy,
    sharedError,
    shareList,
    inviteToList,
    leaveList,
    removeListMember,
    syncShared,
    // invite links
    createListInviteLink,
    fetchListInvites,
    revokeListInvite,
    joinViaInvite,
  };
}

// Ask the browser not to evict the vault under storage pressure. Best-effort;
// declining is fine, losing the list at the trailhead is not.
async function requestDurableStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // unsupported — nothing to do
  }
}
