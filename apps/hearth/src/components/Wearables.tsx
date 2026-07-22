// Wearables.tsx
// Connecting a device you already wear, and the honest cost of doing it.
//
// The consent step is the point, not paperwork. It renders the family-shared
// TradeOffCard from @lantern/ui — the same card Aura shows before a brand of
// lights and Ballast shows before a brokerage key — because this is the same
// promise being kept in a third place, not a new pattern.
//
// The tone rule from CLAUDE.md holds here too: the badge is honest, not
// frightening. It says what happens, calmly, and lets you decide.

import { useState } from "react";
import { TradeOffCard } from "@lantern/ui";
import { PROVIDERS, type ProviderId, type WearableConnection } from "../lib/wearable";

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

        <TradeOffCard
          tier={p.tier}
          tierLabel={`Tier ${p.tier} · direct`}
          label={p.label}
          discloses={p.discloses}
          takes={p.takes}
          refuses={p.refuses}
          takesHead="What Hearth takes"
          refusesHead="What Hearth won't take"
        />

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
  connections, busy, error, canConnect, onConnect, onImport, onDisconnect,
}: {
  connections: WearableConnection[];
  busy: boolean;
  error: string | null;
  // Whether this build can start a connection at all (it needs an app id). The
  // hook knows; the component doesn't need to reach into a connector to find out.
  canConnect: boolean;
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
                disabled={busy || !canConnect}
                title={canConnect ? undefined : `This build can't connect ${p.label}.`}
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
