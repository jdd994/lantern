// TrustBadge.tsx
// The honest cost of a connection, rendered next to the account that incurred
// it, every single time you look at it.
//
// This component is small and it is the ethical centre of the app. Fintech
// convention is to bury "we and our partners may access your transaction data"
// in a privacy policy nobody reads, then show a clean green "Connected ✓". The
// badge refuses that. If connecting an account means a third party can read
// every transaction, the account says so, on the dashboard, forever.

import { TIERS, type Tier } from "../lib/ledger";

export function TrustBadge({ tier, showLabel = true }: { tier: Tier; showLabel?: boolean }) {
  const { label, discloses } = TIERS[tier];
  return (
    <span className={`tier tier-${tier}`} title={discloses}>
      {showLabel ? label : null}
    </span>
  );
}

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
    <div className="disclosure">
      <TrustBadge tier={tier} />
      <p>{discloses}</p>
      {takes && takes.length > 0 ? (
        <ul className="disclosure-list disclosure-takes">
          {takes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
      {refuses && refuses.length > 0 ? (
        <>
          {/* The refusals are the other half of consent: a promise made in
              public, not a comment in a file. */}
          <p className="disclosure-refuses-head">Deliberately not taken:</p>
          <ul className="disclosure-list disclosure-refuses">
            {refuses.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
