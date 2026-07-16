// Wearables.tsx
// Connecting a device you already wear, and the honest cost of doing it.
//
// The consent step is the point, not paperwork. It reuses the same `.trade` box
// the Welcome screen uses to state the no-reset trade up front, and the same
// `.tier-badge` that discloses Open Food Facts in Log food — because this is the
// same promise being kept in a third place, not a new pattern.
//
// The tone rule from CLAUDE.md holds here too: the badge is honest, not
// frightening. It says what happens, calmly, and lets you decide.

import { useState } from "react";
import { PROVIDERS, type ProviderId, type WearableConnection } from "../lib/wearable";
import { configured } from "../lib/wearable/fitbit";

function whenLabel(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConnectWearable({
  provider, onAccept, onClose,
}: {
  provider: ProviderId;
  onAccept: () => void;
  onClose: () => void;
}) {
  const p = PROVIDERS[provider];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Connect {p.label}</h3>

        <div className="trade">
          <strong>Tier {p.tier} — direct.</strong> {p.discloses}
        </div>

        <div className="set-section">
          <div className="set-head">What Hearth takes</div>
          <div className="chips">
            {p.takes.map((t) => <span className="chip" key={t}>{t}</span>)}
          </div>
        </div>

        <div className="set-section">
          <div className="set-head">What Hearth won't take</div>
          {p.refuses.map((r) => <p key={r}>{r}</p>)}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={onAccept}>
            Accept and connect
          </button>
        </div>
      </div>
    </div>
  );
}

export function Wearables({
  connections, busy, error, onConnect, onImport, onDisconnect,
}: {
  connections: WearableConnection[];
  busy: boolean;
  error: string | null;
  onConnect: (p: ProviderId) => void;
  onImport: (p: ProviderId) => void;
  onDisconnect: (p: ProviderId) => void;
}) {
  const [asking, setAsking] = useState<ProviderId | null>(null);
  const ids = Object.keys(PROVIDERS) as ProviderId[];

  return (
    <>
      {error ? <div className="error">{error}</div> : null}
      {ids.map((id) => {
        const p = PROVIDERS[id];
        const conn = connections.find((c) => c.id === id);
        return (
          <div className="kitchen-row" key={id}>
            <span>
              {p.label}
              <span className="tier-badge">Tier {p.tier} · direct</span>
            </span>
            {conn ? (
              <>
                <span className="metric-row-date">
                  {conn.lastImportAt ? `Last looked ${whenLabel(conn.lastImportAt)}` : "Not looked yet"}
                </span>
                <button className="btn btn-sm" disabled={busy} onClick={() => onImport(id)}>
                  {busy ? "Looking…" : "Refresh"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onDisconnect(id)}>
                  Disconnect
                </button>
              </>
            ) : (
              <button
                className="btn btn-sm"
                disabled={busy || !configured()}
                title={configured() ? undefined : "This build has no Fitbit app id."}
                onClick={() => setAsking(id)}
              >
                Connect
              </button>
            )}
          </div>
        );
      })}

      {asking ? (
        <ConnectWearable
          provider={asking}
          onAccept={() => { setAsking(null); onConnect(asking); }}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
