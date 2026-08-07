// CapabilityLedger — the standing half of consent.
//
// The TradeOffCard asks before; this answers after. A quiet list of every
// capability the user said yes to, each wearing its honest cost, each with a
// working undo right there. It lives on a page the user visits (settings, not a
// popup) and it never nags — the entries ARE the reminder, stated once, calmly.
//
// The one rule that matters: entries are derived from what is actually
// connected, so the ledger cannot drift from reality. Revoking an entry is the
// same act as disconnecting the capability — there is no second bookkeeping to
// go stale or to lie.
import type { ReactNode } from "react";
import type { ConsentEntry } from "@lantern/core/connect";
import { TierBadge } from "./TierBadge";

function sinceLabel(at: number): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

export function CapabilityLedger({
  entries,
  onRevoke,
  revokeLabel = "Disconnect",
  emptyText = "Nothing connected.",
  renderBadge,
}: {
  entries: ConsentEntry[];
  onRevoke?: (id: string) => void;
  revokeLabel?: string;
  emptyText?: string;
  /** An app's own badge per entry (e.g. Ballast's TrustBadge), replacing the shared one. */
  renderBadge?: (entry: ConsentEntry) => ReactNode;
}) {
  if (entries.length === 0) return <p className="l-ledger-empty">{emptyText}</p>;

  return (
    <ul className="l-ledger">
      {entries.map((e) => (
        <li className="l-ledger-row" key={e.id}>
          <div className="l-ledger-main">
            <span className="l-ledger-label">{e.label}</span>
            {renderBadge ? renderBadge(e) : <TierBadge tier={e.tier}>{e.tierLabel}</TierBadge>}
            {onRevoke ? (
              <button type="button" className="l-ledger-undo" onClick={() => onRevoke(e.id)}>
                {revokeLabel}
              </button>
            ) : null}
          </div>
          <p className="l-ledger-discloses">{e.discloses}</p>
          {e.detail || e.since ? (
            <p className="l-ledger-meta">
              {[e.detail, e.since ? `Since ${sinceLabel(e.since)}` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
