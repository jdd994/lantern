// useJournal.ts
// The one stateful brain of the app. Holds the in-memory (decrypted) entries
// and the session key, and exposes actions. Nothing here persists plaintext.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  encryptString,
  decryptString,
  encryptBytes,
  decryptBytes,
  exportKeyRaw,
  importKeyRaw,
  generateIdentityKeypair,
  exportPublicKeyB64,
  importPublicKeyB64,
  wrapPrivateKey,
  unwrapPrivateKey,
  generateDEK,
  wrapDEKForRecipient,
  unwrapDEK,
  randomLinkSecret,
  deriveInviteKeys,
  sha256B64,
  linkWrapDEK,
  linkUnwrapDEK,
  b64url,
  fromB64url,
  toBase64,
  VERIFIER_TEXT,
  exportPrivateKeyB64,
  importPrivateKeyB64,
  createRecoveryCircle,
  approveAsGuardian,
  reconstructDEK,
} from "../lib/crypto";
import {
  createVault as makeVault,
  openVault,
  rewrapVault,
  verifyDEK,
  setPassphraseFromDEK,
} from "@lantern/core/vault";
import { compressImage, bytesToBase64 } from "../lib/media";
import {
  biometricSupported,
  enrollBiometric,
  unlockBiometric,
} from "../lib/biometric";
import {
  getVault,
  saveVault,
  allStoredEntries,
  putStoredEntry,
  allStoredStrands,
  putStoredStrand,
  allStoredDayNotes,
  putStoredDayNote,
  putMedia,
  getMedia,
  deleteMedia,
  importData,
  getDevice,
  saveDevice,
  clearDevice,
  getSyncState,
  saveSyncState,
  markAllDirty,
  getRecoverySession,
  saveRecoverySession,
  clearRecoverySession,
  type StoredEntry,
  type StoredStrand,
  type StoredDayNote,
  type VaultMeta,
} from "../lib/db";
import {
  register,
  login,
  fetchVault,
  fetchMe,
  setIdentity,
  fetchKeys,
  createShared,
  inviteToStrand,
  sharedMine,
  sharedPush,
  sharedPull,
  sharedMembers,
  sharedLeave,
  sharedRemove,
  createInviteLink as apiCreateInviteLink,
  joinClaim,
  joinFinish,
  deleteAccount as apiDeleteAccount,
  updateVault,
  downloadMedia,
  deleteMediaRemote,
  uploadSharedMedia,
  downloadSharedMedia,
  deleteSharedMediaRemote,
  setCircle,
  fetchCircle,
  startRequest,
  fetchRecoveryStatus,
  fetchRecoveryRequest,
  cancelRequest as apiCancelRecoveryRequest,
  completeRequest as apiCompleteRecoveryRequest,
  fetchPendingForMe,
  approveRecovery,
  type SharedRecord,
  type StrandMember,
  type GuardianEntry,
  type RecoveryCircleInfo,
  type RecoveryStatus,
  type PendingForMe,
} from "../lib/api";
import { syncNow } from "../lib/sync";
import {
  uid,
  dayKey,
  encodePayload,
  decodePayload,
  encodeStrand,
  decodeStrand,
  encodeDayNote,
  decodeDayNote,
  sharedPieces,
  type Entry,
  type Anchor,
  type Strand,
  type MediaConfig,
  type SharedStrandView,
  type SharedPiece,
  type DayNote,
} from "../lib/journal";
import { buildBackup, type Backup } from "../lib/backup";

export type SaveError = { message: string; retry: () => void } | null;

export type VaultState = "loading" | "needs-setup" | "locked" | "open";

// A shared strand held live in memory: the unwrapped strand key (DEK), the
// pull cursor, and the decrypted title/order/pieces. Never persisted — shared
// content lives on the server (opaque) and is re-fetched + decrypted per session.
type LiveShared = {
  strandId: string;
  ownerId: string;
  role: string;
  dek: CryptoKey;
  dekEpoch: number;
  cursor: number;
  title: string;
  entryIds: string[];
  pieces: Record<string, SharedPiece>;
};

