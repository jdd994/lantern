// Welcome.tsx
// First run. Two things get said before a single item is written: the no-reset
// trade (same honesty as the siblings), and the promise about what this is —
// a memory aid that waits at the door, never a taskmaster.

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
          <h1 className="gate-brand">Manifest<span>.</span></h1>
          <h2>Everything you need, before you go.</h2>
          <p>
            A ship's manifest is the list of what the vessel carries, checked before departure.
            This is yours: packing for a trip, planning one together — the list holds it so your
            head doesn't have to. Everything is encrypted on this device before it's stored.
          </p>

          <div className="trade">
            <strong>A promise about what this is:</strong> Manifest is a checklist, not a
            taskmaster. No due dates, no reminders, no streaks, no red badges. The list waits
            quietly until you reach for it — and next year, last summer's list remembers what you
            actually needed.
          </div>

          <p style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>
            If you ever forget your passphrase, the people you trust can let you back in: set up{" "}
            <strong style={{ color: "var(--ink-soft)" }}>guardians</strong> (in Sync) and a few of
            them together can restore your access — or print a{" "}
            <strong style={{ color: "var(--ink-soft)" }}>recovery kit</strong>: a one-page code
            for a fire safe. Nobody else can ever get in, including us — there's no reset by
            email, because a reset button would mean someone besides you could read your lists.
            Keep the passphrase somewhere safe too.
          </p>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setStep("pass")}>
            Set a passphrase
          </button>

          {onSignIn ? (
            <p className="gate-alt">
              Already keeping lists on another device?{" "}
              <button type="button" className="linklike" onClick={onSignIn}>
                Sign in to sync
              </button>
            </p>
          ) : null}
          {onInstallHelp ? (
            <p className="gate-alt">
              Want Manifest on your home screen?{" "}
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
        <h1 className="gate-brand">Manifest<span>.</span></h1>
        <h2>Choose a passphrase</h2>
        <p>This is the only key to your vault. A few plain words you won't forget beats a short clever one.</p>
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
