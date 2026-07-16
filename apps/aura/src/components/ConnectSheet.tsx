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
  const canPair = !!conn?.pair;
  const needsCred = conn?.needsCred !== false;
  const canSubmit = !!conn && (!needsCred || cred.trim().length > 0);

  // Pairing (Hue) state.
  const [address, setAddress] = useState("");
  const [bridges, setBridges] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const err = await onConnect(sourceId, needsCred ? cred : "demo");
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  async function findBridges() {
    if (!conn?.discover) return;
    setFinding(true);
    setError(null);
    const found = await conn.discover();
    setBridges(found);
    if (found[0]) setAddress(found[0]);
    if (!found.length) setError("No bridges found automatically — type your bridge's IP address below.");
    setFinding(false);
  }

  async function pairSubmit() {
    if (!conn?.pair || !address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const paired = await conn.pair(address.trim());
      const err = await onConnect(sourceId, paired);
      if (err) setError(err);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
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

      {conn && canPair ? (
        <>
          <p className="hint">
            Aura will find your Hue bridge on this network. Press the round button on top of the
            bridge, then pair — the key it gives back stays on this device.
          </p>

          <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn btn-sm" onClick={findBridges} disabled={finding}>
              {finding ? "Searching…" : "Find my bridge"}
            </button>
          </div>

          {bridges.length > 1 && (
            <div className="seg" style={{ marginTop: 10 }}>
              {bridges.map((b) => (
                <button key={b} type="button" className="seg-btn" aria-pressed={address === b} onClick={() => setAddress(b)}>
                  {b}
                </button>
              ))}
            </div>
          )}

          <label className="field">
            <span className="label">Bridge IP address</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.42"
              inputMode="decimal"
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy || !address.trim()} onClick={pairSubmit}>
              {busy ? "Pairing…" : "Press link button, then Pair"}
            </button>
          </div>
        </>
      ) : conn ? (
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
