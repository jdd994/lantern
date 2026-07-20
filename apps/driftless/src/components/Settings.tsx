// Settings.tsx
// "Set the mood" — a calm sheet to pick a warm theme and toggle night-dimming.
// Same modal shape as HelpSheet. Preview swatches carry their own colors so you
// see each mood even while a different one is active.
import { useEffect, useRef, useState } from "react";
import type { Mood } from "../hooks/useSettings";
import type { RecoveryCircleInfo, RecoveryStatus, PendingForMe } from "../lib/api";

type MoodInfo = { id: Mood; name: string; desc: string; bg: string; ink: string; amber: string };

const MOODS: MoodInfo[] = [
  { id: "lamplight", name: "Lamplight", desc: "Warm amber, cozy", bg: "#14110B", ink: "#E7DCC7", amber: "#DBA14A" },
  { id: "ember", name: "Ember", desc: "Deeper, redder", bg: "#17100B", ink: "#EBD9C0", amber: "#E0954A" },
  { id: "candle", name: "Candle", desc: "Dim, hushed", bg: "#110E09", ink: "#D6CBB5", amber: "#CE9A50" },
  { id: "parchment", name: "Parchment", desc: "Soft daylight paper", bg: "#ECE3D1", ink: "#3A3121", amber: "#B67A2A" },
];

type Props = {
  onClose: () => void;
  mood: Mood;
  onMood: (m: Mood) => void;
  nightDim: boolean;
  onNightDim: (on: boolean) => void;
  account: string | null;
  onCreateAccount: (email: string, password: string) => Promise<string | null>;
  onDisconnect: () => void;
  onDeleteAccount: () => Promise<string | null>;
  onSyncNow: () => void;
  // QR device linking — see LinkNewDevice in LockScreen.tsx for the other half
  // (the new device showing the code this scans).
  onLinkNewDeviceFromScan: (qrText: string) => Promise<string | null>;
  onCancelDeviceLink: (qrText: string) => Promise<string | null>;
  onChangePassphrase: (current: string, next: string) => Promise<string | null>;
  guardianCircle: RecoveryCircleInfo | null;
  onSetupGuardians: (guardians: { email: string; codeword: string }[], k: number, delayMs: number) => Promise<string | null>;
  recoveryStatus: RecoveryStatus;
  onCancelPendingRecovery: () => Promise<string | null>;
  pendingGuardianRequests: PendingForMe[];
  onApproveGuardianRequest: (requestId: string, codeword: string) => Promise<string | null>;
};

const DELAY_OPTIONS = [
  { label: "24 hours", ms: 24 * 3_600_000 },
  { label: "48 hours", ms: 48 * 3_600_000 },
  { label: "4 days", ms: 96 * 3_600_000 },
  { label: "1 week", ms: 7 * 24 * 3_600_000 },
];

