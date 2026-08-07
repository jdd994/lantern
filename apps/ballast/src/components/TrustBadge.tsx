// TrustBadge.tsx
// The honest cost of a connection, rendered next to the account that incurred
// it, every single time you look at it.
//
// This component is small and it is the ethical centre of the app. Fintech
// convention is to bury "we and our partners may access your transaction data"
// in a privacy policy nobody reads, then show a clean green "Connected ✓". The
// badge refuses that. If connecting an account means a third party can read
// every transaction, the account says so, on the dashboard, forever.

import { TradeOffCard } from "@lantern/ui";
import { TIERS, type Tier } from "../lib/ledger";

export function TrustBadge({ tier, showLabel = true }: { tier: Tier; showLabel?: boolean }) {
  const { label, discloses } = TIERS[tier];
  return (
    <span className={`tier tier-${tier}`} title={discloses}>
      {showLabel ? label : null}
    </span>
  );
}

// The consent card, shown before you connect anything. The card itself is the
// family-shared TradeOffCard from @lantern/ui — Ballast built this shape first,
// and now wears the shared one with its own badge and its own words.
export function Disclosure({
  tier,
  discloses,
  takes,
  refuses,
}: {
  tier: Tier;
  discloses: string;
  takes?: string[];
  refuses?: string[];
}) {
  return (
    <TradeOffCard
      tier={tier}
      badge={<TrustBadge tier={tier} />}
      discloses={discloses}
      takes={takes}
      refuses={refuses}
      takesHead="What this takes"
      refusesHead="Deliberately not taken:"
    />
  );
}
