// Waterline.tsx
// The signature element. One number, and where it sits relative to zero.
//
// The tone here is load-bearing. Someone whose net worth is negative already
// knows it and probably feels bad about it; the app's job is to be the calm,
// literate friend who tells them the truth and does not flinch — not the app
// that renders their life in alarm-red and calls it "insight". Underwater is a
// fact, not a verdict. It says so, once, quietly, and then it tells them their
// trajectory, because that is the part they can actually do something about.

import { relativeLabel } from "@lantern/core/time";
import { formatMoney, type Money, type NetWorth } from "../lib/money";
import type { Account } from "../lib/ledger";

export function Waterline({
  net,
  currency,
  asOf,
}: {
  net: NetWorth & { unpriced: Account[] };
  currency: string;
  asOf?: number;
}) {
  const underwater = net.total.minor < 0;
  const empty = net.assets.minor === 0 && net.liabilities.minor === 0;

  return (
    <section className="waterline">
      <div className="waterline-label">Net worth</div>

      <span className={`waterline-total${underwater ? " is-below" : ""}`}>
        {formatMoney(net.total)}
      </span>

      <div className="waterline-note">
        {empty ? (
          "Add an account below and this becomes real."
        ) : underwater ? (
          <>You owe more than you hold right now. That's a fact, not a verdict — and it's a fact you can move.</>
        ) : (
          <>You're above water.</>
        )}
        {asOf ? <> Last updated {relative(asOf)}.</> : null}
      </div>

      <div className="waterline-rule" aria-hidden="true" />

      <div className="waterline-split">
        <div className="leg">
          <span className="leg-label">Hold</span>
          <span className="leg-value is-above">{formatMoney(net.assets)}</span>
        </div>
        <div className="leg">
          <span className="leg-label">Owe</span>
          <span className="leg-value is-below">{formatMoney(net.liabilities)}</span>
        </div>
      </div>

      {/* An unknown is not a zero. Folding an unpriced account into the total as
          nothing would understate their net worth while looking entirely
          plausible — the most dangerous kind of wrong. */}
      {net.unpriced.length > 0 ? (
        <div className="unpriced-note">
          {net.unpriced.length === 1 ? (
            <>
              Not counted: {net.unpriced[0].name} — we couldn't get a price just now, and a
              number we don't know isn't the same as a zero. The total above is missing it.
            </>
          ) : (
            <>
              Not counted: {net.unpriced.map((a) => a.name).join(", ")} — we couldn't get
              prices just now, and a number we don't know isn't the same as a zero. The total
              above is missing them.
            </>
          )}
        </div>
      ) : null}

      <span className="num" style={{ display: "none" }}>
        {currency}
      </span>
    </section>
  );
}

export function relative(at: number): string {
  return relativeLabel(at, { style: "narrow" });
}

export function signedMoney(m: Money): string {
  return formatMoney(m, { sign: true });
}
