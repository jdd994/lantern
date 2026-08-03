// Welcome.tsx
// First run. Two things get said before a single name is written: the no-reset
// trade (same honesty as the siblings), and the promise about what this is —
// a family remembering together, never a record count.

import { useState } from "react";

export function Welcome({
  onSetup,
  busy,
  onSignIn,
  onInstallHelp,
}: {
  onSetup: (p: string) => Promise<void>;
  busy: boolean;
  onSignIn?: () => void;
  onInstallHelp?: () => void;
}) {
  const [step, setStep] = useState<"intro" | "pass">("intro");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 10) return setError("Use at least 10 characters — a few plain words you'll remember.");
    if (pass !== confirm) return setError("Those don't match.");
    await onSetup(pass);
  }

  if (step === "intro") {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1 className="gate-brand">Grove<span>.</span></h1>
          <h2>A family tree the family writes together.</h2>
          <p>
            The people you come from, the bonds between them, and what everyone remembers about
            them. Everything is encrypted on this device before it's stored — your family's story
            is nobody's business but your family's.
          </p>

          <div className="trade">
            <strong>A promise about what this is:</strong> Grove is not a records race. No hint
            leaves, no completeness meters, no "12,000 people in your tree!". Dates are scaffolding;
            what the family <em>remembers</em> about a person is the point. Start with one name and
            let it grow at the pace of remembering.
          </div>

          <p style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>
            If you ever forget your passphrase, the people you trust can let you back in: set up{" "}
            <strong style={{ color: "var(--ink-soft)" }}>guardians</strong> (in Sync) and a few of
            them together can restore your access — nobody else, including us. Until then it's the
            only key: there's no reset by email, because a reset button would mean someone besides
            you could read the tree. Keep it somewhere safe.
          </p>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setStep("pass")}>
            Set a passphrase
          </button>

          {onSignIn ? (
            <p className="gate-alt">
              Already keeping a tree on another device?{" "}
              <button type="button" className="linklike" onClick={onSignIn}>
                Sign in to sync
              </button>
            </p>
          ) : null}
          {onInstallHelp ? (
            <p className="gate-alt">
              Want Grove on your home screen?{" "}
              <button type="button" className="linklike" onClick={onInstallHelp}>
                How to install
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-brand">Grove<span>.</span></h1>
        <h2>Choose a passphrase</h2>
        <p>This is the only key to your family's vault. A few plain words you won't forget beats a short clever one.</p>
        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}
          <label className="field">
            <span className="label">Passphrase</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="new-password" placeholder="at least 10 characters" />
          </label>
          <label className="field">
            <span className="label">Again, to be sure</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("intro")}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Making your vault…" : "Create vault"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
