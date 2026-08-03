// Welcome.tsx
// First run. Two things get said before a single plan is written: the no-reset
// trade (same honesty as the siblings), and the promise about what this is —
// a book you consult, never a machine that nags.

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
          <h1 className="gate-brand">Almanac<span>.</span></h1>
          <h2>The book of what's coming.</h2>
          <p>
            An almanac is the old book of tides, moons, and fair days — consulted when you need it,
            silent when you don't. This one holds your circle's plans: the shows, the gatherings,
            the things worth leaving the house for, kept with the people going. Everything is
            encrypted on this device before it's stored.
          </p>

          <div className="trade">
            <strong>A promise about what this is:</strong> Almanac is a book, not an assistant. No
            reminders, no notifications, no maybes hanging over anyone's head. A plan goes in the
            book; whoever's coming says "I'm in"; the book waits until you open it. And your
            friends who live in other calendars aren't left out — any plan hands itself over as a
            file their calendar understands.
          </div>

          <p style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>
            If you ever forget your passphrase, the people you trust can let you back in: set up{" "}
            <strong style={{ color: "var(--ink-soft)" }}>guardians</strong> (in Sync) and a few of
            them together can restore your access — nobody else, including us. Until then it's the
            only key: there's no reset by email, because a reset button would mean someone besides
            you could read your plans. Keep it somewhere safe.
          </p>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setStep("pass")}>
            Set a passphrase
          </button>

          {onSignIn ? (
            <p className="gate-alt">
              Already keeping an almanac on another device?{" "}
              <button type="button" className="linklike" onClick={onSignIn}>
                Sign in to sync
              </button>
            </p>
          ) : null}
          {onInstallHelp ? (
            <p className="gate-alt">
              Want Almanac on your home screen?{" "}
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
        <h1 className="gate-brand">Almanac<span>.</span></h1>
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
