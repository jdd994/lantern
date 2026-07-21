// TierBadge — the family trust-tier pill: a small colored dot for the rung and
// the app's own wording next to it. Deliberately quiet: it states the bound of
// what's happening without raising its voice. Each app keeps its own words for
// each rung (that's a family rule — see @lantern/core/connect); the dot colors
// read from optional app tokens (--above / --brass / --below) with calm
// fallbacks, so the badge looks native everywhere.
import type { ReactNode } from "react";
import type { Tier } from "@lantern/core/connect";

export function TierBadge({ tier, children }: { tier: Tier; children?: ReactNode }) {
  return (
    <span className={`l-tier l-tier-${tier}`}>
      <span className="l-tier-dot" aria-hidden="true" />
      {children ?? `Tier ${tier}`}
    </span>
  );
}