// Guardians who can jointly help recover a forgotten passphrase — see
// HelpSheet's "Guardians" section for the plain-language explanation and why
// the codeword must never be typed anywhere but the setup form below and the
// guardian's own approval, never sent in a message or email.
function GuardiansSection({
  guardianCircle,
  onSetupGuardians,
  recoveryStatus,
  onCancelPendingRecovery,
}: Pick<Props, "guardianCircle" | "onSetupGuardians" | "recoveryStatus" | "onCancelPendingRecovery">) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ email: string; codeword: string }[]>([
    { email: "", codeword: "" },
    { email: "", codeword: "" },
    { email: "", codeword: "" },
  ]);
  const [k, setK] = useState(2);
  const [delayMs, setDelayMs] = useState(DELAY_OPTIONS[1].ms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  function updateRow(i: number, field: "email" | "codeword", value: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  async function submit() {
    setError(null);
    const guardians = rows.filter((r) => r.email.trim() && r.codeword.trim());
    if (guardians.length < 2) return setError("Add at least 2 guardians, each with a codeword.");
    if (k < 2 || k > guardians.length) return setError("Choose how many must approve — at least 2, at most the number of guardians.");
    setBusy(true);
    const err = await onSetupGuardians(guardians, k, delayMs);
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    setDone(true);
    setTimeout(() => setDone(false), 4000);
  }

  return (
    <section>
      <h3>Guardians</h3>
      {recoveryStatus && (
        <div className="danger-zone">
          <p className="lock-error">
            Someone started recovering this account {new Date(recoveryStatus.createdAt).toLocaleString()} —{" "}
            {recoveryStatus.approvals} of {recoveryStatus.k} guardians have approved. If this wasn't you, cancel it now.
          </p>
          <button
            className="ghost-btn danger"
            disabled={cancelBusy}
            onClick={async () => {
              setCancelBusy(true);
              await onCancelPendingRecovery();
              setCancelBusy(false);
            }}
          >
            {cancelBusy ? "Cancelling…" : "This wasn't me — cancel it"}
          </button>
        </div>
      )}
      {done ? (
        <p className="account-status">Guardians are set. Ask each one to expect a request someday, never today.</p>
      ) : !open ? (
        <>
          {guardianCircle ? (
            <p className="account-status">
              {guardianCircle.k} of {guardianCircle.n} guardians can recover this account:{" "}
              {guardianCircle.guardians.map((g) => g.email).join(", ")}.
            </p>
          ) : (
            <p className="account-blurb">
              If you ever forget your passphrase, trusted guardians can jointly help you back in —
              without us, or any one of them alone, ever holding the key. See Help for how it works.
            </p>
          )}
          <button className="ghost-btn" onClick={() => setOpen(true)}>
            {guardianCircle ? "Change guardians" : "Set up guardians"}
          </button>
        </>
      ) : (
        <div className="account-form">
          <p className="account-hint">
            Tell each guardian their codeword <b>out loud</b> — in person or by phone, never by
            message or email. It's the second lock; we never see it either.
          </p>
          {rows.map((row, i) => (
            <div className="edit-foot" key={i}>
              <input
                className="anchor-input"
                type="email"
                placeholder="Guardian's email"
                value={row.email}
                onChange={(e) => updateRow(i, "email", e.target.value)}
              />
              <input
                className="anchor-input"
                type="text"
                placeholder="Codeword (told out loud)"
                value={row.codeword}
                onChange={(e) => updateRow(i, "codeword", e.target.value)}
              />
            </div>
          ))}
          <button className="linklike" onClick={() => setRows((r) => [...r, { email: "", codeword: "" }])}>
            + Add another guardian
          </button>
          <div className="edit-foot">
            <label>
              How many must approve:{" "}
              <select value={k} onChange={(e) => setK(Number(e.target.value))}>
                {rows.map((_, i) => (
                  <option key={i} value={i + 1} disabled={i + 1 < 2}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="edit-foot">
            <label>
              Waiting period before it completes:{" "}
              <select value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))}>
                {DELAY_OPTIONS.map((o) => (
                  <option key={o.ms} value={o.ms}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="lock-error">{error}</p>}
          <div className="edit-foot">
            <button className="ghost-btn" onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </button>
            <button className="ghost-btn" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Save guardians"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// "Help a friend" — approving someone else's recovery request. Low-key on
// purpose: only shows up when there's actually something to do, no badge, no
// count elsewhere in the app.
function GuardianApprovalsSection({
  pendingGuardianRequests,
  onApproveGuardianRequest,
}: Pick<Props, "pendingGuardianRequests" | "onApproveGuardianRequest">) {
  const [codewords, setCodewords] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Tracked separately from pendingGuardianRequests: approving a request makes
  // the server stop returning it (see GET /recovery/pending-for-me's "haven't
  // approved yet" filter), which refreshes the list out from under this
  // component the instant approval succeeds. Without its own memory of what
  // it just did, the "Approved for X" confirmation would never be visible —
  // the section would just silently lose that row.
  const [done, setDone] = useState<{ requestId: string; ownerEmail: string }[]>([]);

  if (pendingGuardianRequests.length === 0 && done.length === 0) return null;

  async function approve(requestId: string, ownerEmail: string) {
    setErrors((e) => ({ ...e, [requestId]: "" }));
    setBusyId(requestId);
    const err = await onApproveGuardianRequest(requestId, codewords[requestId] ?? "");
    setBusyId(null);
    if (err) setErrors((e) => ({ ...e, [requestId]: err }));
    else setDone((d) => [...d, { requestId, ownerEmail }]);
  }

  return (
    <section>
      <h3>Help a friend</h3>
      {done.map((d) => (
        <p key={d.requestId} className="account-status">Approved for {d.ownerEmail}.</p>
      ))}
      {pendingGuardianRequests.map((r) => (
          <div key={r.requestId} className="account-form">
            <p className="account-blurb">
              {r.ownerEmail} is trying to recover their account ({r.k} of {r.n} guardians needed).
              Ask them for their codeword, out loud, before approving.
            </p>
            <input
              className="anchor-input"
              type="text"
              placeholder="Their codeword"
              value={codewords[r.requestId] ?? ""}
              onChange={(e) => setCodewords((c) => ({ ...c, [r.requestId]: e.target.value }))}
            />
            {errors[r.requestId] && <p className="lock-error">{errors[r.requestId]}</p>}
            <div className="edit-foot">
              <button
                className="ghost-btn"
                disabled={busyId === r.requestId}
                onClick={() => approve(r.requestId, r.ownerEmail)}
              >
                {busyId === r.requestId ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
      ))}
    </section>
  );
}

// Change the passphrase (only while unlocked). Thanks to envelope encryption this
// is instant and doesn't re-encrypt anything; the copy explains it won't lock out
// other devices — they just ask for the new passphrase next time they sign in.
function ChangePassphraseSection({
  onChangePassphrase,
}: Pick<Props, "onChangePassphrase">) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setCurrent(""); setNext(""); setConfirm(""); setError(null);
  }

  async function submit() {
    setError(null);
    if (next.length < 8) return setError("Use at least 8 characters — a few plain words you'll remember.");
    if (next !== confirm) return setError("The new passphrases don't match.");
    setBusy(true);
    const err = await onChangePassphrase(current, next);
    setBusy(false);
    if (err) return setError(err);
    reset();
    setOpen(false);
    setDone(true);
    setTimeout(() => setDone(false), 4000);
  }

  return (
    <section>
      <h3>Passphrase</h3>
      {done ? (
        <p className="account-status">Passphrase changed. Your notes never left this device.</p>
      ) : !open ? (
        <>
          <p className="account-blurb">
            Change the passphrase that unlocks this vault. It happens on your device — nothing is
            re-uploaded, and your other signed-in devices simply ask for the new one next time.
          </p>
          <button className="ghost-btn" onClick={() => setOpen(true)}>
            Change passphrase
          </button>
        </>
      ) : (
        <div className="account-form">
          {error && <p className="lock-error">{error}</p>}
          <input
            className="anchor-input" type="password" placeholder="Current passphrase"
            autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className="anchor-input" type="password" placeholder="New passphrase"
            autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
          />
          <input
            className="anchor-input" type="password" placeholder="New passphrase again"
            autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="edit-foot">
            <button className="ghost-btn" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
            <button className="ghost-btn" disabled={busy || !current || !next} onClick={submit}>
              {busy ? "Changing…" : "Change it"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Minimal shape of the standard BarcodeDetector API — not yet in TS's DOM lib.
// Supported in Chromium-based browsers; elsewhere `unsupported` shows a
// plain-language fallback (sign in on the new device instead).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
function getBarcodeDetector(): (new (opts: { formats: string[] }) => BarcodeDetectorLike) | null {
  return (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike })
    .BarcodeDetector ?? null;
}

// Scan the code shown on a new, unset-up device and hand it a live copy of
// this account (token + vault + DEK) — see @lantern/core/pairing. The camera
// only ever opens after this section is explicitly opened, and its stream is
// torn down the moment a code is found, cancelled, or this unmounts.
function LinkDeviceScanner({
  onLinkNewDeviceFromScan,
  onCancelDeviceLink,
  onClose,
}: Pick<Props, "onLinkNewDeviceFromScan" | "onCancelDeviceLink"> & { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkedQr, setLinkedQr] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const Detector = getBarcodeDetector();
    if (!Detector) {
      setUnsupported(true);
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let cancelled = false;
    let raf = 0;
    let scanning = false;

    async function scanFrame() {
      if (cancelled || !videoRef.current) return;
      if (!scanning) {
        scanning = true;
        try {
          const codes = await detector.detect(videoRef.current!);
          const hit = codes.find((c) => c.rawValue?.startsWith("driftless-pair:"));
          if (hit) {
            const err = await onLinkNewDeviceFromScan(hit.rawValue);
            streamRef.current?.getTracks().forEach((t) => t.stop());
            if (cancelled) return;
            if (err) setError(err);
            else setLinkedQr(hit.rawValue);
            return; // stop the loop either way — a fresh open re-starts it
          }
        } catch {
          // an undecodable frame isn't an error — just try the next one
        }
        scanning = false;
      }
      raf = requestAnimationFrame(scanFrame);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        raf = requestAnimationFrame(scanFrame);
      })
      .catch(() => setError("Couldn't access the camera — check this site's camera permission."));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function undo() {
    if (!linkedQr) return;
    await onCancelDeviceLink(linkedQr);
    setUndone(true);
  }

  if (unsupported) {
    return (
      <div className="account-form">
        <p className="lock-error">
          This browser can't scan codes in-app yet. On the new device, use "Joining from another
          device? Sign in" with your account email and password instead.
        </p>
        <button className="ghost-btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (linkedQr) {
    return (
      <div className="account-form">
        <p className="account-status">
          {undone ? "Undone — that device is no longer linked." : "Device linked."}
        </p>
        {!undone && (
          <button className="linklike danger" onClick={undo}>
            That wasn't me — undo
          </button>
        )}
        <button className="ghost-btn" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="account-form">
      <p className="account-hint">Point this at the code shown on your other device.</p>
      {error && <p className="lock-error">{error}</p>}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} className="pairing-scanner" muted playsInline />
      <button className="ghost-btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function AccountSection({
  account,
  onCreateAccount,
  onDisconnect,
  onDeleteAccount,
  onSyncNow,
  onLinkNewDeviceFromScan,
  onCancelDeviceLink,
}: Pick<
  Props,
  "account" | "onCreateAccount" | "onDisconnect" | "onDeleteAccount" | "onSyncNow" | "onLinkNewDeviceFromScan" | "onCancelDeviceLink"
>) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function create() {
    setError(null);
    if (!email.trim() || password.length < 8) {
      setError("Enter an email and an account password of at least 8 characters.");
      return;
    }
    setBusy(true);
    const err = await onCreateAccount(email, password);
    setBusy(false);
    if (err) setError(err);
    else {
      setOpen(false);
      setEmail("");
      setPassword("");
    }
  }

  if (account) {
    return (
      <section>
        <h3>Sync</h3>
        <p className="account-status">
          Syncing as <b>{account}</b>. Your journal follows you to any device you sign in on.
        </p>
        <div className="edit-foot">
          <button className="ghost-btn" onClick={onSyncNow}>
            Sync now
          </button>
          <button className="ghost-btn" onClick={onDisconnect}>
            Disconnect this device
          </button>
        </div>

        {scanning ? (
          <LinkDeviceScanner
            onLinkNewDeviceFromScan={onLinkNewDeviceFromScan}
            onCancelDeviceLink={onCancelDeviceLink}
            onClose={() => setScanning(false)}
          />
        ) : (
          <button className="ghost-btn" onClick={() => setScanning(true)}>
            Link a new device
          </button>
        )}

        {/* Deleting the account is quiet and deliberate — below the everyday
            controls, behind a confirm. It removes only the copy on the server;
            the journal on this device is untouched. */}
        <div className="danger-zone">
          {deleteErr ? <p className="lock-error">{deleteErr}</p> : null}
          {confirmDelete ? (
            <>
              <p className="account-hint">
                This permanently removes your synced copy from the server. Everything on{" "}
                <b>this device</b> stays exactly as it is. It can't be undone.
              </p>
              <div className="edit-foot">
                <button className="ghost-btn" onClick={() => { setConfirmDelete(false); setDeleteErr(null); }}>
                  Keep it
                </button>
                <button
                  className="ghost-btn danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const err = await onDeleteAccount();
                    setBusy(false);
                    if (err) setDeleteErr(err);
                  }}
                >
                  {busy ? "Deleting…" : "Delete from server"}
                </button>
              </div>
            </>
          ) : (
            <button className="linklike danger" onClick={() => setConfirmDelete(true)}>
              Delete this account from the server
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3>Sync across devices</h3>
      <p className="account-blurb">
        Create an account to carry your journal to your other devices. The account is only a
        login — separate from your passphrase, which never leaves your device. We still can't
        read a word.
      </p>
      {!open ? (
        <button className="ghost-btn" onClick={() => setOpen(true)}>
          Create an account
        </button>
      ) : (
        <div className="account-form">
          <input
            className="anchor-input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="anchor-input"
            type="password"
            placeholder="Account password (not your passphrase)"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          {error && <p className="lock-error">{error}</p>}
          <div className="edit-foot">
            <button className="save-btn" disabled={busy} onClick={create}>
              {busy ? "Working…" : "Create account"}
            </button>
            <button className="ghost-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="account-hint">
        Already have an account? Sign in on a <i>new</i> device from its welcome screen.
      </p>
    </section>
  );
}

export function Settings({
  onClose,
  mood,
  onMood,
  nightDim,
  onNightDim,
  account,
  onCreateAccount,
  onDisconnect,
  onDeleteAccount,
  onSyncNow,
  onLinkNewDeviceFromScan,
  onCancelDeviceLink,
  onChangePassphrase,
  guardianCircle,
  onSetupGuardians,
  recoveryStatus,
  onCancelPendingRecovery,
  pendingGuardianRequests,
  onApproveGuardianRequest,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="help-scrim" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <span className="brand">
            Set the mood
          </span>
          <button className="help-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="help-body">
          <section>
            <h3>Mood</h3>
            <div className="mood-grid">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  className={"mood-swatch" + (mood === m.id ? " active" : "")}
                  onClick={() => onMood(m.id)}
                  aria-pressed={mood === m.id}
                >
                  <span className="mood-chip" style={{ background: m.bg }}>
                    <span className="mood-line" style={{ background: m.ink }} />
                    <span className="mood-dot" style={{ background: m.amber }} />
                  </span>
                  <span className="mood-name">{m.name}</span>
                  <span className="mood-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Night dimming</h3>
            <button
              className={"toggle-row" + (nightDim ? " on" : "")}
              onClick={() => onNightDim(!nightDim)}
              role="switch"
              aria-checked={nightDim}
            >
              <span className="toggle-text">
                Gently dim and warm the app late at night, so it's never harsh at 3am.
              </span>
              <span className="toggle-switch" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </button>
          </section>

          <AccountSection
            account={account}
            onCreateAccount={onCreateAccount}
            onDisconnect={onDisconnect}
            onDeleteAccount={onDeleteAccount}
            onSyncNow={onSyncNow}
            onLinkNewDeviceFromScan={onLinkNewDeviceFromScan}
            onCancelDeviceLink={onCancelDeviceLink}
          />

          <ChangePassphraseSection onChangePassphrase={onChangePassphrase} />

          <GuardiansSection
            guardianCircle={guardianCircle}
            onSetupGuardians={onSetupGuardians}
            recoveryStatus={recoveryStatus}
            onCancelPendingRecovery={onCancelPendingRecovery}
          />

          <GuardianApprovalsSection
            pendingGuardianRequests={pendingGuardianRequests}
            onApproveGuardianRequest={onApproveGuardianRequest}
          />
        </div>
      </div>
    </div>
  );
}
