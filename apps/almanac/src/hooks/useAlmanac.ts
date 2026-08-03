// useAlmanac — the ONLY place state, IO, and the decrypted key meet (the same
// seam as useManifest/useGrove/useJournal). The DEK lives in a ref, never React
// state, never storage. Everything below it is either pure (lib/model,
// lib/ics), ciphertext (lib/db), or ciphertext-in-motion (lib/api, lib/sync).
//
// Two secrets, two jobs — the family invariant: the account says WHOSE
// ciphertext this is; the passphrase decrypts it and never leaves the device.
//
// Shared calendars: Almanac shares per calendar — each shared calendar is its
// own strand (strandId == calendar id), riding the same machinery as
// Manifest's lists, Driftless's strands, and Hearth's kitchens. Shared records
// merge into this device's local vault (LWW by updatedAt), so your account
// always keeps your own encrypted copy of what the circle plans together.
// Writes mirror to the strand best-effort; the personal channel is the
// offline-safe outbox.

import { useCallback, useEffect, useRef, useState } from "react";
import { createVault as makeVault, openVault, rewrapVault, setPassphraseFromDEK, verifyDEK } from "@lantern/core/vault";
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
  decodeCalendar, decodeHappening, decodeMark, decodeProfile,
  encodeCalendar, encodeHappening, encodeMark, encodeProfile,
  fromMarkdown, myMarks, toMarkdown, uid,
  type Calendar, type Happening, type Mark, type Profile,
} from "../lib/model";
import { parseICS, type IcsImport } from "../lib/ics";

export type Status = "loading" | "setup" | "locked" | "unlocked";
export type SaveError = { message: string; retry: () => void };

// A shared calendar, as this device sees it. Keyed by calendar id (== strand id).
export type SharedCalendar = {
  calendarId: string;
  ownerId: string;
  role: string;
  dekEpoch: number;
  members: api.StrandMember[];
};

const SHARED_KINDS = new Set<string>(["calendar", "happening", "mark", "profile"]);

