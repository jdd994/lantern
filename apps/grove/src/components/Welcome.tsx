// Welcome.tsx
// First run. Two things get said before a single name is written: the no-reset
// trade (same honesty as the siblings), and the promise about what this is —
// a family remembering together, never a record count.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";

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
  const { t } = useLingui();
  const [step, setStep] = useState<"intro" | "pass">("intro");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 10) return setError(t`Use at least 10 characters — a few plain words you'll remember.`);
    if (pass !== confirm) return setError(t`Those don't match.`);
    await onSetup(pass);
  }

  if (step === "intro") {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1 className="gate-brand">Grove<span>.</span></h1>
          <h2><Trans>A family tree the family writes together.</Trans></h2>
          <p>
            <Trans>
              The people you come from, the bonds between them, and what everyone remembers about
              them. Everything is encrypted on this device before it's stored — your family's story
              is nobody's business but your family's.
            </Trans>
          </p>

          <div className="trade">
            <Trans>
              <strong>A promise about what this is:</strong> Grove is not a records race. No hint
              leaves, no completeness meters, no "12,000 people in your tree!". Dates are scaffolding;
              what the family <em>remembers</em> about a person is the point. Start with one name and
              let it grow at the pace of remembering.
            </Trans>
          </div>

          <p style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>
            <Trans>
              If you ever forget your passphrase, the people you trust can let you back in: set up{" "}
              <strong style={{ color: "var(--ink-soft)" }}>guardians</strong> (in Sync) and a few of
              them together can restore your access — or print a{" "}
              <strong style={{ color: "var(--ink-soft)" }}>recovery kit</strong>: a one-page code
              for a fire safe. Nobody else can ever get in, including us — there's no reset by
              email, because a reset button would mean someone besides you could read the tree.
              Keep the passphrase somewhere safe too.
            </Trans>
          </p>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setStep("pass")}>
            <Trans>Set a passphrase</Trans>
          </button>

          {onSignIn ? (
            <p className="gate-alt">
              <Trans>
                Already keeping a tree on another device?{" "}
                <button type="button" className="linklike" onClick={onSignIn}>
                  Sign in to sync
                </button>
              </Trans>
            </p>
          ) : null}
          {onInstallHelp ? (
            <p className="gate-alt">
              <Trans>
                Want Grove on your home screen?{" "}
                <button type="button" className="linklike" onClick={onInstallHelp}>
                  How to install
                </button>
              </Trans>
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
        <h2><Trans>Choose a passphrase</Trans></h2>
        <p><Trans>This is the only key to your family's vault. A few plain words you won't forget beats a short clever one.</Trans></p>
        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}
          <label className="field">
            <span className="label"><Trans>Passphrase</Trans></span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="new-password" placeholder={t`at least 10 characters`} />
          </label>
          <label className="field">
            <span className="label"><Trans>Again, to be sure</Trans></span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep("intro")}><Trans>Back</Trans></button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t`Making your vault…` : t`Create vault`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
