// LockScreen.tsx
// The vault is closed. Nothing about what you eat is in memory until the
// passphrase (or a biometric shortcut to the same key) opens it.

import { useEffect, useState } from "react";
import { RecoveryFlow } from "./RecoveryFlow";
import type { RecoveryCircleInfo, RecoveryRequestPoll } from "../lib/api";

export function LockScreen({
  onUnlock, onBiometric, hasBiometric, error, busy,
  account, syncError, guardianCircle,
  onRecoverySignIn, onLoadGuardianCircle, onStartRecovery, onPollRecovery, onCancelRecovery, onFinishRecovery,
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
}) {
  const [pass, setPass] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    if (hasBiometric) void onBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await onUnlock(pass))) setPass("");
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
        <h1 className="gate-brand">Hearth<span>.</span></h1>
        <h2>Welcome back.</h2>
        <p>Your passphrase unlocks the vault on this device.</p>
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
        </form>
      </div>
    </div>
  );
}
