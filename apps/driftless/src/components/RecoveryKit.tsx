// RecoveryKit.tsx — the paper answer: a printed code in a fire safe, for the
// journal whose keeper would rather not lean on guardians (or has none to
// ask). Same crypto as the siblings (@lantern/core/kit); Driftless's own
// clothes. The code is shown exactly once per minting; on paper, everything
// but the kit page vanishes (print veil in styles.css). Nothing leaves the
// device.

import { useState } from "react";

export function RecoveryKitSheet({
  code,
  createdAt,
  onDone,
}: {
  code: string;
  createdAt: number;
  onDone: () => void;
}) {
  return (
    <div className="kit-overlay" role="dialog" aria-label="Your recovery kit">
      <div className="kit-page">
        <h3>Driftless recovery kit</h3>
        <p className="account-blurb">
          Printed {new Date(createdAt).toLocaleDateString()} — this page is the way back into your
          journal if you ever forget your passphrase.
        </p>
        <div className="kit-code" aria-label="Recovery code">{code}</div>
        <ol className="kit-steps">
          <li>Print this page, or copy the code onto paper by hand.</li>
          <li>Keep it where you keep the deed to the house — a safe, a lockbox, a bank box. <strong>Anyone holding this code can open your journal.</strong></li>
          <li>If the day comes: open Driftless, choose <strong>"Use a recovery code"</strong> on the lock screen, and type it in. Dashes and small typos are forgiven.</li>
        </ol>
        <p className="account-hint">
          The code was made on this device and is not stored anywhere readable — not by us, not on
          any server. Making a new kit later retires this page for good.
        </p>
        <div className="kit-noprint" style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="ghost-btn" onClick={() => window.print()}>Print</button>
          <button className="save-btn" onClick={onDone}>I've put it away</button>
        </div>
      </div>
    </div>
  );
}

export function RecoveryKitSection({
  recoveryKitAt,
  onCreate,
  onRemove,
}: {
  recoveryKitAt: number | null;
  onCreate: () => Promise<{ code: string } | string>;
  onRemove: () => Promise<string | null>;
}) {
  const [fresh, setFresh] = useState<{ code: string; createdAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await onCreate();
    setBusy(false);
    if (typeof res === "string") setError(res);
    else setFresh({ code: res.code, createdAt: Date.now() });
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const err = await onRemove();
    setBusy(false);
    setConfirmRemove(false);
    if (err) setError(err);
  }

  return (
    <section>
      <h3>Recovery kit</h3>
      <p className="account-blurb">
        A printed page for a fire safe: a one-time code that can open your journal if you forget
        the passphrase — no other people needed. The code lives on the paper, not on any server.
      </p>
      {error && <p className="lock-error">{error}</p>}
      {recoveryKitAt ? (
        <>
          <p className="account-status">
            A kit exists, made {new Date(recoveryKitAt).toLocaleDateString()}. Making a new one
            retires the old page for good.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="ghost-btn" disabled={busy} onClick={() => void create()}>
              {busy ? "Making…" : "Make a new kit"}
            </button>
            {confirmRemove ? (
              <>
                <button className="ghost-btn" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep it</button>
                <button className="ghost-btn danger" disabled={busy} onClick={() => void remove()}>Yes, retire it</button>
              </>
            ) : (
              <button className="ghost-btn danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
            )}
          </div>
          {confirmRemove && (
            <p className="account-hint">Removing retires the printed page — it won't open anything afterwards.</p>
          )}
        </>
      ) : (
        <button className="ghost-btn" disabled={busy} onClick={() => void create()}>
          {busy ? "Making…" : "Make a recovery kit"}
        </button>
      )}
      {fresh && <RecoveryKitSheet code={fresh.code} createdAt={fresh.createdAt} onDone={() => setFresh(null)} />}
    </section>
  );
}

// The locked-out door, in the lock screen's own clothes.
export function RecoverWithCode({
  onRecover,
  onBack,
}: {
  onRecover: (code: string, newPassphrase: string) => Promise<string | null>;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (pass.length < 8) return setError("Use at least 8 characters for the new passphrase.");
    if (pass !== confirm) return setError("Those don't match.");
    setBusy(true);
    const err = await onRecover(code, pass);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <>
      <p className="lock-lead">
        Type the code from your printed recovery kit. It opens the journal and lets you choose a
        new passphrase — the old one stops mattering.
      </p>
      <input
        className="lock-input"
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      <input
        className="lock-input"
        type="password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        placeholder="New passphrase"
        autoComplete="new-password"
      />
      <input
        className="lock-input"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Again, to be sure"
        autoComplete="new-password"
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      {error && <p className="lock-error">{error}</p>}
      <button className="save-btn lock-btn" disabled={busy || !code.trim()} onClick={() => void submit()}>
        {busy ? "Opening…" : "Open the journal"}
      </button>
      <button className="lock-restore" onClick={onBack}>Back</button>
    </>
  );
}