export function useAlmanac() {
  const [status, setStatus] = useState<Status>("loading");
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [happenings, setHappenings] = useState<Happening[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  // ---- biometric quick unlock (per-device, opt-in) ----
  const [canBiometric, setCanBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);

  // ---- account & sync state ----
  const [account, setAccount] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ---- guardians & recovery state ----
  const [guardianCircle, setGuardianCircle] = useState<api.RecoveryCircleInfo | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<api.RecoveryStatus>(null);
  const [pendingGuardianRequests, setPendingGuardianRequests] = useState<api.PendingForMe[]>([]);

  // ---- shared calendars ----
  const [shared, setShared] = useState<Record<string, SharedCalendar>>({});
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);

  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null); // sync auth token — NOT the encryption key
  const myUserIdRef = useRef<string | null>(null);
  const accountRef = useRef<string | null>(null); // email, for marks ("I'm in")
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
          // A record that won't decrypt is corrupt bookkeeping, not the plans —
          // skip it rather than refuse the whole unlock.
        }
      }
      return out;
    };
    setCalendars(await decode(await db.allCalendars(), decodeCalendar));
    setHappenings(await decode(await db.allHappenings(), decodeHappening));
    setMarks(await decode(await db.allMarks(), decodeMark));
    setProfiles(await decode(await db.allProfiles(), decodeProfile));
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
    // Circle freshness rides personal sync: every pass also checks the shared
    // calendars. Converges — a merge marks records dirty once, the next pass
    // finds nothing new.
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
  // shared calendar's key deliverable to you and to nobody else.
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

  // ---- shared calendars ------------------------------------------------------

  // Merge one decrypted shared record into the local vault, LWW by updatedAt.
  // Re-encrypted under MY vault key with dirty:true, so my own account keeps a
  // copy of what the circle wrote. Never echoes back to the strand — only
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
      const next: Record<string, SharedCalendar> = {};
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
        // A circle's calendar is small (a season of plans, not a feed) — pull
        // from 0 every time, same trade Manifest and Grove make.
        const { changes } = await api.sharedPull(token, s.strandId, 0);
        for (const ch of changes) {
          try {
            if (!SHARED_KINDS.has(ch.kind)) continue;
            const payload = await decryptString(entry.dek, ch.content);
            if (await mergeSharedRecord(ch.kind as db.SyncKind, ch, payload)) merged = true;
          } catch {
            // one unreadable record shouldn't blank the whole calendar
          }
        }
        let members: api.StrandMember[] = [];
        try {
          members = (await api.sharedMembers(token, s.strandId)).members;
        } catch {
          // membership list is a nicety; the calendar still renders
        }
        next[s.strandId] = { calendarId: s.strandId, ownerId: s.ownerId, role: s.role, dekEpoch: s.dekEpoch, members };
      }
      // Keys for strands we no longer belong to have nothing left to unlock.
      for (const id of [...strandKeys.current.keys()]) if (!next[id]) strandKeys.current.delete(id);
      setShared(next);
      if (merged) {
        await loadAll(key);
        scheduleSync(); // the merged circle records back up to my own account too
      }
    } catch (e) {
      setSharedError(e instanceof Error ? e.message : "Couldn't reach the shared calendars just now.");
    } finally {
      setSharedBusy(false);
    }
  }, [ensureIdentity, mergeSharedRecord, loadAll, scheduleSync]);

  useEffect(() => {
    syncSharedRef.current = syncShared;
  }, [syncShared]);

  // Mirror one record to its calendar's strand, best-effort — the personal
  // channel is the outbox of record; a failed mirror is healed by the next
  // syncShared.
  const pushToShared = useCallback(
    (kind: db.SyncKind, calendarId: string, rec: { id: string; createdAt: number; updatedAt: number }, payload: string, deleted = false) => {
      const token = tokenRef.current;
      const entry = strandKeys.current.get(calendarId);
      if (!token || !entry) return;
      void (async () => {
        try {
          await api.sharedPush(token, calendarId, [{
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
          // personal channel; the circle sees it after the next mirror.
        }
      })();
    },
    []
  );

  // Push one calendar and everything in it (happenings + marks) into its
  // strand — used once at sharing, so the circle starts from the whole
  // calendar, not an empty one.
  const pushAllToCalendar = useCallback(async (calendarId: string, dek: CryptoKey, dekEpoch: number) => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key) return;
    const changes: api.SharedRecord[] = [];
    const happeningIds = new Set<string>();
    for (const rec of await db.allCalendars()) {
      if (rec.deleted || rec.id !== calendarId) continue;
      try {
        const payload = await decryptString(key, rec.content);
        changes.push({
          kind: "calendar", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt; it can't be shared honestly
      }
    }
    for (const rec of await db.allHappenings()) {
      if (rec.deleted) continue;
      try {
        const payload = await decryptString(key, rec.content);
        const h = decodeHappening(payload, { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
        if (h.calendarId !== calendarId) continue;
        happeningIds.add(rec.id);
        changes.push({
          kind: "happening", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt
      }
    }
    for (const rec of await db.allMarks()) {
      if (rec.deleted) continue;
      try {
        const payload = await decryptString(key, rec.content);
        const m = decodeMark(payload, { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
        if (!happeningIds.has(m.happeningId)) continue;
        changes.push({
          kind: "mark", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt
      }
    }
    for (const rec of await db.allProfiles()) {
      if (rec.deleted) continue;
      try {
        const payload = await decryptString(key, rec.content);
        changes.push({
          kind: "profile", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          deleted: false, dekEpoch, content: await encryptString(dek, payload),
        });
      } catch {
        // skip what won't decrypt
      }
    }
    for (let i = 0; i < changes.length; i += 100) {
      await api.sharedPush(token, calendarId, changes.slice(i, i + 100));
    }
  }, []);

  const shareCalendar = useCallback(
    async (calendarId: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Connect an account first — a shared calendar travels through it.";
      const kp = await ensureIdentity();
      if (!kp) return "This vault has no identity key. Re-create it to share.";
      setSharedBusy(true);
      setSharedError(null);
      try {
        const dek = await generateDEK();
        const mine = await wrapDEKForRecipient(await exportPublicKeyB64(kp.publicKey), dek);
        await api.createShared(token, calendarId, mine.ephemeralPub, mine.wrappedDEK);
        strandKeys.current.set(calendarId, { dek, dekEpoch: 1 });
        await pushAllToCalendar(calendarId, dek, 1);
        await syncShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't share the calendar.";
      } finally {
        setSharedBusy(false);
      }
    },
    [ensureIdentity, pushAllToCalendar, syncShared]
  );

  // Invite by an address you already know — there's no directory to browse. We
  // fetch their public key and wrap THE CALENDAR's key to it; the server only
  // ever relays the wrapped copy.
  const inviteToCalendar = useCallback(async (calendarId: string, email: string): Promise<string | null> => {
    const token = tokenRef.current;
    const entry = strandKeys.current.get(calendarId);
    if (!token || !entry) return "The shared calendar isn't ready yet.";
    setSharedBusy(true);
    try {
      const em = email.trim().toLowerCase();
      const { identityPublicKey } = await api.fetchKeys(token, em);
      if (!identityPublicKey) return "They have an account, but no key to share with yet — ask them to open Almanac once.";
      const wrapped = await wrapDEKForRecipient(identityPublicKey, entry.dek);
      await api.inviteToStrand(token, calendarId, em, wrapped.ephemeralPub, wrapped.wrappedDEK, entry.dekEpoch);
      await syncShared();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't invite them just now.";
    } finally {
      setSharedBusy(false);
    }
  }, [syncShared]);

  const leaveCalendar = useCallback(async (calendarId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token || !shared[calendarId]) return "No shared calendar to leave.";
    try {
      await api.sharedLeave(token, calendarId);
      strandKeys.current.delete(calendarId);
      setShared((prev) => {
        const next = { ...prev };
        delete next[calendarId];
        return next;
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't leave just now.";
    }
  }, [shared]);

  // Re-key a shared calendar: mint a fresh DEK, re-encrypt everything in it at
  // the next epoch (pushAllToCalendar overwrites in place — the server keeps
  // one row per record), and re-wrap that DEK to each remaining member. A
  // removed member holds only the old DEK — which now decrypts nothing new —
  // so future plans stay out of reach. Remaining members detect the epoch bump
  // on their next sync and re-unwrap transparently.
  const rotateCalendarDEK = useCallback(async (calendarId: string) => {
    const token = tokenRef.current;
    const entry = strandKeys.current.get(calendarId);
    if (!token || !entry) return;
    const newDek = await generateDEK();
    const newEpoch = entry.dekEpoch + 1;
    await pushAllToCalendar(calendarId, newDek, newEpoch);
    const { members } = await api.sharedMembers(token, calendarId);
    for (const m of members) {
      if (!m.identityPublicKey) continue;
      const w = await wrapDEKForRecipient(m.identityPublicKey, newDek);
      await api.inviteToStrand(token, calendarId, m.email, w.ephemeralPub, w.wrappedDEK, newEpoch);
    }
    strandKeys.current.set(calendarId, { dek: newDek, dekEpoch: newEpoch });
  }, [pushAllToCalendar]);

  // Owner removes a member, then re-keys so they can't read anything new.
  const removeCalendarMember = useCallback(
    async (calendarId: string, userId: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token || !strandKeys.current.get(calendarId)) return "This shared calendar isn't ready.";
      try {
        await api.sharedRemove(token, calendarId, userId);
        await rotateCalendarDEK(calendarId);
        await syncShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't remove them just now.";
      }
    },
    [rotateCalendarDEK, syncShared]
  );

  // ---- invite links ----------------------------------------------------------

  // Mint a shareable invite link for a calendar: a random secret → HKDF wrapKey
  // (encrypts the calendar's DEK, opaque to the server) + joinProof (server
  // stores only its hash). The secret rides in the URL fragment, never sent
  // anywhere.
  const createCalendarInviteLink = useCallback(
    async (calendarId: string): Promise<{ link: string } | { error: string }> => {
      const token = tokenRef.current;
      const entry = strandKeys.current.get(calendarId);
      if (!token || !entry) return { error: "This calendar isn't shared yet." };
      try {
        const linkSecret = randomLinkSecret();
        const { wrapKey, joinProof } = await deriveInviteKeys(linkSecret);
        const inviteId = uid();
        const wrappedDEK = await linkWrapDEK(wrapKey, entry.dek);
        const joinProofHash = await sha256B64(joinProof);
        const expiresAt = Date.now() + 7 * 86_400_000; // 7 days
        await api.createInviteLink(token, calendarId, inviteId, wrappedDEK, joinProofHash, entry.dekEpoch, expiresAt, 20);
        return { link: `${location.origin}/#join=${inviteId}.${b64url(linkSecret)}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't create a link." };
      }
    },
    []
  );

  const fetchCalendarInvites = useCallback(async (calendarId: string): Promise<api.InviteInfo[]> => {
    const token = tokenRef.current;
    if (!token) return [];
    try {
      return (await api.listInvites(token, calendarId)).invites;
    } catch {
      return [];
    }
  }, []);

  const revokeCalendarInvite = useCallback(async (calendarId: string, inviteId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token) return "Not connected.";
    try {
      await api.revokeInvite(token, calendarId, inviteId);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't revoke that link.";
    }
  }, []);

  // Redeem an invite link: prove the joinProof → get the wrapped DEK → unwrap
  // with the link's wrapKey → re-wrap to our own identity → register membership.
  // Returns the joined calendar's id, or an error string.
  const joinViaInvite = useCallback(
    async (inviteId: string, linkSecretB64: string): Promise<{ calendarId: string } | { error: string }> => {
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
        // Arrive with your name on: mirror my profile into the new strand.
        const me = accountRef.current;
        const entry = strandKeys.current.get(claim.strandId);
        if (me && entry) {
          for (const rec of await db.allProfiles()) {
            if (rec.deleted) continue;
            try {
              const payload = await decryptString(keyRef.current!, rec.content);
              const pr = decodeProfile(payload, { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
              if (pr.who !== me) continue;
              await api.sharedPush(token, claim.strandId, [{
                kind: "profile", id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
                deleted: false, dekEpoch: entry.dekEpoch, content: await encryptString(entry.dek, payload),
              }]);
            } catch {
              // best-effort — the next name change mirrors everywhere anyway
            }
          }
        }
        return { calendarId: claim.strandId };
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
    setCalendars([]);
    setHappenings([]);
    setMarks([]);
    setProfiles([]);
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
          });
          setStatus("locked"); // unlocking with the same passphrase pulls the plans down
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
  const changePassphrase = useCallback(
    async (current: string, next: string): Promise<string | null> => {
      const dek = keyRef.current;
      if (!dek) return "Unlock your almanac first.";
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
      if (!token || !dek) return "Unlock your almanac first.";
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
      if (!kp) return "Unlock your almanac first.";
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
  // almanac feels instant; a failed write surfaces a retry, never a silent loss.
  const guardedPersist = useCallback((persist: () => Promise<void>) => {
    const run = () => {
      setSaveError(null);
      persist().catch(() => {
        setSaveError({ message: "Couldn't save to this device — nothing was lost from view.", retry: run });
      });
    };
    run();
  }, []);

  const persistCalendar = useCallback(
    (c: Calendar, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeCalendar(c);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putCalendar({ id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, deleted, dirty: true, content });
      });
      pushToShared("calendar", c.id, c, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  const persistHappening = useCallback(
    (h: Happening, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeHappening(h);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putHappening({ id: h.id, createdAt: h.createdAt, updatedAt: h.updatedAt, deleted, dirty: true, content });
      });
      pushToShared("happening", h.calendarId, h, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  // A mark mirrors through its happening's calendar strand — the calendarId
  // comes from the caller because the mark itself doesn't carry it.
  const persistMark = useCallback(
    (m: Mark, calendarId: string, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeMark(m);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putMark({ id: m.id, createdAt: m.createdAt, updatedAt: m.updatedAt, deleted, dirty: true, content });
      });
      pushToShared("mark", calendarId, m, payload, deleted);
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  const persistProfile = useCallback(
    (pr: Profile, deleted = false) => {
      const key = keyRef.current;
      if (!key) return;
      const payload = encodeProfile(pr);
      guardedPersist(async () => {
        const content = await encryptString(key, payload);
        await db.putProfile({ id: pr.id, createdAt: pr.createdAt, updatedAt: pr.updatedAt, deleted, dirty: true, content });
      });
      for (const calendarId of strandKeys.current.keys()) {
        pushToShared("profile", calendarId, pr, payload, deleted);
      }
      scheduleSync();
    },
    [guardedPersist, pushToShared, scheduleSync]
  );

  const stamp = useCallback(<T extends { author?: string }>(draft: T): T => {
    // Attribution, not a score: whose hand last touched the record.
    const me = myUserIdRef.current;
    return me ? { ...draft, author: me } : draft;
  }, []);

  const addCalendar = useCallback(
    (title: string, note?: string): string => {
      const now = Date.now();
      const c = stamp<Calendar>({ id: uid(), title: title.trim(), note: note?.trim() || undefined, createdAt: now, updatedAt: now });
      setCalendars((prev) => [...prev, c]);
      persistCalendar(c);
      return c.id;
    },
    [persistCalendar, stamp]
  );

  const updateCalendar = useCallback(
    (calendar: Calendar, patch: Partial<Pick<Calendar, "title" | "note">>) => {
      const next = stamp({ ...calendar, ...patch, updatedAt: Date.now() });
      setCalendars((prev) => prev.map((c) => (c.id === calendar.id ? next : c)));
      persistCalendar(next);
    },
    [persistCalendar, stamp]
  );

  // Removing a calendar is deliberate and complete: the calendar, its
  // happenings, and their marks, tombstones throughout, so the removal syncs —
  // and mirrors to the strand if it was shared (the circle loses it too; the
  // UI says so before this runs).
  const removeCalendar = useCallback(
    (calendar: Calendar) => {
      const now = Date.now();
      setCalendars((prev) => prev.filter((c) => c.id !== calendar.id));
      persistCalendar({ ...calendar, updatedAt: now }, true);
      const goneHapIds = new Set(happenings.filter((h) => h.calendarId === calendar.id).map((h) => h.id));
      setHappenings((prev) => {
        for (const h of prev) if (goneHapIds.has(h.id)) persistHappening({ ...h, updatedAt: now }, true);
        return prev.filter((h) => !goneHapIds.has(h.id));
      });
      setMarks((prev) => {
        for (const m of prev) if (goneHapIds.has(m.happeningId)) persistMark({ ...m, updatedAt: now }, calendar.id, true);
        return prev.filter((m) => !goneHapIds.has(m.happeningId));
      });
    },
    [happenings, persistCalendar, persistHappening, persistMark]
  );

  const addHappening = useCallback(
    (calendarId: string, draft: Pick<Happening, "title" | "startsAt"> & Partial<Pick<Happening, "endsAt" | "allDay" | "place" | "link" | "note">>): string => {
      const now = Date.now();
      const h = stamp<Happening>({
        id: uid(), calendarId,
        title: draft.title.trim(),
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        allDay: draft.allDay || undefined,
        place: draft.place?.trim() || undefined,
        link: draft.link?.trim() || undefined,
        note: draft.note?.trim() || undefined,
        createdAt: now, updatedAt: now,
      });
      setHappenings((prev) => [...prev, h]);
      persistHappening(h);
      return h.id;
    },
    [persistHappening, stamp]
  );

  const updateHappening = useCallback(
    (happening: Happening, patch: Partial<Pick<Happening, "title" | "startsAt" | "endsAt" | "allDay" | "place" | "link" | "note">>) => {
      const next = stamp({ ...happening, ...patch, updatedAt: Date.now() });
      setHappenings((prev) => prev.map((h) => (h.id === happening.id ? next : h)));
      persistHappening(next);
    },
    [persistHappening, stamp]
  );

  const removeHappening = useCallback(
    (happening: Happening) => {
      const now = Date.now();
      setHappenings((prev) => prev.filter((h) => h.id !== happening.id));
      persistHappening({ ...happening, updatedAt: now }, true);
      setMarks((prev) => {
        for (const m of prev) if (m.happeningId === happening.id) persistMark({ ...m, updatedAt: now }, happening.calendarId, true);
        return prev.filter((m) => m.happeningId !== happening.id);
      });
    },
    [persistHappening, persistMark]
  );

  // "I'm in" / "actually, I can't" — the only mark the app will ever write is
  // YOUR OWN. In: one fresh record (whoIsIn dedups if two devices both tap).
  // Out: tombstone every record you hold on that happening.
  const setMark = useCallback(
    (happening: Happening, mine: boolean) => {
      const me = accountRef.current;
      if (!me) return;
      if (mine) {
        if (myMarks(happening.id, me, marks).length > 0) return; // already in
        const now = Date.now();
        const m = stamp<Mark>({ id: uid(), happeningId: happening.id, who: me, createdAt: now, updatedAt: now });
        setMarks((prev) => [...prev, m]);
        persistMark(m, happening.calendarId);
      } else {
        const now = Date.now();
        const gone = myMarks(happening.id, me, marks);
        setMarks((prev) => prev.filter((m) => !(m.happeningId === happening.id && m.who === me)));
        for (const m of gone) persistMark({ ...m, updatedAt: now }, happening.calendarId, true);
      }
    },
    [marks, persistMark, stamp]
  );

  // "Call me Jo." One profile record per person; only your own is ever
  // written here. The name travels, encrypted, to every calendar you keep.
  const setMyName = useCallback(
    (name: string) => {
      const me = accountRef.current;
      if (!me) return;
      const now = Date.now();
      const mine = profiles.filter((pr) => pr.who === me).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const next = stamp<Profile>(
        mine
          ? { ...mine, name: name.trim(), updatedAt: now }
          : { id: uid(), who: me, name: name.trim(), createdAt: now, updatedAt: now }
      );
      setProfiles((prev) => (mine ? prev.map((pr) => (pr.id === mine.id ? next : pr)) : [...prev, next]));
      persistProfile(next);
    },
    [profiles, persistProfile, stamp]
  );

  // Every calendar as plain Markdown — readable anywhere, forever.
  const exportMarkdown = useCallback((): string => toMarkdown(calendars, happenings), [calendars, happenings]);

  // The way back in, from our own Markdown. Import adds — it never overwrites
  // and never merges. Everything lands as fresh private calendars under this
  // vault's key.
  const importMarkdown = useCallback(
    (text: string): { calendars: number; happenings: number } | string => {
      if (!keyRef.current) return "Unlock your almanac first.";
      const parsed = fromMarkdown(text);
      if (!parsed.length) return "No calendars found in that file — headings (##) and '- 2026-08-21 — Title' lines are what count.";
      const now = Date.now();
      const newCals: Calendar[] = [];
      const newHaps: Happening[] = [];
      for (const p of parsed) {
        const c = stamp<Calendar>({ id: uid(), title: p.title || "Imported calendar", note: p.note, createdAt: now, updatedAt: now });
        newCals.push(c);
        for (const it of p.happenings) {
          newHaps.push(stamp<Happening>({
            id: uid(), calendarId: c.id, title: it.title, startsAt: it.startsAt,
            allDay: it.allDay || undefined, place: it.place, note: it.note,
            createdAt: now, updatedAt: now,
          }));
        }
      }
      setCalendars((prev) => [...prev, ...newCals]);
      setHappenings((prev) => [...prev, ...newHaps]);
      for (const c of newCals) persistCalendar(c);
      for (const h of newHaps) persistHappening(h);
      return { calendars: newCals.length, happenings: newHaps.length };
    },
    [persistCalendar, persistHappening, stamp]
  );

  // The way in from everyone else's world: port a Google/Apple/Proton export
  // (.ics) into a calendar here — an existing one, or a fresh one named after
  // the file. Parsed entirely on-device; recurring events aren't unrolled and
  // the count of what was skipped is reported, never swallowed.
  const importICS = useCallback(
    (text: string, into?: { calendarId: string } | { newTitle: string }): { calendarId: string; added: number; skipped: IcsImport } | string => {
      if (!keyRef.current) return "Unlock your almanac first.";
      const parsed = parseICS(text);
      if (!parsed.events.length && !parsed.skippedRecurring && !parsed.skippedUnreadable) {
        return "That file doesn't look like a calendar export (.ics).";
      }
      let calendarId: string;
      if (into && "calendarId" in into) {
        calendarId = into.calendarId;
      } else {
        const title = (into && "newTitle" in into && into.newTitle.trim()) || parsed.calendarName || "Imported calendar";
        calendarId = addCalendar(title);
      }
      const now = Date.now();
      const newHaps: Happening[] = parsed.events.map((ev) =>
        stamp<Happening>({
          id: uid(), calendarId, title: ev.title, startsAt: ev.startsAt, endsAt: ev.endsAt,
          allDay: ev.allDay || undefined, place: ev.place, link: ev.link, note: ev.note,
          createdAt: now, updatedAt: now,
        })
      );
      setHappenings((prev) => [...prev, ...newHaps]);
      for (const h of newHaps) persistHappening(h);
      return { calendarId, added: newHaps.length, skipped: parsed };
    },
    [addCalendar, persistHappening, stamp]
  );

  return {
    status,
    calendars,
    happenings,
    marks,
    profiles,
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
    // calendars & happenings & marks
    addCalendar,
    updateCalendar,
    removeCalendar,
    addHappening,
    updateHappening,
    removeHappening,
    setMark,
    setMyName,
    exportMarkdown,
    importMarkdown,
    importICS,
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
    // shared calendars
    shared,
    sharedBusy,
    sharedError,
    shareCalendar,
    inviteToCalendar,
    leaveCalendar,
    removeCalendarMember,
    syncShared,
    // invite links
    createCalendarInviteLink,
    fetchCalendarInvites,
    revokeCalendarInvite,
    joinViaInvite,
  };
}

// Ask the browser not to evict the vault under storage pressure. Best-effort;
// declining is fine, losing the plan on the way to the show is not.
async function requestDurableStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // unsupported — nothing to do
  }
}
