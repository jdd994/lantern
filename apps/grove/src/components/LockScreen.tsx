// LockScreen.tsx
// The vault is closed. Not a name, not a date, not a word of a letter is in
// memory until the passphrase (or a biometric shortcut to the same key) opens
// it. "Forgot it" hands off to the guardian recovery flow.

import { useEffect, useState } from "react";
import { RecoveryFlow } from "./RecoveryFlow";
import { RecoverWithCode } from "./RecoveryKit";
import type { RecoveryCircleInfo, RecoveryRequestPoll } from "../lib/api";

export function LockScreen({
  onUnlock,
  onBiometric,
  hasBiometric,
  error,
  busy,
  account,
  syncError,
  guardianCircle,
  onRecoverySignIn,
  onLoadGuardianCircle,
  onStartRecovery,
  onPollRecovery,
  onCancelRecovery,
  onFinishRecovery,
  onRecoverWithKit,
}: {
  onUnlock: (p: string) => Promise<boolean>;
  onBiometric: () => Promise<boolean>;
  hasBiometric: boolean;
  error: string | null;
  busy: boolean;
  // Social recovery — "I forgot my passphrase." See RecoveryFlow.tsx.
  account: string | null;
  syncError: string | null;
  guardianCircle: RecoveryCircleInfo | null;
  onRecoverySignIn: (email: string, password: string) => Promise<boolean>;
  onLoadGuardianCircle: () => Promise<void>;
  onStartRecovery: () => Promise<{ requestId: string; k: number; n: number; delayMs: number; guardianEmails: string[] } | string>;
  onPollRecovery: (requestId: string) => Promise<RecoveryRequestPoll | null>;
  onCancelRecovery: (requestId: string) => Promise<string | null>;
  onFinishRecovery: (requestId: string, newPassphrase: string) => Promise<string | null>;
  onRecoverWithKit: (code: string, newPassphrase: string) => Promise<string | null>;
}) {
  const [pass, setPass] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [showKit, setShowKit] = useState(false);

  // An enrolled device offers the quick way first; declining costs one tap.
  useEffect(() => {
    if (hasBiometric) void onBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await onUnlock(pass))) setPass("");
  }

  if (showKit) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1 className="gate-brand">Grove<span>.</span></h1>
          <h2>The paper way back in.</h2>
          <RecoverWithCode onRecover={onRecoverWithKit} onBack={() => setShowKit(false)} />
        </div>
      </div>
    );
  }

  if (showRecovery) {
    return (
      <RecoveryFlow
        account={account}
        syncError={syncError}
        guardianCircle={guardianCircle}
        onRecoverySignIn={onRecoverySignIn}
        onLoadGuardianCircle={onLoadGuardianCircle}
        onStartRecovery={onStartRecovery}
        onPollRecovery={onPollRecovery}
        onCancelRecovery={onCancelRecovery}
        onFinishRecovery={onFinishRecovery}
        onBack={() => setShowRecovery(false)}
      />
    );
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
          {hasBiometric ? (
            <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 9 }} onClick={() => void onBiometric()}>
              Use biometrics instead
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: 9 }}
            onClick={() => setShowRecovery(true)}
          >
            Forgot your passphrase? Ask your guardians
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: 9 }}
            onClick={() => setShowKit(true)}
          >
            Use a recovery code
          </button>
        </form>
      </div>
    </div>
  );
}
