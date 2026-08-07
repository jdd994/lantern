// RecoveryFlow.tsx — "I forgot my passphrase, help me get back in."
// Lives inside LockScreen (vault exists on this device, but the passphrase
// that opens it doesn't). Needs an authenticated account (sign in first if
// this device was never connected), then: preview the circle, start a
// request, wait for guardians, finish once the delay window clears.
//
// This only works on the device it was started from — the throwaway session
// key that guardians' shares get wrapped to never leaves this device. See
// @lantern/core/recovery and HelpSheet's "Recovering your passphrase".
import { useEffect, useRef, useState } from "react";
import type { RecoveryCircleInfo, RecoveryRequestPoll } from "../lib/api";

type StartResult = { requestId: string; k: number; n: number; delayMs: number; guardianEmails: string[] } | string;

type Props = {
  account: string | null;
  guardianCircle: RecoveryCircleInfo | null;
  onRecoverySignIn: (email: string, password: string) => Promise<string | null>;
  onLoadGuardianCircle: () => Promise<void>;
  onStartRecovery: () => Promise<StartResult>;
  onPollRecovery: (requestId: string) => Promise<RecoveryRequestPoll | null>;
  onCancelRecovery: (requestId: string) => Promise<string | null>;
  onFinishRecovery: (requestId: string, newPassphrase: string) => Promise<string | null>;
  onBack: () => void;
};

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "any moment now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (h > 0) return `about ${h}h ${m}m`;
  return `about ${m}m`;
}

export function RecoveryFlow({
  account,
  guardianCircle,
  onRecoverySignIn,
  onLoadGuardianCircle,
  onStartRecovery,
  onPollRecovery,
  onCancelRecovery,
  onFinishRecovery,
  onBack,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [request, setRequest] = useState<{ requestId: string; k: number; n: number; guardianEmails: string[] } | null>(null);
  const [poll, setPoll] = useState<RecoveryRequestPoll | null>(null);
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    if (account) void onLoadGuardianCircle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  useEffect(() => {
    if (!request) return;
    const tick = async () => setPoll(await onPollRecovery(request.requestId));
    void tick();
    pollTimer.current = window.setInterval(tick, 15_000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.requestId]);

  async function signIn() {
    setError(null);
    if (!email.trim() || !password) return setError("Enter your account email and password.");
    setBusy(true);
    const err = await onRecoverySignIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else void onLoadGuardianCircle();
  }

  async function start() {
    setError(null);
    setBusy(true);
    const result = await onStartRecovery();
    setBusy(false);
    if (typeof result === "string") return setError(result);
    setRequest(result);
  }

  async function cancel() {
    if (!request) return;
    setBusy(true);
    await onCancelRecovery(request.requestId);
    setBusy(false);
    setRequest(null);
    setPoll(null);
  }

  async function finish() {
    if (!request) return;
    setError(null);
    if (newPass.length < 8) return setError("Use at least 8 characters — a few plain words you'll remember.");
    if (newPass !== confirm) return setError("The two passphrases don't match.");
    setBusy(true);
    const err = await onFinishRecovery(request.requestId, newPass);
    setBusy(false);
    if (err) setError(err);
    // On success the app unlocks and this screen goes away on its own.
  }

  const ready = !!(poll?.recoveryWrappedDEK && poll?.approvalShares);
  const approvals = poll?.approvals ?? 0;
  const k = request?.k ?? poll?.k ?? 0;

  return (
    <div className="lock">
      <div className="lock-card">
        <div className="brand">
          Driftless<span className="dot">.</span>
        </div>
        <p className="lock-lead">Ask your guardians</p>

        {!account ? (
          <>
            <p className="lock-sub">
              Sign in with your account (not your passphrase) so your guardians can find your
              request.
            </p>
            <input
              className="lock-input"
              type="email"
              autoFocus
              placeholder="Account email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="lock-input"
              type="password"
              placeholder="Account password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
            {error && <p className="lock-error">{error}</p>}
            <button className="save-btn lock-btn" disabled={busy} onClick={signIn}>
              {busy ? "Working…" : "Sign in"}
            </button>
          </>
        ) : !guardianCircle ? (
          <>
            <p className="lock-sub">
              No guardians are set up on this account. Once you're back in, set some up from
              Settings so this is possible next time.
            </p>
          </>
        ) : !request ? (
          <>
            <p className="lock-sub">
              {guardianCircle.k} of your {guardianCircle.n} guardians need to approve before you can
              set a new passphrase:{" "}
              {guardianCircle.guardians.map((g) => g.email).join(", ")}.
            </p>
            {error && <p className="lock-error">{error}</p>}
            <button className="save-btn lock-btn" disabled={busy} onClick={start}>
              {busy ? "Starting…" : "Start recovery"}
            </button>
          </>
        ) : !ready ? (
          <>
            <p className="lock-sub">
              {poll?.status === "pending_delay" && poll.readyAt
                ? `Enough guardians have approved. Waiting out the safety window — ready in ${fmtCountdown(poll.readyAt - Date.now())}.`
                : `Waiting for guardians to approve — ${approvals} of ${k} so far. Ask them to open the app.`}
            </p>
            <button className="lock-restore" disabled={busy} onClick={cancel}>
              Cancel this request
            </button>
          </>
        ) : (
          <>
            <p className="lock-sub">Your guardians have vouched for you. Choose a new passphrase.</p>
            <input
              className="lock-input"
              type="password"
              autoFocus
              placeholder="New passphrase"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
            />
            <input
              className="lock-input"
              type="password"
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && finish()}
            />
            {error && <p className="lock-error">{error}</p>}
            <button className="save-btn lock-btn" disabled={busy} onClick={finish}>
              {busy ? "Finishing…" : "Set new passphrase"}
            </button>
          </>
        )}

        {!request && (
          <button className="lock-restore" onClick={onBack}>
            ‹ Back
          </button>
        )}
      </div>
    </div>
  );
}