export function useJournal() {
  const [vaultState, setVaultState] = useState<VaultState>("loading");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [strands, setStrands] = useState<Strand[]>([]);
  const [dayNotes, setDayNotes] = useState<Record<string, DayNote>>({});
  const [saveError, setSaveError] = useState<SaveError>(null);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [account, setAccount] = useState<string | null>(null); // synced account email, or null
  const [sharedStrands, setSharedStrands] = useState<SharedStrandView[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null); // this account's id (shared authorship)
  const [guardianCircle, setGuardianCircle] = useState<RecoveryCircleInfo | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(null); // a pending request on MY OWN account
  const [pendingGuardianRequests, setPendingGuardianRequests] = useState<PendingForMe[]>([]); // requests I can approve
  const myUserIdRef = useRef<string | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null); // sync auth token (NOT the key)
  const syncingRef = useRef(false);
  const syncTimer = useRef<number | null>(null);
  const mediaUrls = useRef<Map<string, string>>(new Map()); // mediaId → object URL (decrypted, in-memory)
  const identityRef = useRef<CryptoKeyPair | null>(null); // ECDH keypair for sharing (in-memory)
  const sharedRef = useRef<Map<string, LiveShared>>(new Map()); // shared strands live (with unwrapped DEKs)

  // Decide on first paint whether we need setup or unlock.
  useEffect(() => {
    getVault().then((v) => setVaultState(v ? "locked" : "needs-setup"));
    biometricSupported().then(setBioSupported);
    getDevice().then((d) => setBioEnrolled(!!d));
    getSyncState().then((s) => {
      if (s?.token) {
        tokenRef.current = s.token;
        setAccount(s.accountEmail ?? "account");
      }
    });
  }, []);

  // Ask the browser to make this origin's storage persistent so the journal
  // isn't silently evicted under storage pressure (notably on iOS Safari,
  // which can clear IndexedDB after a stretch of non-use). Best-effort: it may
  // be denied, but for an installed PWA it's typically granted. Called once a
  // vault exists, so we only prompt when there's something worth keeping.
  const requestDurableStorage = useCallback(async () => {
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch {
      // Older browsers / private mode may not support it — nothing to do.
    }
  }, []);

  const loadEntries = useCallback(async (key: CryptoKey) => {
    const stored = await allStoredEntries();
    const decrypted: Entry[] = [];
    for (const s of stored) {
      if (s.deleted) continue; // tombstones aren't shown
      try {
        const { text, anchor, mediaIds, mediaConfig, heading } = decodePayload(await decryptString(key, s.content));
        decrypted.push({ id: s.id, text, anchor, mediaIds, mediaConfig, heading, createdAt: s.createdAt, updatedAt: s.updatedAt });
      } catch {
        // Skip anything that won't decrypt rather than crash the whole list.
      }
    }
    setEntries(decrypted);
  }, []);

  const loadStrands = useCallback(async (key: CryptoKey) => {
    const stored = await allStoredStrands();
    const out: Strand[] = [];
    for (const s of stored) {
      if (s.deleted) continue;
      try {
        const { title, entryIds } = decodeStrand(await decryptString(key, s.content));
        out.push({ id: s.id, title, entryIds, createdAt: s.createdAt, updatedAt: s.updatedAt });
      } catch {
        // skip undecryptable
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    setStrands(out);
  }, []);

  const loadDayNotes = useCallback(async (key: CryptoKey) => {
    const stored = await allStoredDayNotes();
    const out: Record<string, DayNote> = {};
    for (const s of stored) {
      if (s.deleted) continue;
      try {
        const { text } = decodeDayNote(await decryptString(key, s.content));
        if (text) out[s.id] = { key: s.id, text, updatedAt: s.updatedAt };
      } catch {
        // skip undecryptable
      }
    }
    setDayNotes(out);
  }, []);

  // Reconcile with the server (pull others' changes, push ours), then refresh
  // the decrypted view if anything arrived. Runs only while unlocked (needs the
  // key to re-decrypt) and never overlaps itself. No-op when not signed in.
  const runSync = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const changed = await syncNow(token);
      if (changed) {
        await loadEntries(key);
        await loadStrands(key);
        await loadDayNotes(key);
      }
    } catch {
      // offline / transient — a later trigger will retry
    } finally {
      syncingRef.current = false;
    }
  }, [loadEntries, loadStrands, loadDayNotes]);

  // Debounced: after you stop editing, push (and pull) shortly after.
  const scheduleSync = useCallback(() => {
    if (!tokenRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void runSync(), 1500);
  }, [runSync]);

  // Ensure this account has an identity keypair (the foundation for sharing).
  // Recover it from the server-wrapped private key, or generate + upload one
  // (also migrates accounts created before identity keys existed). Held in
  // memory only; the private key never leaves unwrapped.
  const ensureIdentity = useCallback(async () => {
    const token = tokenRef.current;
    const key = keyRef.current;
    if (!token || !key || identityRef.current) return;
    try {
      const v = await fetchVault(token);
      if (v.identityPublicKey && v.identityPrivWrapped) {
        identityRef.current = {
          publicKey: await importPublicKeyB64(v.identityPublicKey),
          privateKey: await unwrapPrivateKey(key, v.identityPrivWrapped),
        };
      } else {
        const kp = await generateIdentityKeypair();
        await setIdentity(token, await exportPublicKeyB64(kp.publicKey), await wrapPrivateKey(key, kp.privateKey));
        identityRef.current = kp;
      }
    } catch {
      // offline / transient — a later open will retry
    }
  }, []);

  // Publish the live shared strands (a snapshot the UI can render).
  const publishShared = useCallback(() => {
    const views: SharedStrandView[] = [...sharedRef.current.values()].map((v) => ({
      strandId: v.strandId,
      role: v.role,
      title: v.title,
      entryIds: v.entryIds,
      pieces: v.pieces,
    }));
    setSharedStrands(views);
  }, []);

  // Pull new shared objects for one strand from its cursor forward and fold them
  // into the live copy (decrypting with the strand DEK; LWW by seq order).
  const pullSharedStrand = useCallback(async (live: LiveShared) => {
    const token = tokenRef.current;
    if (!token) return;
    for (;;) {
      const res = await sharedPull(token, live.strandId, live.cursor);
      for (const rec of res.changes) {
        try {
          if (rec.kind === "meta") {
            if (rec.deleted) continue;
            const { title, entryIds } = decodeStrand(await decryptString(live.dek, rec.content));
            live.title = title;
            live.entryIds = entryIds;
          } else if (rec.kind === "piece") {
            if (rec.deleted) {
              delete live.pieces[rec.id];
              continue;
            }
            const { text, mediaIds, author } = decodePayload(await decryptString(live.dek, rec.content));
            live.pieces[rec.id] = { id: rec.id, text, mediaIds, author, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
          }
        } catch {
          // undecryptable (e.g. a future DEK epoch) — skip rather than crash
        }
      }
      live.cursor = res.cursor;
      if (!res.more) break;
    }
  }, []);

  // Fetch the strands I'm a member of, unwrap each DEK (once), pull + decrypt
  // their pieces, and publish. Safe to call repeatedly (incremental per cursor).
  const loadSharedStrands = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    if (!myUserIdRef.current) {
      try {
        const { userId } = await fetchMe(token);
        myUserIdRef.current = userId;
        setMyUserId(userId);
      } catch {
        // offline / transient — a later load retries
      }
    }
    await ensureIdentity();
    const kp = identityRef.current;
    if (!kp) return;
    try {
      const { strands } = await sharedMine(token);
      for (const s of strands) {
        let live = sharedRef.current.get(s.strandId);
        if (!live) {
          let dek: CryptoKey;
          try {
            dek = await unwrapDEK(kp.privateKey, s.ephemeralPub, s.wrappedDEK);
          } catch {
            continue; // can't unwrap our copy — skip this strand
          }
          live = {
            strandId: s.strandId,
            ownerId: s.ownerId,
            role: s.role,
            dek,
            dekEpoch: s.dekEpoch,
            cursor: 0,
            title: "",
            entryIds: [],
            pieces: {},
          };
          sharedRef.current.set(s.strandId, live);
        } else if (live.dekEpoch !== s.dekEpoch) {
          // The strand was re-keyed (a member was removed). Unwrap the new DEK
          // and rebuild from scratch — every piece was re-encrypted under it.
          try {
            live.dek = await unwrapDEK(kp.privateKey, s.ephemeralPub, s.wrappedDEK);
          } catch {
            continue;
          }
          live.dekEpoch = s.dekEpoch;
          live.cursor = 0;
          live.pieces = {};
        }
        await pullSharedStrand(live);
      }
      // Forget strands we're no longer a member of (left / removed).
      const present = new Set(strands.map((s) => s.strandId));
      for (const id of [...sharedRef.current.keys()]) {
        if (!present.has(id)) sharedRef.current.delete(id);
      }
      publishShared();
    } catch {
      // offline / transient — a later trigger retries
    }
  }, [ensureIdentity, pullSharedStrand, publishShared]);

  // Background sync while open: on unlock, on reconnect, on returning to the
  // app, and on a gentle interval.
  useEffect(() => {
    if (vaultState !== "open" || !tokenRef.current) return;
    void runSync();
    void ensureIdentity();
    void loadSharedStrands();
    const onOnline = () => {
      void runSync();
      void loadSharedStrands();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void runSync();
        void loadSharedStrands();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(() => {
      void runSync();
      void loadSharedStrands();
    }, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, [vaultState, runSync, ensureIdentity, loadSharedStrands]);

  // Create a sync account from THIS device's existing vault, then upload
  // everything. Requires the vault key in memory. Returns an error message, or
  // null on success. Generates the identity keypair (for sharing) and uploads
  // the public half + the vault-wrapped private half.
  const connectCreateAccount = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const v = await getVault();
      if (!v || !keyRef.current) return "Unlock your journal first.";
      const em = email.trim().toLowerCase();
      try {
        const kp = await generateIdentityKeypair();
        const { token, userId } = await register(
          em,
          password,
          { salt: v.salt, verifier: v.verifier, iterations: v.iterations, wrappedDEK: v.wrappedDEK },
          await exportPublicKeyB64(kp.publicKey),
          await wrapPrivateKey(keyRef.current, kp.privateKey)
        );
        identityRef.current = kp;
        tokenRef.current = token;
        myUserIdRef.current = userId;
        setMyUserId(userId);
        await saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
        setAccount(em);
        await markAllDirty(); // a fresh account gets the WHOLE journal, not just recent edits
        await runSync();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't create the account.";
      }
    },
    [runSync]
  );

  // First run: choose a passphrase and create the vault. Optionally, in the same
  // guided step, set up a sync/sharing account (a *separate* secret from the
  // passphrase — see invariant #4). Opens the journal last, so an account error
  // can be shown on the setup screen without the app flashing open underneath.
  const createVault = useCallback(
    async (
      passphrase: string,
      account?: { email: string; password: string }
    ): Promise<string | null> => {
      // Guard so a retry (after an account error) reuses the same vault rather
      // than regenerating the salt/key.
      if (!keyRef.current) {
        // Envelope model (see @lantern/core/vault). Driftless creates its identity
        // lazily / server-side, so it isn't part of the local vault here — only the
        // DEK-bearing fields are persisted.
        const { dek, secrets } = await makeVault(passphrase, VERIFIER_TEXT);
        await saveVault({
          id: "vault",
          salt: secrets.salt,
          verifier: secrets.verifier,
          wrappedDEK: secrets.wrappedDEK,
          iterations: secrets.iterations,
          createdAt: Date.now(),
        });
        keyRef.current = dek;
        setEntries([]);
        setStrands([]);
        setDayNotes({});
      }
      if (account) {
        const err = await connectCreateAccount(account.email, account.password);
        if (err) return err; // stay on setup so they can fix email/password
      }
      setVaultState("open");
      void requestDurableStorage();
      return null;
    },
    [requestDurableStorage, connectCreateAccount]
  );

  // Returning: unlock with the passphrase. Returns false on a wrong one.
  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      const v = await getVault();
      if (!v) return false;
      // Delegates the unwrap-or-migrate logic to the tested vault module.
      const opened = await openVault(passphrase, v, VERIFIER_TEXT);
      if (!opened) return false;
      if (opened.migratedWrappedDEK) {
        await saveVault({ ...v, wrappedDEK: opened.migratedWrappedDEK });
      }

      keyRef.current = opened.dek;
      await loadEntries(opened.dek);
      await loadStrands(opened.dek);
      await loadDayNotes(opened.dek);
      setVaultState("open");
      void requestDurableStorage();
      return true;
    },
    [loadEntries, loadStrands, loadDayNotes, requestDurableStorage]
  );

  // Returning via biometrics: a passkey + PRF unwrap a device-stored copy of
  // the key — no passphrase typed. Returns false (caller keeps the passphrase
  // form) if there's no enrollment, the check is declined, or it doesn't
  // verify. The passphrase path is never affected by this.
  const biometricUnlock = useCallback(async (): Promise<boolean> => {
    const d = await getDevice();
    if (!d) return false;
    const raw = await unlockBiometric(d);
    if (!raw) return false;
    const key = await importKeyRaw(raw);
    const v = await getVault();
    if (!v || !(await verifyDEK(key, v.verifier, VERIFIER_TEXT))) return false;
    keyRef.current = key;
    await loadEntries(key);
    await loadStrands(key);
    await loadDayNotes(key);
    setVaultState("open");
    void requestDurableStorage();
    return true;
  }, [loadEntries, loadStrands, loadDayNotes, requestDurableStorage]);

  // Opt in on this device (must be unlocked): wrap the in-memory key behind a
  // platform passkey. Returns false if the platform can't do PRF.
  const enableBiometric = useCallback(async (): Promise<boolean> => {
    const key = keyRef.current;
    if (!key) return false;
    const raw = await exportKeyRaw(key);
    const enr = await enrollBiometric(raw);
    if (!enr) return false;
    await saveDevice({ id: "device", ...enr });
    setBioEnrolled(true);
    return true;
  }, []);

  const disableBiometric = useCallback(async () => {
    await clearDevice();
    setBioEnrolled(false);
  }, []);

  // Change the passphrase (must be unlocked). Thanks to the envelope model this
  // only re-wraps the DEK under a key derived from the new passphrase — NO data
  // is re-encrypted, so it's instant and every other device keeps reading its
  // data with the unchanged DEK. Biometric quick-unlock also survives (it wraps
  // the raw DEK). Returns an error message, or null on success.
  const changePassphrase = useCallback(
    async (current: string, next: string): Promise<string | null> => {
      const dek = keyRef.current;
      if (!dek) return "Unlock your journal first.";
      if (next.length < 8) return "Use at least 8 characters for the new passphrase.";
      const v = await getVault();
      if (!v) return "No vault on this device.";

      // Verify the current passphrase + re-wrap the DEK, via the tested vault module.
      const rewrapped = await rewrapVault(dek, current, next, v, VERIFIER_TEXT);
      if (!rewrapped) return "That current passphrase isn't right.";
      const updated: VaultMeta = { ...v, ...rewrapped };
      await saveVault(updated);

      // Propagate to the server so other devices require the new passphrase when
      // they next sign in. Failing here isn't fatal — this device is already
      // changed; the server just lags until the next successful sync.
      const token = tokenRef.current;
      if (token) {
        try {
          await updateVault(token, {
            salt: updated.salt,
            verifier: updated.verifier,
            iterations: updated.iterations,
            wrappedDEK: updated.wrappedDEK!,
          });
        } catch (e) {
          return e instanceof Error
            ? `Changed on this device, but the server didn't update: ${e.message}`
            : "Changed on this device, but the server couldn't be reached.";
        }
      }
      return null;
    },
    []
  );

  // ---- Social recovery: MY circle (post-unlock, needs the key + identity) ---

  const loadGuardianCircle = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      setGuardianCircle(await fetchCircle(token));
    } catch {
      setGuardianCircle(null); // no circle configured yet (404) or offline
    }
  }, []);

  // Configure (or rotate) K-of-N guardians. Each guardian's codeword must have
  // been told to them OUT LOUD, never typed anywhere but here — see HelpSheet.
  // Rotating cancels any recovery request already in flight (its shares wrap
  // the OLD recovery key). Returns an error message, or null on success.
  const setupGuardians = useCallback(
    async (guardians: { email: string; codeword: string }[], k: number, delayMs: number): Promise<string | null> => {
      const token = tokenRef.current;
      const dek = keyRef.current;
      if (!token || !dek) return "Unlock your journal first.";
      if (k < 2 || k > guardians.length) return "Pick at least 2, and no more than the number of guardians.";
      try {
        const resolved = await Promise.all(
          guardians.map(async (g) => {
            const em = g.email.trim().toLowerCase();
            const { identityPublicKey } = await fetchKeys(token, em);
            if (!identityPublicKey) throw new Error(`${em} doesn't have an account yet.`);
            return { userId: em, identityPublicKey, codeword: g.codeword };
          })
        );
        const circle = await createRecoveryCircle(dek, resolved, { k, n: resolved.length, delayMs });
        const entries: GuardianEntry[] = circle.shares.map((s) => ({
          email: s.userId, // resolved as the lookup email above — see createRecoveryCircle
          shareIndex: s.shareIndex,
          ephemeralPub: s.ephemeralPub,
          wrapped: s.wrapped,
          codewordSalt: s.codewordSalt,
          codewordIterations: s.codewordIterations,
        }));
        await setCircle(token, k, resolved.length, delayMs, circle.recoveryWrappedDEK, entries);
        await loadGuardianCircle();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't set up guardians.";
      }
    },
    [loadGuardianCircle]
  );

  // Pull surfaces (deliberately no push/notify — see journal.ts's "never
  // notifies" invariant): checked alongside ensureIdentity/loadSharedStrands,
  // so any device shows a pending request next time it opens and syncs.
  const refreshRecoveryStatus = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { request } = await fetchRecoveryStatus(token);
      setRecoveryStatus(request);
    } catch {
      // offline / transient
    }
  }, []);

  const cancelPendingRecovery = useCallback(async (): Promise<string | null> => {
    const token = tokenRef.current;
    const requestId = recoveryStatus?.requestId;
    if (!token || !requestId) return "No pending request.";
    try {
      await apiCancelRecoveryRequest(token, requestId);
      await refreshRecoveryStatus();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't cancel it.";
    }
  }, [recoveryStatus, refreshRecoveryStatus]);

  const refreshPendingGuardianRequests = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { requests } = await fetchPendingForMe(token);
      setPendingGuardianRequests(requests);
    } catch {
      // offline / transient
    }
  }, []);

  // Help a friend: unwrap my share (needs my identity key AND the codeword
  // they told me out loud), re-wrap it to their device, submit. Wrong codeword
  // fails loudly (AES-GCM) rather than silently sending garbage.
  const approveGuardianRequest = useCallback(
    async (requestId: string, codeword: string): Promise<string | null> => {
      const token = tokenRef.current;
      const identity = identityRef.current;
      if (!token || !identity) return "Unlock your journal first.";
      const entry = pendingGuardianRequests.find((r) => r.requestId === requestId);
      if (!entry) return "That request isn't open anymore.";
      try {
        const wrappedShareForRequester = await approveAsGuardian(
          identity.privateKey,
          entry.myShare,
          codeword,
          entry.sessionPub
        );
        await approveRecovery(token, requestId, wrappedShareForRequester);
        await refreshPendingGuardianRequests();
        return null;
      } catch {
        return "That codeword isn't right.";
      }
    },
    [pendingGuardianRequests, refreshPendingGuardianRequests]
  );

  // ---- Social recovery: RECOVERING (pre-unlock — no key, maybe no token) ----

  // Sign in for the sole purpose of reaching a recovery circle — doesn't touch
  // the local vault (unlike connectSignIn, which is for a brand-new device).
  // Needed when this device was never connected to the account, or was
  // disconnected, before the passphrase was forgotten.
  const recoverySignIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const em = email.trim().toLowerCase();
    try {
      const { token } = await login(em, password);
      tokenRef.current = token;
      await saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
      setAccount(em);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't sign in.";
    }
  }, []);

  // Start a request: a fresh throwaway session keypair (saved locally, in the
  // clear — this device only, see db.ts's RecoverySession), then ask the
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
      const result = await startRequest(token, publicKeyB64);
      await saveRecoverySession({ id: "session", requestId: result.requestId, publicKeyB64, privateKeyPkcs8B64 });
      return result;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't start recovery.";
    }
  }, []);

  const pollRecoveryRequest = useCallback(async (requestId: string) => {
    const token = tokenRef.current;
    if (!token) return null;
    try {
      return await fetchRecoveryRequest(token, requestId);
    } catch {
      return null;
    }
  }, []);

  const cancelRecoveryRequest = useCallback(async (requestId: string): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token) return "Not signed in.";
    try {
      await apiCancelRecoveryRequest(token, requestId);
      await clearRecoverySession();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't cancel it.";
    }
  }, []);

  // Once the delay window has cleared server-side: reconstruct the DEK from
  // the approved shares, set a fresh passphrase from it, open the journal.
  const finishRecoveryRequest = useCallback(
    async (requestId: string, newPassphrase: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Not signed in.";
      if (newPassphrase.length < 8) return "Use at least 8 characters for the new passphrase.";
      try {
        const poll = await fetchRecoveryRequest(token, requestId);
        if (!poll.recoveryWrappedDEK || !poll.approvalShares) {
          return "Not ready yet — the delay window hasn't cleared.";
        }
        const session = await getRecoverySession();
        if (!session || session.requestId !== requestId) {
          return "This recovery attempt was started on a different device — finish it there.";
        }
        const sessionPriv = await importPrivateKeyB64(session.privateKeyPkcs8B64);
        const dek = await reconstructDEK(sessionPriv, poll.approvalShares, poll.k, poll.recoveryWrappedDEK);

        const v = await getVault();
        if (!v) return "No journal on this device.";
        const fresh = await setPassphraseFromDEK(dek, newPassphrase, VERIFIER_TEXT);
        const updated: VaultMeta = { ...v, ...fresh };
        await saveVault(updated);
        try {
          await updateVault(token, {
            salt: updated.salt,
            verifier: updated.verifier,
            iterations: updated.iterations,
            wrappedDEK: updated.wrappedDEK!,
          });
        } catch {
          // this device is already recovered; the server just lags until next sync
        }

        keyRef.current = dek;
        await loadEntries(dek);
        await loadStrands(dek);
        await loadDayNotes(dek);
        setVaultState("open");
        void requestDurableStorage();

        await apiCompleteRecoveryRequest(token, requestId).catch(() => {});
        await clearRecoverySession();
        return null;
      } catch (e) {
        // Wrong/insufficient shares fail loudly here (unwrapVaultKey's auth tag).
        return e instanceof Error ? e.message : "Couldn't finish recovery — the shares didn't reconstruct your key.";
      }
    },
    [loadEntries, loadStrands, loadDayNotes, requestDurableStorage]
  );

  // Same pull-only triggers as the background sync effect above (unlock,
  // reconnect, returning to the app, a gentle interval) — this IS the
  // notification for "someone is trying to recover your account" and "a
  // friend needs your help," deliberately not a push.
  useEffect(() => {
    if (vaultState !== "open" || !tokenRef.current) return;
    void loadGuardianCircle();
    void refreshRecoveryStatus();
    void refreshPendingGuardianRequests();
    const onWake = () => {
      void refreshRecoveryStatus();
      void refreshPendingGuardianRequests();
    };
    const onVis = () => document.visibilityState === "visible" && onWake();
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onVis);
    const id = window.setInterval(onWake, 60_000);
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, [vaultState, loadGuardianCircle, refreshRecoveryStatus, refreshPendingGuardianRequests]);

  const lock = useCallback(() => {
    keyRef.current = null;
    setEntries([]);
    setStrands([]);
    mediaUrls.current.clear(); // free decrypted image data URLs from memory
    identityRef.current = null;
    sharedRef.current.clear(); // drop unwrapped strand keys + decrypted shared content
    setSharedStrands([]);
    myUserIdRef.current = null;
    setMyUserId(null);
    setGuardianCircle(null);
    setRecoveryStatus(null);
    setPendingGuardianRequests([]);
    setVaultState("locked");
  }, []);

  // Writes a record as ciphertext, always marked `dirty` so the (future) sync
  // engine knows it has local changes to push. A deleted record is a tombstone:
  // we clear its plaintext (encrypt "") since the content is gone on purpose,
  // but keep the row so the deletion can propagate.
  const persist = useCallback(async (entry: Entry, deleted = false) => {
    const key = keyRef.current;
    if (!key) return;
    const content = await encryptString(
      key,
      deleted
        ? ""
        : encodePayload(entry.text, entry.anchor, entry.mediaIds, entry.mediaConfig, undefined, entry.heading)
    );
    const record: StoredEntry = {
      id: entry.id,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      content,
      deleted,
      dirty: true,
    };
    await putStoredEntry(record);
  }, []);

  // The UI updates optimistically, then we persist. If that write fails (full
  // disk, private-mode quirks, a locked DB), the thought is still on screen but
  // NOT safely stored — so we surface it with a retry instead of failing
  // silently. Capture's whole promise is a safe landing; this keeps it honest.
  const guardedPersist = useCallback(
    async (entry: Entry, deleted = false) => {
      try {
        await persist(entry, deleted);
        setSaveError(null);
        scheduleSync();
      } catch {
        setSaveError({
          message: deleted
            ? "Couldn't remove that on this device."
            : "Couldn't save that to this device. Your text is still here.",
          retry: () => void guardedPersist(entry, deleted),
        });
      }
    },
    [persist, scheduleSync]
  );

  const createEntry = useCallback(
    async (text: string, heading?: boolean): Promise<Entry> => {
      const t = Date.now();
      const entry: Entry = { id: uid(), text, createdAt: t, updatedAt: t, heading: heading || undefined };
      setEntries((prev) => [...prev, entry]);
      await guardedPersist(entry);
      return entry;
    },
    [guardedPersist]
  );

  const addEntry = useCallback(
    async (text: string) => {
      await createEntry(text);
    },
    [createEntry]
  );

  const updateEntry = useCallback(
    async (id: string, text: string) => {
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          updated = { ...e, text, updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
    },
    [guardedPersist]
  );

  // Attach / change / clear a thought's anchor in lived time. Pass null to
  // un-anchor it. Bumps updatedAt so the change syncs.
  const setAnchor = useCallback(
    async (id: string, anchor: Anchor | null) => {
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          updated = { ...e, anchor: anchor ?? undefined, updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
    },
    [guardedPersist]
  );

  // Flag/unflag a thought as a strand section heading (STRANDS_PLAN.md §2).
  // Only meaningful inside a Strand — the Stream/Timeline ignore it.
  const setHeading = useCallback(
    async (id: string, heading: boolean) => {
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          updated = { ...e, heading: heading || undefined, updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
    },
    [guardedPersist]
  );

  // Attach a photo to a thought: compress → encrypt → store locally, then add
  // its id to the entry. Local-first — the image bytes aren't synced yet (only
  // the reference in the entry payload is).
  const attachMedia = useCallback(
    async (entryId: string, file: File) => {
      const key = keyRef.current;
      if (!key) return;
      let bytes: ArrayBuffer;
      let type: string;
      try {
        ({ bytes, type } = await compressImage(file));
      } catch (e) {
        setSaveError({
          message: e instanceof Error ? e.message : "Couldn't add that photo.",
          retry: () => void attachMedia(entryId, file),
        });
        return;
      }
      const cb = await encryptBytes(key, bytes);
      const mediaId = uid();
      await putMedia({
        id: mediaId,
        type,
        createdAt: Date.now(),
        iv: cb.iv,
        data: cb.data,
        deleted: false,
        dirty: true,
      });
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== entryId) return e;
          updated = { ...e, mediaIds: [...(e.mediaIds ?? []), mediaId], updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
    },
    [guardedPersist]
  );

  const removeMedia = useCallback(
    async (entryId: string, mediaId: string) => {
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== entryId) return e;
          updated = {
            ...e,
            mediaIds: (e.mediaIds ?? []).filter((m) => m !== mediaId),
            updatedAt: Date.now(),
          };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
      await deleteMedia(mediaId);
      mediaUrls.current.delete(mediaId);
      // Also free it from storage if we're connected (best-effort, idempotent).
      const token = tokenRef.current;
      if (token) {
        try {
          await deleteMediaRemote(token, mediaId);
        } catch {
          // offline / transient — the blob just lingers; harmless
        }
      }
    },
    [guardedPersist]
  );

  // Adjust a photo's look (size / tilt) within a thought. Merges into the
  // entry's per-photo config and persists.
  const setMediaConfig = useCallback(
    async (entryId: string, mediaId: string, partial: MediaConfig) => {
      let updated: Entry | null = null;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== entryId) return e;
          const cfg = { ...(e.mediaConfig ?? {}) };
          cfg[mediaId] = { ...(cfg[mediaId] ?? {}), ...partial };
          updated = { ...e, mediaConfig: cfg, updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedPersist(updated);
    },
    [guardedPersist]
  );

  // Decrypt a stored image to an in-memory object URL (cached). Returns null if
  // the media isn't on this device (e.g. added on another device — not synced).
  const getMediaUrl = useCallback(async (id: string): Promise<string | null> => {
    const cached = mediaUrls.current.get(id);
    if (cached) return cached;
    const key = keyRef.current;
    if (!key) return null;
    let m = await getMedia(id);
    if (m?.deleted) return null;
    // Not on this device (e.g. added on another) — pull the encrypted blob from
    // R2 if we're connected, then cache it locally so it's here next time.
    if (!m) {
      const token = tokenRef.current;
      if (!token) return null;
      try {
        const dl = await downloadMedia(token, id);
        if (!dl) return null;
        m = { id, type: dl.type, createdAt: Date.now(), iv: dl.iv, data: dl.data, deleted: false, dirty: false };
        await putMedia(m);
      } catch {
        return null;
      }
    }
    try {
      const bytes = await decryptBytes(key, { iv: m.iv, data: m.data });
      // data: URL (not blob:) so it displays under the existing CSP, regardless
      // of cache freshness. Cached in-memory to avoid re-decrypting.
      const url = `data:${m.type};base64,${bytesToBase64(bytes)}`;
      mediaUrls.current.set(id, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const removeEntry = useCallback(
    async (entry: Entry) => {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      // Soft delete: write a tombstone (deleted + dirty, bumped updatedAt) so
      // the removal can sync and win last-write-wins on other devices.
      await guardedPersist({ ...entry, updatedAt: Date.now() }, true);
    },
    [guardedPersist]
  );

  // Used by Undo: re-insert a previously deleted entry. Bump updatedAt so this
  // revival out-dates the tombstone and wins last-write-wins once synced.
  const restoreEntry = useCallback(
    async (entry: Entry) => {
      const revived: Entry = { ...entry, updatedAt: Date.now() };
      setEntries((prev) => [...prev, revived]);
      await guardedPersist(revived);
    },
    [guardedPersist]
  );

  // A restorable, ciphertext-only backup of the whole vault. Returns null if
  // there's nothing to back up yet.
  const exportBackup = useCallback(async (): Promise<Backup | null> => {
    const v = await getVault();
    if (!v) return null;
    // A backup is a clean snapshot — leave tombstones out.
    const liveEntries = (await allStoredEntries()).filter((e) => !e.deleted);
    const liveStrands = (await allStoredStrands()).filter((s) => !s.deleted);
    const liveDayNotes = (await allStoredDayNotes()).filter((n) => !n.deleted);
    return buildBackup(v, liveEntries, liveStrands, liveDayNotes);
  }, []);

  // Restore a parsed backup onto a fresh device. Writes the vault + ciphertext,
  // then drops to the locked screen so the user unlocks with the original
  // passphrase (which never travels in the backup).
  const restoreBackup = useCallback(async (backup: Backup) => {
    const vault: VaultMeta = {
      id: "vault",
      salt: backup.vault.salt,
      verifier: backup.vault.verifier,
      iterations: backup.vault.iterations,
      wrappedDEK: backup.vault.wrappedDEK,
      createdAt: backup.vault.createdAt,
    };
    const entries: StoredEntry[] = backup.entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      content: e.content,
      deleted: false,
      dirty: true, // restored records should upload on first sync
    }));
    const strands: StoredStrand[] = backup.strands.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      content: s.content,
      deleted: false,
      dirty: true,
    }));
    const dayNotesToRestore: StoredDayNote[] = backup.dayNotes.map((n) => ({
      id: n.id,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      content: n.content,
      deleted: false,
      dirty: true,
    }));
    await importData(vault, entries, strands, dayNotesToRestore);
    setVaultState("locked");
  }, []);

  // ---- Day notes -----------------------------------------------------------
  // A light title/reflection for a single day, keyed by dayKey — never a full
  // Strand (STRANDS_PLAN.md §1). Pass an empty string to clear it.

  const setDayNote = useCallback(
    async (ts: number, text: string) => {
      const key = keyRef.current;
      if (!key) return;
      const k = dayKey(ts);
      const trimmed = text.trim();
      const updatedAt = Date.now();
      setDayNotes((prev) => {
        const next = { ...prev };
        if (trimmed) next[k] = { key: k, text: trimmed, updatedAt };
        else delete next[k];
        return next;
      });
      const content = await encryptString(key, trimmed ? encodeDayNote(trimmed) : "");
      const record: StoredDayNote = {
        id: k,
        createdAt: updatedAt,
        updatedAt,
        content,
        deleted: !trimmed,
        dirty: true,
      };
      await putStoredDayNote(record);
      scheduleSync();
    },
    [scheduleSync]
  );

  // ---- Strands -----------------------------------------------------------

  const persistStrand = useCallback(async (strand: Strand, deleted = false) => {
    const key = keyRef.current;
    if (!key) return;
    const content = await encryptString(
      key,
      deleted ? "" : encodeStrand(strand.title, strand.entryIds)
    );
    const record: StoredStrand = {
      id: strand.id,
      createdAt: strand.createdAt,
      updatedAt: strand.updatedAt,
      content,
      deleted,
      dirty: true,
    };
    await putStoredStrand(record);
  }, []);

  const guardedStrandPersist = useCallback(
    async (strand: Strand, deleted = false) => {
      try {
        await persistStrand(strand, deleted);
        setSaveError(null);
        scheduleSync();
      } catch {
        setSaveError({
          message: "Couldn't save that strand to this device.",
          retry: () => void guardedStrandPersist(strand, deleted),
        });
      }
    },
    [persistStrand, scheduleSync]
  );

  // Apply a change to one strand (bumping updatedAt) and persist it.
  const mutateStrand = useCallback(
    async (id: string, change: (s: Strand) => Strand) => {
      let updated: Strand | null = null;
      setStrands((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          updated = { ...change(s), updatedAt: Date.now() };
          return updated;
        })
      );
      if (updated) await guardedStrandPersist(updated);
    },
    [guardedStrandPersist]
  );

  const createStrand = useCallback(
    async (title: string): Promise<Strand> => {
      const t = Date.now();
      const strand: Strand = { id: uid(), title: title.trim(), entryIds: [], createdAt: t, updatedAt: t };
      setStrands((prev) => [strand, ...prev]);
      await guardedStrandPersist(strand);
      return strand;
    },
    [guardedStrandPersist]
  );

  const renameStrand = useCallback(
    (id: string, title: string) => mutateStrand(id, (s) => ({ ...s, title: title.trim() })),
    [mutateStrand]
  );

  const deleteStrand = useCallback(
    async (strand: Strand) => {
      setStrands((prev) => prev.filter((s) => s.id !== strand.id));
      await guardedStrandPersist({ ...strand, updatedAt: Date.now() }, true);
    },
    [guardedStrandPersist]
  );

  // Add an existing thought to a strand (no-op if already a member).
  const addToStrand = useCallback(
    (strandId: string, entryId: string) =>
      mutateStrand(strandId, (s) =>
        s.entryIds.includes(entryId) ? s : { ...s, entryIds: [...s.entryIds, entryId] }
      ),
    [mutateStrand]
  );

  // Insert right after a specific piece (e.g. the last piece in a chapter),
  // instead of always appending to the very end of the strand. Falls back to
  // appending if `afterId` is missing or no longer in the strand.
  const addToStrandAfter = useCallback(
    (strandId: string, entryId: string, afterId: string | null) =>
      mutateStrand(strandId, (s) => {
        if (s.entryIds.includes(entryId)) return s;
        const idx = afterId ? s.entryIds.indexOf(afterId) : -1;
        if (idx === -1) return { ...s, entryIds: [...s.entryIds, entryId] };
        const ids = [...s.entryIds];
        ids.splice(idx + 1, 0, entryId);
        return { ...s, entryIds: ids };
      }),
    [mutateStrand]
  );

  const removeFromStrand = useCallback(
    (strandId: string, entryId: string) =>
      mutateStrand(strandId, (s) => ({ ...s, entryIds: s.entryIds.filter((id) => id !== entryId) })),
    [mutateStrand]
  );

  const reorderStrand = useCallback(
    (strandId: string, entryIds: string[]) => mutateStrand(strandId, (s) => ({ ...s, entryIds })),
    [mutateStrand]
  );

  // Write a brand-new piece directly into a strand: it becomes an ordinary
  // thought (also in the Stream) and is appended to the strand's order.
  const writeInStrand = useCallback(
    async (strandId: string, text: string) => {
      const entry = await createEntry(text);
      await addToStrand(strandId, entry.id);
    },
    [createEntry, addToStrand]
  );

  // Write a piece into a specific chapter (STRANDS_PLAN.md §2): lands at the
  // end of that heading's section rather than the end of the whole strand, so
  // adding several pieces to the same chapter in a row doesn't need reordering.
  const writeInStrandAfter = useCallback(
    async (strandId: string, text: string, afterId: string | null) => {
      const entry = await createEntry(text);
      await addToStrandAfter(strandId, entry.id, afterId);
    },
    [createEntry, addToStrandAfter]
  );

  // Start a new chapter in one step: write + flag as a heading together,
  // rather than writing a plain piece and separately flagging it after.
  const writeChapterInStrand = useCallback(
    async (strandId: string, title: string) => {
      const entry = await createEntry(title, true);
      await addToStrand(strandId, entry.id);
    },
    [createEntry, addToStrand]
  );

  // Drop a photo straight into a strand as its own piece: a captionless thought
  // (empty text) carrying the image, appended to the strand.
  const addPhotoToStrand = useCallback(
    async (strandId: string, file: File) => {
      const entry = await createEntry("");
      await attachMedia(entry.id, file);
      await addToStrand(strandId, entry.id);
    },
    [createEntry, attachMedia, addToStrand]
  );

  // ---- Shared strands (co-authored, E2E) --------------------------------
  // These live only in memory (unwrapped DEK + decrypted pieces). The server
  // stores opaque ciphertext; a breach yields nothing readable. See
  // SHARING_PLAN.md. v1 is text pieces only. (loadSharedStrands + its helpers
  // live earlier in the file, near ensureIdentity, because the open effect
  // depends on them.)

  // Start a new shared strand you own: mint a DEK, register it (wrapped to
  // yourself), and push an initial meta record. Returns an error message or null.
  const createSharedStrand = useCallback(
    async (title: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Connect an account in Settings first, so you can share.";
      await ensureIdentity();
      const kp = identityRef.current;
      if (!kp) return "Sharing isn't ready yet — give it a moment and try again.";
      try {
        const dek = await generateDEK();
        const strandId = uid();
        const selfPub = await exportPublicKeyB64(kp.publicKey);
        const { ephemeralPub, wrappedDEK } = await wrapDEKForRecipient(selfPub, dek);
        await createShared(token, strandId, ephemeralPub, wrappedDEK);
        const t = Date.now();
        const clean = title.trim() || "Untitled";
        const metaContent = await encryptString(dek, encodeStrand(clean, []));
        await sharedPush(token, strandId, [
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: 1, content: metaContent },
        ]);
        sharedRef.current.set(strandId, {
          strandId,
          ownerId: "me",
          role: "owner",
          dek,
          dekEpoch: 1,
          cursor: 0,
          title: clean,
          entryIds: [],
          pieces: {},
        });
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't create the shared strand.";
      }
    },
    [ensureIdentity, publishShared]
  );

  // Invite someone (by email) into a shared strand: look up their public key,
  // wrap the strand DEK to it, and register their membership. They must already
  // have a Driftless account. Returns an error message or null.
  const inviteToSharedStrand = useCallback(
    async (strandId: string, email: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready to share yet.";
      const em = email.trim().toLowerCase();
      if (!em) return "Enter an email to share with.";
      try {
        const { identityPublicKey } = await fetchKeys(token, em);
        if (!identityPublicKey)
          return "No Driftless account for that email yet — ask them to sign up first, then invite.";
        const { ephemeralPub, wrappedDEK } = await wrapDEKForRecipient(identityPublicKey, live.dek);
        await inviteToStrand(token, strandId, em, ephemeralPub, wrappedDEK, live.dekEpoch);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't send that invite.";
      }
    },
    []
  );

  // Add a piece to a shared strand: encrypt with the DEK and push it plus the
  // updated order. Shared content is server-backed (not local-first), so the UI
  // reflects it only once the push succeeds. Returns an error message or null.
  const writeInSharedStrand = useCallback(
    async (strandId: string, text: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      const body = text.trim();
      if (!body) return null;
      try {
        const pieceId = uid();
        const t = Date.now();
        // Base the new order on every piece we currently know about (including
        // any that a concurrent write orphaned from the meta), so writing heals
        // the order instead of dropping a co-author's piece.
        const entryIds = [...sharedPieces(live).map((p) => p.id), pieceId];
        const pieceContent = await encryptString(live.dek, encodePayload(body));
        const metaContent = await encryptString(live.dek, encodeStrand(live.title, entryIds));
        await sharedPush(token, strandId, [
          { kind: "piece", id: pieceId, createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: pieceContent },
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: metaContent },
        ] as SharedRecord[]);
        live.entryIds = entryIds;
        live.pieces[pieceId] = { id: pieceId, text: body, createdAt: t, updatedAt: t };
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "Couldn't add that just now — check your connection and try again.";
      }
    },
    [publishShared]
  );

  // Rename a shared strand (updates the title in the meta record).
  const renameSharedStrand = useCallback(
    async (strandId: string, title: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      const clean = title.trim() || "Untitled";
      try {
        const t = Date.now();
        live.title = clean;
        await sharedPush(token, strandId, [
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: await encryptString(live.dek, encodeStrand(clean, sharedPieces(live).map((p) => p.id))) },
        ] as SharedRecord[]);
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't rename that strand.";
      }
    },
    [publishShared]
  );

  // Delete a piece from a shared strand (tombstone + drop from order), and free
  // any photos it held from storage.
  const deleteSharedPiece = useCallback(
    async (strandId: string, pieceId: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      try {
        const piece = live.pieces[pieceId];
        const t = Date.now();
        const entryIds = sharedPieces(live)
          .map((p) => p.id)
          .filter((id) => id !== pieceId);
        await sharedPush(token, strandId, [
          { kind: "piece", id: pieceId, createdAt: t, updatedAt: t, deleted: true, dekEpoch: live.dekEpoch, content: await encryptString(live.dek, "") },
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: await encryptString(live.dek, encodeStrand(live.title, entryIds)) },
        ] as SharedRecord[]);
        for (const mid of piece?.mediaIds ?? []) {
          try {
            await deleteSharedMediaRemote(token, strandId, mid);
          } catch {
            // storage cleanup is best-effort
          }
          mediaUrls.current.delete(mid);
        }
        delete live.pieces[pieceId];
        live.entryIds = entryIds;
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't delete that piece.";
      }
    },
    [publishShared]
  );

  // Add a photo to a shared strand (M2): compress → encrypt with the strand DEK
  // → upload to R2 (membership-gated) → append a photo piece. Like writeIn but
  // carrying a captionless image, mirroring addPhotoToStrand for personal ones.
  const addPhotoToSharedStrand = useCallback(
    async (strandId: string, file: File): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      try {
        const { bytes, type } = await compressImage(file);
        const cb = await encryptBytes(live.dek, bytes);
        const mediaId = uid();
        await uploadSharedMedia(token, strandId, mediaId, cb.iv, cb.data, type);
        const pieceId = uid();
        const t = Date.now();
        const entryIds = [...sharedPieces(live).map((p) => p.id), pieceId];
        const pieceContent = await encryptString(live.dek, encodePayload("", undefined, [mediaId]));
        const metaContent = await encryptString(live.dek, encodeStrand(live.title, entryIds));
        await sharedPush(token, strandId, [
          { kind: "piece", id: pieceId, createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: pieceContent },
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: metaContent },
        ] as SharedRecord[]);
        live.entryIds = entryIds;
        live.pieces[pieceId] = { id: pieceId, text: "", mediaIds: [mediaId], createdAt: t, updatedAt: t };
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't add that photo just now — try again.";
      }
    },
    [publishShared]
  );

  // Decrypt + cache a shared photo (fetched from R2, decrypted with the strand
  // DEK). In-memory only, like the rest of shared content.
  const getSharedMediaUrl = useCallback(
    async (strandId: string, mediaId: string): Promise<string | null> => {
      const cached = mediaUrls.current.get(mediaId);
      if (cached) return cached;
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return null;
      try {
        const dl = await downloadSharedMedia(token, strandId, mediaId);
        if (!dl) return null;
        const bytes = await decryptBytes(live.dek, { iv: dl.iv, data: dl.data });
        const url = `data:${dl.type};base64,${bytesToBase64(bytes)}`;
        mediaUrls.current.set(mediaId, url);
        return url;
      } catch {
        return null;
      }
    },
    []
  );

  // Add one piece to a shared strand carrying text and/or photos together (so
  // words and pictures intertwine, like a personal strand). Compresses every
  // photo first, so a bad/unsupported image fails before anything is uploaded.
  const addSharedPiece = useCallback(
    async (strandId: string, text: string, files: File[]): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      const body = text.trim();
      if (!body && files.length === 0) return null;
      try {
        const compressed = [];
        for (const f of files) compressed.push(await compressImage(f));
        const mediaIds: string[] = [];
        for (const c of compressed) {
          const cb = await encryptBytes(live.dek, c.bytes);
          const mediaId = uid();
          await uploadSharedMedia(token, strandId, mediaId, cb.iv, cb.data, c.type);
          mediaIds.push(mediaId);
        }
        const pieceId = uid();
        const t = Date.now();
        const entryIds = [...sharedPieces(live).map((p) => p.id), pieceId];
        const author = myUserIdRef.current ?? undefined;
        const content = await encryptString(live.dek, encodePayload(body, undefined, mediaIds.length ? mediaIds : undefined, undefined, author));
        const meta = await encryptString(live.dek, encodeStrand(live.title, entryIds));
        await sharedPush(token, strandId, [
          { kind: "piece", id: pieceId, createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content },
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: meta },
        ] as SharedRecord[]);
        live.entryIds = entryIds;
        live.pieces[pieceId] = { id: pieceId, text: body, mediaIds: mediaIds.length ? mediaIds : undefined, author, createdAt: t, updatedAt: t };
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't add that just now — try again.";
      }
    },
    [publishShared]
  );

  // Edit a shared piece's text (photos unchanged).
  const editSharedPiece = useCallback(
    async (strandId: string, pieceId: string, text: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      const piece = live?.pieces[pieceId];
      if (!token || !live || !piece) return "This strand isn't ready yet.";
      try {
        const t = Date.now();
        const content = await encryptString(live.dek, encodePayload(text.trim(), undefined, piece.mediaIds, undefined, piece.author));
        await sharedPush(token, strandId, [
          { kind: "piece", id: pieceId, createdAt: piece.createdAt, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content },
        ] as SharedRecord[]);
        live.pieces[pieceId] = { ...piece, text: text.trim(), updatedAt: t };
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't save that edit.";
      }
    },
    [publishShared]
  );

  // Reorder a shared strand's pieces (updates the order in the meta record).
  const reorderSharedStrand = useCallback(
    async (strandId: string, entryIds: string[]): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready yet.";
      try {
        const t = Date.now();
        await sharedPush(token, strandId, [
          { kind: "meta", id: "meta", createdAt: t, updatedAt: t, deleted: false, dekEpoch: live.dekEpoch, content: await encryptString(live.dek, encodeStrand(live.title, entryIds)) },
        ] as SharedRecord[]);
        live.entryIds = entryIds;
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't reorder that.";
      }
    },
    [publishShared]
  );

  // Who's in a shared strand (name + role), for the members panel.
  const fetchStrandMembers = useCallback(async (strandId: string): Promise<StrandMember[]> => {
    const token = tokenRef.current;
    if (!token) return [];
    try {
      const { members } = await sharedMembers(token, strandId);
      return members;
    } catch {
      return [];
    }
  }, []);

  // Re-key a strand: mint a fresh DEK, re-encrypt the meta + every piece under
  // it at the next epoch, and re-wrap that DEK to each remaining member. A
  // removed member holds only the old DEK — which now decrypts nothing on the
  // server — so future (and re-encrypted) content stays out of reach. Remaining
  // members detect the epoch bump on their next load and rebuild transparently.
  const rotateDEK = useCallback(async (live: LiveShared) => {
    const token = tokenRef.current;
    if (!token) return;
    const newDek = await generateDEK();
    const newEpoch = live.dekEpoch + 1;
    const t = Date.now();
    const changes: SharedRecord[] = [
      {
        kind: "meta",
        id: "meta",
        createdAt: t,
        updatedAt: t,
        deleted: false,
        dekEpoch: newEpoch,
        content: await encryptString(newDek, encodeStrand(live.title, live.entryIds)),
      },
    ];
    for (const pid of Object.keys(live.pieces)) {
      const p = live.pieces[pid];
      changes.push({
        kind: "piece",
        id: pid,
        createdAt: p.createdAt,
        updatedAt: t,
        deleted: false,
        dekEpoch: newEpoch,
        content: await encryptString(newDek, encodePayload(p.text, undefined, p.mediaIds, undefined, p.author)),
      });
    }
    // Push in bounded batches (server caps a push; family strands are small).
    let cursor = live.cursor;
    for (let i = 0; i < changes.length; i += 400) {
      const res = await sharedPush(token, live.strandId, changes.slice(i, i + 400));
      cursor = res.cursor;
    }
    // Re-key shared photos too (M3): decrypt each with the old DEK and re-upload
    // under the new one, so photos added before the removal keep displaying for
    // the remaining members. Best-effort per photo.
    const oldDek = live.dek;
    const mediaIds = [...new Set(Object.values(live.pieces).flatMap((p) => p.mediaIds ?? []))];
    for (const mid of mediaIds) {
      try {
        const dl = await downloadSharedMedia(token, live.strandId, mid);
        if (!dl) continue;
        const plain = await decryptBytes(oldDek, { iv: dl.iv, data: dl.data });
        const cb = await encryptBytes(newDek, plain);
        await uploadSharedMedia(token, live.strandId, mid, cb.iv, cb.data, dl.type);
      } catch {
        // skip any that fail; the rest still re-key
      }
    }
    // Re-wrap the new DEK to everyone still in the strand (including ourselves).
    const { members } = await sharedMembers(token, live.strandId);
    for (const m of members) {
      if (!m.identityPublicKey) continue;
      const { ephemeralPub, wrappedDEK } = await wrapDEKForRecipient(m.identityPublicKey, newDek);
      await inviteToStrand(token, live.strandId, m.email, ephemeralPub, wrappedDEK, newEpoch);
    }
    live.dek = newDek;
    live.dekEpoch = newEpoch;
    live.cursor = cursor;
    // Drop cached decrypted URLs for re-keyed photos so a later fetch uses the
    // new key (the plaintext is identical, but keep the cache honest).
    for (const mid of mediaIds) mediaUrls.current.delete(mid);
  }, []);

  // Owner removes a member, then re-keys so they can't read anything new.
  const removeSharedMember = useCallback(
    async (strandId: string, userId: string): Promise<string | null> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return "This strand isn't ready.";
      try {
        await sharedRemove(token, strandId, userId);
        await rotateDEK(live);
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't remove that member.";
      }
    },
    [rotateDEK, publishShared]
  );

  // Leave a strand shared with you. Local copy is dropped immediately.
  const leaveSharedStrand = useCallback(
    async (strandId: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Not connected.";
      try {
        await sharedLeave(token, strandId);
        sharedRef.current.delete(strandId);
        publishShared();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't leave that strand.";
      }
    },
    [publishShared]
  );

  // Mint a shareable invite link for a strand: a random secret → HKDF wrapKey
  // (encrypts the DEK, opaque to the server) + joinProof (server stores only its
  // hash). The secret rides in the URL fragment, never sent to the server.
  const createInviteLink = useCallback(
    async (strandId: string): Promise<{ link: string } | { error: string }> => {
      const token = tokenRef.current;
      const live = sharedRef.current.get(strandId);
      if (!token || !live) return { error: "This strand isn't ready to share yet." };
      try {
        const linkSecret = randomLinkSecret();
        const { wrapKey, joinProof } = await deriveInviteKeys(linkSecret);
        const inviteId = uid();
        const wrappedDEK = await linkWrapDEK(wrapKey, live.dek);
        const joinProofHash = await sha256B64(joinProof);
        const expiresAt = Date.now() + 7 * 86_400_000; // 7 days
        await apiCreateInviteLink(token, strandId, inviteId, wrappedDEK, joinProofHash, live.dekEpoch, expiresAt, 20);
        return { link: `${location.origin}/#join=${inviteId}.${b64url(linkSecret)}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Couldn't create a link." };
      }
    },
    []
  );

  // Redeem an invite link: prove the joinProof → get the wrapped DEK → unwrap
  // with the link's wrapKey → re-wrap to our own identity → register membership.
  const joinViaInvite = useCallback(
    async (inviteId: string, linkSecretB64: string): Promise<string | null> => {
      const token = tokenRef.current;
      if (!token) return "Connect an account to join.";
      await ensureIdentity();
      const kp = identityRef.current;
      if (!kp) return "Sharing isn't ready yet — try again in a moment.";
      try {
        const { wrapKey, joinProof } = await deriveInviteKeys(fromB64url(linkSecretB64));
        const proofB64 = toBase64(joinProof);
        const claim = await joinClaim(token, inviteId, proofB64);
        const dek = await linkUnwrapDEK(wrapKey, claim.wrappedDEK);
        const selfPub = await exportPublicKeyB64(kp.publicKey);
        const { ephemeralPub, wrappedDEK } = await wrapDEKForRecipient(selfPub, dek);
        await joinFinish(token, inviteId, proofB64, ephemeralPub, wrappedDEK);
        await loadSharedStrands();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't join with that link.";
      }
    },
    [ensureIdentity, loadSharedStrands]
  );

  // ---- Sync account (opt-in) --------------------------------------------


  // Sign in on a NEW device to join an existing account: fetch the vault, save
  // it, then drop to the unlock screen so the passphrase re-derives the key and
  // pulls everything. Only for a fresh device (no local vault yet).
  const connectSignIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (await getVault())
        return "This device already has a journal — sign-in is for a new device.";
      const em = email.trim().toLowerCase();
      try {
        const { token, userId } = await login(em, password);
        myUserIdRef.current = userId;
        setMyUserId(userId);
        const meta = await fetchVault(token);
        await saveVault({
          id: "vault",
          salt: meta.salt,
          verifier: meta.verifier,
          iterations: meta.iterations,
          wrappedDEK: meta.wrappedDEK ?? undefined,
          createdAt: Date.now(),
        });
        tokenRef.current = token;
        await saveSyncState({ id: "state", cursor: 0, token, accountEmail: em });
        setAccount(em);
        setVaultState("locked"); // unlock with the passphrase → pulls the journal
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't sign in.";
      }
    },
    []
  );

  // Stop syncing on this device. Local data stays; the account is untouched.
  const disconnectAccount = useCallback(async () => {
    tokenRef.current = null;
    setAccount(null);
    sharedRef.current.clear();
    setSharedStrands([]);
    myUserIdRef.current = null;
    setMyUserId(null);
    await saveSyncState({ id: "state", cursor: 0 });
  }, []);

  // Permanently delete the account and every blob the server holds, then
  // disconnect this device. The journal on this device is untouched — only the
  // cloud copy is removed. Returns an error message (e.g. the server's refusal
  // when you still own a shared strand others are in), or null on success.
  const deleteAccount = useCallback(async (): Promise<string | null> => {
    const token = tokenRef.current;
    if (!token) return null;
    try {
      await apiDeleteAccount(token);
      await disconnectAccount();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't delete the account.";
    }
  }, [disconnectAccount]);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    vaultState,
    entries,
    saveError,
    clearSaveError,
    bioSupported,
    bioEnrolled,
    biometricUnlock,
    enableBiometric,
    disableBiometric,
    createVault,
    unlock,
    lock,
    addEntry,
    updateEntry,
    removeEntry,
    restoreEntry,
    setAnchor,
    setHeading,
    attachMedia,
    removeMedia,
    setMediaConfig,
    getMediaUrl,
    dayNotes,
    setDayNote,
    strands,
    createStrand,
    renameStrand,
    deleteStrand,
    addToStrand,
    removeFromStrand,
    reorderStrand,
    writeInStrand,
    writeInStrandAfter,
    writeChapterInStrand,
    addPhotoToStrand,
    exportBackup,
    restoreBackup,
    account,
    connectCreateAccount,
    connectSignIn,
    disconnectAccount,
    deleteAccount,
    changePassphrase,
    syncNow: runSync,
    sharedStrands,
    createSharedStrand,
    inviteToSharedStrand,
    writeInSharedStrand,
    fetchStrandMembers,
    removeSharedMember,
    leaveSharedStrand,
    createInviteLink,
    joinViaInvite,
    addPhotoToSharedStrand,
    addSharedPiece,
    editSharedPiece,
    reorderSharedStrand,
    getSharedMediaUrl,
    renameSharedStrand,
    deleteSharedPiece,
    myUserId,
    refreshShared: loadSharedStrands,
    guardianCircle,
    loadGuardianCircle,
    setupGuardians,
    recoveryStatus,
    refreshRecoveryStatus,
    cancelPendingRecovery,
    pendingGuardianRequests,
    refreshPendingGuardianRequests,
    approveGuardianRequest,
    recoverySignIn,
    startRecoveryRequest,
    pollRecoveryRequest,
    cancelRecoveryRequest,
    finishRecoveryRequest,
  };
}
