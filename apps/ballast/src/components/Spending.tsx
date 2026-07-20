// Spending.tsx
// Where the money went, this month.
//
// The tone rule from CLAUDE.md applies hardest here. There is no budget you blew,
// no red bar, no "you're overspending on dining" — that's a judgement, and it
// isn't ours to make. There is what you spent, on what, and whether that's
// unusual for you. What to do about it is yours to decide, and you're better
// placed to decide it than we are.

import { useState } from "react";
import { formatMoney } from "../lib/money";
import { CATEGORIES } from "../lib/categorize";
import {
  byCategory,
  spentIn,
  earnedIn,
  monthWindow,
  notable,
  recurring,
  itemPatterns,
  isSpend,
  hsaAmount,
  hsaBanked,
  type Transaction,
} from "../lib/spend";
import { relative } from "./Waterline";
import { Receipt } from "./icons";

export function Spending({
  transactions,
  currency,
  onRemove,
  onEdit,
  onMarkReimbursed,
  onViewReceipt,
}: {
  transactions: Transaction[];
  currency: string;
  onRemove: (id: string) => void;
  onEdit: (t: Transaction) => void;
  onMarkReimbursed: (id: string, reimbursedAt: number | undefined) => void;
  onViewReceipt: (mediaId: string) => void;
}) {
  const now = Date.now();
  const w = monthWindow(now);
  const [filter, setFilter] = useState<"all" | "hsa">("all");

  const spent = spentIn(transactions, w.from, w.to, currency);
  const earned = earnedIn(transactions, w.from, w.to, currency);
  const cats = byCategory(transactions, w.from, w.to, currency);
  const notices = notable(transactions, now, currency);
  const subs = recurring(transactions, now, currency);
  const buying = itemPatterns(transactions, w.from, w.to, currency);

  const thisMonth = transactions
    .filter((t) => t.at >= w.from && t.at < w.to)
    .sort((a, b) => b.at - a.at);

  // Everything ever flagged, not just this month — "reimburse yourself years
  // later" is the whole premise of the shoebox strategy.
  const banked = hsaBanked(transactions, currency);
  const bankedRows = [...banked.items].sort((a, b) => b.at - a.at);

  if (transactions.length === 0) {
    return (
      <div className="empty">
        Nothing logged yet.
        <br />
        Photograph a receipt, or just type what you spent.
      </div>
    );
  }

  const rowProps = { onRemove, onEdit, onMarkReimbursed, onViewReceipt };

  return (
    <div>
      <div className="subfilter">
        <button
          type="button"
          className="subfilter-btn"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All spending
        </button>
        <button
          type="button"
          className="subfilter-btn"
          aria-pressed={filter === "hsa"}
          onClick={() => setFilter("hsa")}
        >
          HSA-eligible
        </button>
      </div>

      {filter === "hsa" ? (
        <>
          <div className="spend-summary">
            <div className="leg">
              <span className="leg-label">Banked, total</span>
              <span className="leg-value">{formatMoney(banked.total)}</span>
            </div>
            <div className="leg">
              <span className="leg-label">Banked, unreimbursed</span>
              <span className="leg-value is-below">{formatMoney(banked.unreimbursed)}</span>
            </div>
          </div>

          <div className="section" style={{ marginTop: 24 }}>
            <div className="section-head">
              <h3 className="section-title">HSA-eligible</h3>
            </div>
            {bankedRows.length === 0 ? (
              <div className="empty">
                Nothing flagged yet. Flag a purchase as HSA-eligible from its Edit screen.
              </div>
            ) : (
              bankedRows.map((t) => <Row key={t.id} t={t} {...rowProps} />)
            )}
          </div>
        </>
      ) : (
        <>
          <div className="spend-summary">
            <div className="leg">
              <span className="leg-label">Out — {w.label}</span>
              <span className="leg-value is-below">{formatMoney(spent)}</span>
            </div>
            {earned.minor > 0 ? (
              <div className="leg">
                <span className="leg-label">In</span>
                <span className="leg-value is-above">{formatMoney(earned)}</span>
              </div>
            ) : null}
          </div>

          {/* "Unusual for you" — in both directions, because telling someone their
              dining spend halved is the same kind of fact, and it's the one that
              makes them feel capable. */}
          {notices.length > 0 ? (
            <div className="notices">
              {notices.slice(0, 3).map((n) => (
                <div className="notice" key={n.category}>
                  {n.ratio > 1 ? (
                    <>
                      <strong>{CATEGORIES[n.category].label}</strong> is{" "}
                      <strong>{n.ratio.toFixed(1)}×</strong> your usual month —{" "}
                      {formatMoney(n.this)} against a typical {formatMoney(n.usual)}.
                    </>
                  ) : (
                    <>
                      <strong>{CATEGORIES[n.category].label}</strong> is well down this month —{" "}
                      {formatMoney(n.this)} against a typical {formatMoney(n.usual)}.
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {/* The honest half of "suggest alternatives": these are the charges that
              quietly repeat. What to do about them is entirely your call — Ballast
              does not have an opinion, and would be lying if it pretended to. */}
          {subs.length > 0 ? (
            <div className="section" style={{ marginTop: 24 }}>
              <div className="section-head">
                <h3 className="section-title">Repeating</h3>
                <span className="section-note">
                  {formatMoney({
                    minor: subs.reduce((a, s) => a + s.amount.minor, 0),
                    currency,
                  })}{" "}
                  a month
                </span>
              </div>
              {subs.map((s) => (
                <div className="repeat" key={s.merchant}>
                  <span className="repeat-name">{s.merchant}</span>
                  <span className="repeat-meta">{CATEGORIES[s.category].label}</span>
                  <span className="repeat-amount money">{formatMoney(s.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Item-level awareness, live off itemised receipts. The point is
              presence, not policing: seeing "chips, 6 times, $24" as a plain fact
              invites a moment of noticing — and that is the entire feature. What
              to do about it is the user's business. Updates as receipts land. */}
          {buying.length > 0 ? (
            <div className="section" style={{ marginTop: 24 }}>
              <div className="section-head">
                <h3 className="section-title">What you're buying most</h3>
                <span className="section-note">{w.label}</span>
              </div>
              {buying.map((b) => (
                <div className="repeat" key={b.label}>
                  <span className="repeat-name">{b.label}</span>
                  <span className="repeat-meta">
                    {b.count}×
                  </span>
                  <span className="repeat-amount money">{formatMoney(b.total)}</span>
                </div>
              ))}
              <p className="hint" style={{ marginTop: 8 }}>
                From itemised receipts — the more you scan, the truer this gets.
              </p>
            </div>
          ) : null}

          {cats.length > 0 ? (
            <div className="section" style={{ marginTop: 24 }}>
              <div className="section-head">
                <h3 className="section-title">Where it went</h3>
              </div>
              {cats.map((c) => (
                <div className="cat" key={c.category}>
                  <div className="cat-head">
                    <span>{CATEGORIES[c.category].label}</span>
                    <span className="money">{formatMoney(c.total)}</span>
                  </div>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${Math.round(c.share * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="section" style={{ marginTop: 24 }}>
            <div className="section-head">
              <h3 className="section-title">{w.label}</h3>
            </div>
            {thisMonth.length === 0 ? (
              <div className="empty">Nothing logged this month.</div>
            ) : (
              thisMonth.map((t) => <Row key={t.id} t={t} {...rowProps} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  t,
  onRemove,
  onEdit,
  onMarkReimbursed,
  onViewReceipt,
}: {
  t: Transaction;
  onRemove: (id: string) => void;
  onEdit: (t: Transaction) => void;
  onMarkReimbursed: (id: string, reimbursedAt: number | undefined) => void;
  onViewReceipt: (mediaId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const out = isSpend(t) || t.amount.minor < 0;

  return (
    <div className="txn">
      <div className="txn-main">
        <div className="txn-merchant">
          {t.merchant}
          {t.receiptId ? (
            <button
              className="receipt-chip"
              onClick={() => onViewReceipt(t.receiptId!)}
              title="View the receipt"
            >
              <Receipt />
            </button>
          ) : hsaAmount(t) > 0 ? (
            // Audit-readiness, not alarm: banked without a receipt is worth a
            // glance before you actually go to reimburse it, same calm marker
            // as the OCR-uncertain flag on an item line.
            <span
              className="item-flag"
              title="Banked as HSA-eligible — no receipt on file"
              aria-label="No receipt on file"
            >
              ●
            </span>
          ) : null}
        </div>
        <div className="txn-meta">
          <span>{CATEGORIES[t.category].label}</span>
          <span aria-hidden="true">·</span>
          <span>{relative(t.at)}</span>
          {t.note ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{t.note}</span>
            </>
          ) : null}
        </div>
        {t.items && t.items.length > 0 ? (
          <details className="txn-items">
            <summary>
              {t.items.length === 1 ? "1 item" : `${t.items.length} items`}
            </summary>
            {t.items.map((i, idx) => (
              <div className="txn-item" key={idx}>
                <span className="txn-item-label">{i.label}</span>
                {i.category && i.category !== t.category ? (
                  <span className="txn-item-cat">{CATEGORIES[i.category].label}</span>
                ) : null}
                <span className="txn-item-amount">{formatMoney(i.amount)}</span>
              </div>
            ))}
          </details>
        ) : null}
      </div>

      <div className={`txn-amount${out ? " is-below" : " is-above"}`}>
        {formatMoney(t.amount, { sign: true })}
      </div>

      {confirming ? (
        <div className="txn-actions">
          <button className="btn btn-danger btn-sm" onClick={() => onRemove(t.id)}>
            Delete
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="txn-actions">
          {hsaAmount(t) > 0 ? (
            <button
              className={`btn btn-ghost btn-sm${t.reimbursedAt ? " is-reimbursed" : ""}`}
              onClick={() => onMarkReimbursed(t.id, t.reimbursedAt ? undefined : Date.now())}
              title={
                t.reimbursedAt
                  ? "Reimbursed from the HSA — click to undo"
                  : "Mark as reimbursed from the HSA"
              }
            >
              {t.reimbursedAt ? "Reimbursed ✓" : "Mark reimbursed"}
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(t)} title="Edit">
            Edit
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} title="Remove">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// The receipt, decrypted only for as long as it's on screen. A photo renders
// inline; a PDF attachment can't (<img> can't show one), so it gets an
// <embed> where the browser supports it, plus a plain link either way —
// <embed>'s PDF rendering is weak or absent on iOS Safari and some Android
// WebViews, and the link is the one path that always works.
export function ReceiptView({
  receipt,
  onClose,
}: {
  receipt: { dataUrl: string; type: string };
  onClose: () => void;
}) {
  const isPdf = receipt.type === "application/pdf";
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="receipt-full" onClick={(e) => e.stopPropagation()}>
        {isPdf ? (
          <>
            <embed src={receipt.dataUrl} type="application/pdf" className="receipt-pdf" />
            <a href={receipt.dataUrl} download="receipt.pdf" className="btn btn-ghost btn-sm">
              Open in a new tab
            </a>
          </>
        ) : (
          <img src={receipt.dataUrl} alt="Receipt" />
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
