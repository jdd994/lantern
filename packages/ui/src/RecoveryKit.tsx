// RecoveryKit.tsx — the paper answer for a vault with no circle. Three pieces:
// a small section for the Sync sheet (make / replace / remove), the printable
// page itself, and the lock-screen door that accepts the code. The page is
// shown exactly once per minting — the code exists on paper and inside the
// wrapped blob, nowhere else, and the copy says out loud what the paper is:
// the deed to the house.
//
// Family-shared: five apps carried this file byte-for-byte, so it lives here
// once now (Driftless keeps its own variant — different markup system).
// Printing uses window.print() with a CSS veil (each app's styles.css): on
// paper, only the kit page renders. Nothing leaves the device.

import { useState } from "react";

export function RecoveryKitSheet({
  appName,
  code,
  createdAt,
  onDone,
}: {
  appName: string;
  code: string;
  createdAt: number;
  onDone: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-label="Your recovery kit">
      <div className="sheet kit-sheet">
        <h3>{appName} recovery kit</h3>
        <p className="kit-lede">
          Printed {new Date(createdAt).toLocaleDateString()} — this page is the way back into your
          vault if you ever forget your passphrase.
        </p>
        <div className="kit-code" aria-label="Recovery code">{code}</div>
        <ol className="kit-steps">
          <li>Print this page, or copy the code onto paper by hand.</li>
          <li>Keep it where you keep the deed to the house — a safe, a lockbox, a bank box. <strong>Anyone holding this code can open your vault.</strong></li>
          <li>If the day comes: open {appName}, choose <strong>"Use a recovery code"</strong> on the lock screen, and type it in. Dashes and small typos are forgiven.</li>
        </ol>
        <p className="kit-fine">
          The code was made on this device and is not stored anywhere readable — not by us, not on
          any server. Making a new kit later retires this page for good.
        </p>
        <div className="sheet-actions kit-noprint">
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" onClick={onDone}>I've put it away</button>
        </div>
      </div>
    </div>
  );
}

export function RecoveryKitSection({
  appName,
  recoveryKitAt,
  onCreate,
  onRemove,
}: {
  appName: string;
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
    <section className="set-section">
      <h4 className="set-head">Recovery kit</h4>
      <p className="hint">
        A printed page for a fire safe: a one-time code that can open your vault if you forget the
        passphrase — no other people needed. The code lives on the paper, not on any server.
      </p>
      {error ? <div className="error">{error}</div> : null}
      {recoveryKitAt ? (
        <>
          <p className="hint">
            A kit exists, made {new Date(recoveryKitAt).toLocaleDateString()}. Making a new one
            retires the old page for good.
          </p>
          <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" disabled={busy} onClick={() => void create()}>
              {busy ? "Making…" : "Make a new kit"}
            </button>
            {confirmRemove ? (
              <>
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep it</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>Yes, retire it</button>
              </>
            ) : (
              <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove</button>
            )}
          </div>
          {confirmRemove ? (
            <p className="hint">Removing retires the printed page — it won't open anything afterwards.</p>
          ) : null}
        </>
      ) : (
        <button className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "Making…" : "Make a recovery kit"}
        </button>
      )}
      {fresh ? (
        <RecoveryKitSheet appName={appName} code={fresh.code} createdAt={fresh.createdAt} onDone={() => setFresh(null)} />
      ) : null}
    </section>
  );
}

// The locked-out door: code + a fresh passphrase. Small enough to live inline
// on the lock screen.
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 8) return setError("Use at least 8 characters for the new passphrase.");
    if (pass !== confirm) return setError("Those don't match.");
    setBusy(true);
    const err = await onRecover(code, pass);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={submit}>
      <p className="hint">
        Type the code from your printed recovery kit. It opens the vault and lets you choose a new
        passphrase — the old one stops mattering.
      </p>
      {error ? <div className="error">{error}</div> : null}
      <label className="field">
        <span className="label">Recovery code</span>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="label">New passphrase</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="field">
        <span className="label">Again, to be sure</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          {busy ? "Opening…" : "Open the vault"}
        </button>
      </div>
    </form>
  );
}
