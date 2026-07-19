// Sync.tsx
// Turning on cross-device sync — and the one thing that has to be said plainly:
// the account and the passphrase are two different secrets doing two different
// jobs.
//
//   • The account (an email + a password) answers "whose ciphertext is this?".
//     The server checks it and hands back opaque blobs.
//   • The passphrase decrypts those blobs, and it NEVER leaves the device — it
//     isn't sent here and it isn't stored on the server.
//
// So a breach of the sync server yields nothing but noise. Sync moves
// ciphertext; it does not move the key. This screen is where the user opts into
// it, so it says so.

import { useEffect, useState } from "react";
import type { RecoveryCircleInfo, RecoveryStatus, PendingForMe } from "../lib/api";

type Mode = "signin" | "create";

const DELAY_OPTIONS = [
  { label: "24 hours", ms: 24 * 3_600_000 },
  { label: "48 hours", ms: 48 * 3_600_000 },
  { label: "4 days", ms: 96 * 3_600_000 },
  { label: "1 week", ms: 7 * 24 * 3_600_000 },
];

// Guardians who can jointly help recover a forgotten passphrase — without us,
// or any one of them alone, ever holding the key. See SettingsSheet's "How
// Hearth works" for the short version.
function GuardiansSection({
  guardianCircle,
  onSetupGuardians,
  recoveryStatus,
  onCancelPendingRecovery,
}: {
  guardianCircle: RecoveryCircleInfo | null;
  onSetupGuardians: (guardians: { email: string; codeword: string }[], k: number, delayMs: number) => Promise<string | null>;
  recoveryStatus: RecoveryStatus;
  onCancelPendingRecovery: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ email: string; codeword: string }[]>([
    { email: "", codeword: "" }, { email: "", codeword: "" }, { email: "", codeword: "" },
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
    <div className="danger-zone">
      <h4 className="pass-head">Guardians</h4>
      {recoveryStatus ? (
        <>
          <div className="error">
            Someone started recovering this account {new Date(recoveryStatus.createdAt).toLocaleString()} —{" "}
            {recoveryStatus.approvals} of {recoveryStatus.k} guardians have approved. If this wasn't you, cancel it now.
          </div>
          <button
            className="btn btn-danger"
            disabled={cancelBusy}
            onClick={async () => { setCancelBusy(true); await onCancelPendingRecovery(); setCancelBusy(false); }}
          >
            {cancelBusy ? "Cancelling…" : "This wasn't me — cancel it"}
          </button>
        </>
      ) : null}
      {done ? (
        <p className="hint">Guardians are set. Ask each one to expect a request someday, never today.</p>
      ) : !open ? (
        <>
          {guardianCircle ? (
            <p className="hint">
              {guardianCircle.k} of {guardianCircle.n} guardians can recover this account:{" "}
              {guardianCircle.guardians.map((g) => g.email).join(", ")}.
            </p>
          ) : (
            <p>
              A handful of people you trust can jointly help you back in if you ever forget your
              passphrase — without us, or any one of them, ever holding the key.
            </p>
          )}
          <button className="linklike" onClick={() => setOpen(true)}>
            {guardianCircle ? "Change guardians" : "Set up guardians"}
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            Tell each guardian their codeword <strong>out loud</strong> — in person or by phone,
            never by message or email. It's the second lock; we never see it either.
          </p>
          {rows.map((row, i) => (
            <div className="sheet-actions" key={i}>
              <input
                type="email" placeholder="Guardian's email"
                value={row.email} onChange={(e) => updateRow(i, "email", e.target.value)}
              />
              <input
                type="text" placeholder="Codeword (told out loud)"
                value={row.codeword} onChange={(e) => updateRow(i, "codeword", e.target.value)}
              />
            </div>
          ))}
          <button className="linklike" onClick={() => setRows((r) => [...r, { email: "", codeword: "" }])}>
            + Add another guardian
          </button>
          <label className="field">
            <span className="label">How many must approve</span>
            <select value={k} onChange={(e) => setK(Number(e.target.value))}>
              {rows.map((_, i) => (
                <option key={i} value={i + 1} disabled={i + 1 < 2}>{i + 1}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Waiting period before it completes</span>
            <select value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))}>
              {DELAY_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
            </select>
          </label>
          {error ? <div className="error">{error}</div> : null}
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Save guardians"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// "Help a friend" — approving someone else's recovery request. Only shows up
// when there's something to do.
function GuardianApprovalsSection({
  pendingGuardianRequests,
  onApproveGuardianRequest,
}: {
  pendingGuardianRequests: PendingForMe[];
  onApproveGuardianRequest: (requestId: string, codeword: string) => Promise<string | null>;
}) {
  const [codewords, setCodewords] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Tracked separately from pendingGuardianRequests: approving a request makes
  // the server stop returning it (GET /recovery/pending-for-me only lists
  // requests this guardian HASN'T approved yet), so the list refreshes this
  // row away the instant approval succeeds. Without its own memory of what it
  // just did, the "Approved for X" confirmation would never be visible.
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
    <div className="danger-zone">
      <h4 className="pass-head">Help a friend</h4>
      {done.map((d) => (
        <p key={d.requestId} className="hint">Approved for {d.ownerEmail}.</p>
      ))}
      {pendingGuardianRequests.map((r) => (
          <div key={r.requestId}>
            <p className="hint">
              {r.ownerEmail} is trying to recover their account ({r.k} of {r.n} guardians needed).
              Ask them for their codeword, out loud, before approving.
            </p>
            <input
              type="text" placeholder="Their codeword"
              value={codewords[r.requestId] ?? ""}
              onChange={(e) => setCodewords((c) => ({ ...c, [r.requestId]: e.target.value }))}
            />
            {errors[r.requestId] ? <div className="error">{errors[r.requestId]}</div> : null}
            <div className="sheet-actions">
              <button
                className="btn btn-ghost"
                disabled={busyId === r.requestId}
                onClick={() => approve(r.requestId, r.ownerEmail)}
              >
                {busyId === r.requestId ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
      ))}
    </div>
  );
}

// Change the vault passphrase (only shown when there's a vault on this device).
// Envelope encryption means this re-encrypts nothing and doesn't disturb sync —
// it just re-wraps the data key under the new passphrase.
function ChangePassphrase({ onChange }: { onChange: (current: string, next: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < 8) return setError("Use at least 8 characters — a few plain words you'll remember.");
    if (next !== confirm) return setError("The new passphrases don't match.");
    setBusy(true);
    const err = await onChange(current, next);
    setBusy(false);
    if (err) return setError(err);
    setCurrent(""); setNext(""); setConfirm(""); setOpen(false);
    setDone(true); setTimeout(() => setDone(false), 4000);
  }

  return (
    <div className="danger-zone">
      <h4 className="pass-head">Passphrase</h4>
      {done ? (
        <p className="hint">Passphrase changed. Nothing left this device.</p>
      ) : !open ? (
        <button className="linklike" onClick={() => setOpen(true)}>Change your passphrase</button>
      ) : (
        <>
          {error ? <div className="error">{error}</div> : null}
          <label className="field"><span className="label">Current passphrase</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
          <label className="field"><span className="label">New passphrase</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label className="field"><span className="label">New passphrase again</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !current || !next} onClick={submit}>
              {busy ? "Changing…" : "Change it"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Sync({
  account,
  syncing,
  syncError,
  canCreate,
  onCreate,
  onSignIn,
  onDisconnect,
  onDelete,
  onSyncNow,
  onChangePassphrase,
  onClose,
  guardianCircle,
  onSetupGuardians,
  recoveryStatus,
  onCancelPendingRecovery,
  pendingGuardianRequests,
  onApproveGuardianRequest,
}: {
  account: string | null;
  syncing: boolean;
  syncError: string | null;
  // A vault exists on this device (so it can be connected to a new account).
  canCreate: boolean;
  onCreate: (email: string, password: string) => Promise<boolean>;
  onSignIn: (email: string, password: string) => Promise<boolean>;
  onDisconnect: () => Promise<void>;
  onDelete: () => Promise<boolean>;
  onSyncNow: () => Promise<void>;
  onChangePassphrase: (current: string, next: string) => Promise<string | null>;
  onClose: () => void;
  guardianCircle: RecoveryCircleInfo | null;
  onSetupGuardians: (guardians: { email: string; codeword: string }[], k: number, delayMs: number) => Promise<string | null>;
  recoveryStatus: RecoveryStatus;
  onCancelPendingRecovery: () => Promise<string | null>;
  pendingGuardianRequests: PendingForMe[];
  onApproveGuardianRequest: (requestId: string, codeword: string) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<Mode>(canCreate ? "create" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = mode === "create" ? await onCreate(email, password) : await onSignIn(email, password);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Sync across devices</h3>

        {account ? (
          <>
            <p>
              Connected as <strong>{account}</strong>. Your log syncs quietly in the
              background — nothing is lost if you're offline, it catches up next time.
            </p>
            <p className="hint">
              Only encrypted blobs leave this device. Your passphrase, and the key made from it,
              never do — so the server stores noise it can't read.
            </p>

            {syncError ? <div className="error">{syncError}</div> : null}

            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => void onDisconnect()}>
                Disconnect
              </button>
              <button className="btn btn-primary" onClick={() => void onSyncNow()} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>

            {/* Deleting the account removes the server copy only — the log on this
                device is untouched. Two taps, so it can't happen by accident. */}
            <div className="danger-zone">
              {confirmDelete ? (
                <>
                  <p className="hint">
                    This permanently removes your synced copy from the server. Everything on
                    <strong> this device</strong> stays exactly as it is. It can't be undone.
                  </p>
                  <div className="sheet-actions">
                    <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={syncing}
                      onClick={async () => { if (await onDelete()) onClose(); }}
                    >
                      {syncing ? "Deleting…" : "Delete from server"}
                    </button>
                  </div>
                </>
              ) : (
                <button className="linklike danger" onClick={() => setConfirmDelete(true)}>
                  Delete this account from the server
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p>
              Keep the same log on your phone and your laptop. This is separate from your
              passphrase: you make an <strong>account</strong> so the server knows which
              encrypted blobs are yours — but it only ever sees ciphertext.
            </p>

            {canCreate ? (
              <div className="seg">
                <button type="button" className="seg-btn" aria-pressed={mode === "create"} onClick={() => setMode("create")}>
                  New account
                </button>
                <button type="button" className="seg-btn" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>
                  Sign in
                </button>
              </div>
            ) : null}

            <form onSubmit={submit}>
              {syncError ? <div className="error">{syncError}</div> : null}

              <label className="field">
                <span className="label">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>

              <label className="field">
                <span className="label">Account password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "create" ? "new-password" : "current-password"}
                />
                <span className="hint">
                  Not your passphrase — a separate secret, just for signing in. Your passphrase
                  never leaves this device.
                </span>
              </label>

              {mode === "signin" && !canCreate ? (
                <p className="hint">
                  Signing in downloads your log to this device. You'll open it with the same
                  passphrase you set on the first one.
                </p>
              ) : null}

              <div className="sheet-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy || !email || !password}>
                  {busy ? "Working…" : mode === "create" ? "Create account & sync" : "Sign in"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* Change-passphrase lives here (the vault's account/security surface).
            Only shown when there's a vault on this device. */}
        {canCreate ? <ChangePassphrase onChange={onChangePassphrase} /> : null}

        {/* Guardians need the vault key (to split it), so same gate as above. */}
        {canCreate && account ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  );
}
