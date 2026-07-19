// ConnectSheet.tsx — connect a lighting brand. Two steps on purpose: which brand
// (an informed choice, wearing the same family trust-tier badge as Ballast's
// accounts and Hearth's wearables — see @lantern/core/connect), then that brand's
// consent + credential. No brand is pre-selected — the picker is the first thing
// you see, not a tab strip behind a Govee key field.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Tier } from "@lantern/core/connect";
import { connectors } from "../lib/connectors";

function tierBadge(tier: Tier): string {
  switch (tier) {
    case 0: return "Nothing leaves this device";
    case 1: return "Local network only";
    case 2: return "Direct to the brand";
    default: return "Via a third party";
  }
}

export function ConnectSheet({
  onConnect,
  onClose,
}: {
  onConnect: (sourceId: string, cred: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cred, setCred] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = connectors.find((c) => c.id === sourceId);
  const canPair = !!conn?.pair;
  const needsCred = conn?.needsCred !== false;
  const canSubmit =
    !!conn &&
    (!needsCred ||
      (conn.credFields ? conn.credFields.every((f) => (fields[f.key] ?? "").trim().length > 0) : cred.trim().length > 0));

  // Pairing (Hue) state.
  const [address, setAddress] = useState("");
  const [bridges, setBridges] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);

  // Switching brands (including "back") clears every field — a leftover Govee
  // key must never get submitted as a Home Assistant token.
  function chooseBrand(id: string | null) {
    setSourceId(id);
    setCred("");
    setFields({});
    setAddress("");
    setBridges([]);
    setError(null);
  }

  async function submit() {
    if (!conn || !canSubmit) return;
    setBusy(true);
    setError(null);
    const value = conn.credFields ? conn.credFields.map((f) => fields[f.key] ?? "").join("|") : cred;
    const err = await onConnect(conn.id, needsCred ? value : "demo");
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
      const err = await onConnect(conn.id, paired);
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

      {!conn ? (
        <div className="provider-grid">
          {connectors.map((c) => (
            <button key={c.id} type="button" className="provider-card" onClick={() => chooseBrand(c.id)}>
              <span className="provider-card-head">
                <span className="provider-card-label">{c.label}</span>
                <span className="tier-badge">{tierBadge(c.descriptor.tier)}</span>
              </span>
              <span className="provider-card-desc">{c.descriptor.discloses}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button type="button" className="linklike" onClick={() => chooseBrand(null)}>
            ← Choose a different brand
          </button>

          <div className="trade">
            <strong>{conn.label}.</strong> {conn.descriptor.discloses}
          </div>

          {conn.descriptor.takes.length > 0 && (
            <div className="set-section">
              <div className="set-head">What Aura takes</div>
              <div className="chips">
                {conn.descriptor.takes.map((t) => (
                  <span className="chip" key={t}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {conn.descriptor.refuses.length > 0 && (
            <div className="set-section">
              <div className="set-head">What Aura won't take</div>
              {conn.descriptor.refuses.map((r) => <p key={r}>{r}</p>)}
            </div>
          )}
        </>
      )}

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
          {needsCred && conn.credFields ? (
            <>
              {conn.credFields.map((f, i) => (
                <label className="field" key={f.key}>
                  <span className="label">{f.label}</span>
                  <input
                    type={f.type ?? "text"}
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    autoFocus={i === 0}
                    autoComplete="off"
                  />
                  {f.hint ? <span className="hint">{f.hint}</span> : null}
                </label>
              ))}
              <p className="hint">{conn.credHint}</p>
            </>
          ) : needsCred ? (
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
          ) : (
            <p className="hint">
              Dim them, recolor them, save a scene and recall it. A good way to feel Aura before you
              wire up real bulbs.
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
