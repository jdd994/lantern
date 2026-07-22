// TradeOffCard — the trade, stated at the moment of choosing.
//
// This is the family's consent card: when a user reaches for an optional
// capability (a brand of lights, a brokerage key, a wearable), this card says
// what it costs, what's taken, and what is deliberately refused — inline in the
// flow they opened, before they hand anything over. Never a popup, never fine
// print. Ballast's Disclosure, Aura's ConnectSheet trade box, and Hearth's
// wearable consent all built this shape independently; this is that shape,
// shared. The words stay with each app — this component only insists they're
// said up front.
//
// `confirm` is the proportional-friction knob: for a heavy choice (a rung where
// something real is learned, an irreversible step), pass a plain-language
// sentence and gate your submit button on `confirmed`. The card renders a
// deliberate checkbox — one honest sentence to tick, not a wall of terms. For
// light choices, leave it off; a tap is enough friction for a demo room.
import type { ReactNode } from "react";
import type { Tier } from "@lantern/core/connect";
import { TierBadge } from "./TierBadge";

export function TradeOffCard({
  tier,
  tierLabel,
  label,
  discloses,
  takes,
  refuses,
  takesHead = "What this takes",
  refusesHead = "Deliberately not taken",
  badge,
  confirm,
  confirmed,
  onConfirm,
  children,
}: {
  tier: Tier;
  /** The app's own wording for the rung — rendered in the shared TierBadge. */
  tierLabel?: string;
  /** The capability's name, leading the disclosure sentence. */
  label?: string;
  discloses: string;
  takes?: string[];
  refuses?: string[];
  takesHead?: string;
  refusesHead?: string;
  /** An app's own badge (e.g. Ballast's TrustBadge), replacing the shared one. */
  badge?: ReactNode;
  /** One plain sentence to tick for heavy choices. Gate your submit on `confirmed`. */
  confirm?: string;
  confirmed?: boolean;
  onConfirm?: (ok: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="l-trade">
      <div className="l-trade-head">{badge ?? <TierBadge tier={tier}>{tierLabel}</TierBadge>}</div>

      <p className="l-trade-body">
        {label ? <strong>{label}.</strong> : null} {discloses}
      </p>

      {takes && takes.length > 0 ? (
        <div className="l-trade-sec">
          <div className="l-trade-sechead">{takesHead}</div>
          <div className="l-trade-chips">
            {takes.map((t) => (
              <span className="l-trade-chip" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {refuses && refuses.length > 0 ? (
        <div className="l-trade-sec">
          {/* The refusals are the other half of consent: a promise made in
              public, not a comment in a file. */}
          <div className="l-trade-sechead">{refusesHead}</div>
          {refuses.map((r) => (
            <p className="l-trade-refusal" key={r}>
              {r}
            </p>
          ))}
        </div>
      ) : null}

      {confirm ? (
        <label className="l-trade-confirm">
          <input
            type="checkbox"
            checked={confirmed ?? false}
            onChange={(e) => onConfirm?.(e.target.checked)}
          />
          <span>{confirm}</span>
        </label>
      ) : null}

      {children}
    </div>
  );
}
