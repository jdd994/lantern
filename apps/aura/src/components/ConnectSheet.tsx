// ConnectSheet.tsx — connect a lighting brand. A lightweight precursor to the
// shared "connect a source" consent flow: it names the brand, takes the key, and
// says plainly where that key goes (straight to the brand, never Aura's servers).
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import { connectors } from "../lib/connectors";

export function ConnectSheet({
  onConnect,
  onClose,
}: {
  onConnect: (sourceId: string, cred: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState(connectors[0]?.id ?? "");
  const [cred, setCred] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = connectors.find((c) => c.id === sourceId);
  const needsCred = conn?.needsCred !== false;
  const canSubmit = !!conn && (!needsCred || cred.trim().length > 0);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const err = await onConnect(sourceId, needsCred ? cred : "demo");
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Connect your lights">
      <h3>Connect your lights</h3>

      {connectors.length > 1 ? (
        <div className="seg">
          {connectors.map((c) => (
            <button
              key={c.id}
              type="button"
              className="seg-btn"
              aria-pressed={sourceId === c.id}
              onClick={() => setSourceId(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {conn ? (
        <>
          {needsCred ? (
            <>
              <label className="field">
                <span className="label">{conn.credLabel}</span>
                <input
                  type="password"
                  value={cred}
                  onChange={(e) => setCred(e.target.value)}
                  autoFocus
                  autoComplete="off"
                />
                <span className="hint">{conn.credHint}</span>
              </label>

              <p className="hint">
                Aura talks straight to {conn.label} from this device. Your key stays here — Aura has
                no server of its own, so it never sees your key or your lights.
              </p>
            </>
          ) : (
            <p className="hint">
              Four make-believe lights to play with — dim them, recolor them, save a scene and recall
              it. No hardware, no key. A good way to feel Aura before you wire up real bulbs.
            </p>
          )}

          {error ? <div className="error">{error}</div> : null}

          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy || !canSubmit} onClick={submit}>
              {busy ? "Connecting…" : needsCred ? "Connect" : "Enter the demo"}
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
