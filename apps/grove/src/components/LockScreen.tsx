// LockScreen.tsx
// The vault is closed. Not a name, not a date, not a word of a letter is in
// memory until the passphrase opens it. (Biometric unlock and guardian
// recovery arrive with sync — the props surface stays small until then.)

import { useState } from "react";

export function LockScreen({
  onUnlock,
  error,
  busy,
}: {
  onUnlock: (p: string) => Promise<boolean>;
  error: string | null;
  busy: boolean;
}) {
  const [pass, setPass] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await onUnlock(pass))) setPass("");
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-brand">Grove<span>.</span></h1>
        <h2>Welcome back.</h2>
        <p>Your passphrase unlocks the tree on this device.</p>
        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}
          <label className="field">
            <span className="label">Passphrase</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !pass}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
