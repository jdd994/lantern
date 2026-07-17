// ImportSheet.tsx
// Bring in a bank export — CSV or OFX/QFX. Tier 0, and the sheet says so: the
// file is read entirely on this device, and what it becomes is encrypted like
// everything else.
//
// The parser (lib/import.ts) never guesses silently: every assumption it made
// is listed here as an issue, BEFORE the import button — same principle as the
// connect sheet's disclosure. The one convention it will not apply on its own
// is sign-flipping (card exports that write charges as positive numbers); that
// is a switch the user throws, with the preview updating live so the choice is
// visible before it's real.

import { useMemo, useState } from "react";
import { formatMoney } from "../lib/money";
import { parseImport, flipSigns, type ImportResult } from "../lib/import";
import { CATEGORIES, type Category, type Suggestion } from "../lib/categorize";
import type { TransactionContent } from "../lib/spend";
import type { Account } from "../lib/ledger";
import { TrustBadge } from "./TrustBadge";

const PREVIEW_ROWS = 8;

export function ImportSheet({
  currency,
  accounts,
  busy,
  suggest,
  onImport,
  onClose,
}: {
  currency: string;
  accounts: Account[];
  busy: boolean;
  suggest: (merchant: string) => Suggestion | null;
  onImport: (
    rows: Array<{ content: TransactionContent; at: number; natural: string }>
  ) => Promise<{ added: number; skipped: number }>;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [flip, setFlip] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);

  const rows = useMemo(() => {
    if (!parsed) return [];
    return flip ? flipSigns(parsed.rows) : parsed.rows;
  }, [parsed, flip]);

  const unsigned = parsed?.issues.some((i) => /sign/.test(i)) ?? false;

  const totals = useMemo(() => {
    let out = 0;
    let inn = 0;
    for (const r of rows) {
      if (r.amount.minor < 0) out += -r.amount.minor;
      else inn += r.amount.minor;
    }
    return { out: { minor: out, currency }, inn: { minor: inn, currency } };
  }, [rows, currency]);

  async function pick(file: File) {
    setError(null);
    setDone(null);
    setFlip(false);
    try {
      const text = await file.text();
      const result = parseImport(text, currency);
      if (result.rows.length === 0) {
        setParsed(null);
        setError(result.issues[0] ?? "Couldn't read anything from that file.");
        return;
      }
      setFileName(file.name);
      setParsed(result);
    } catch {
      setError("Couldn't read that file.");
    }
  }

  function categoryFor(merchant: string, minor: number): Category {
    if (minor > 0) return "income";
    return suggest(merchant)?.category ?? "other";
  }

  async function confirm() {
    if (!rows.length) return;
    setError(null);
    try {
      const result = await onImport(
        rows.map((r) => ({
          at: r.at,
          natural: r.natural,
          content: {
            amount: r.amount,
            merchant: r.merchant,
            category: categoryFor(r.merchant, r.amount.minor),
            accountId: accountId || undefined,
          },
        }))
      );
      setDone(result);
    } catch {
      // useLedger surfaced the reason; keep the sheet open.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Import a statement</h3>

        {done ? (
          <>
            <p className="import-result">
              {done.added === 0
                ? "Nothing new — every row was already here."
                : `Imported ${done.added} transaction${done.added === 1 ? "" : "s"}.`}
              {done.skipped > 0 && done.added > 0
                ? ` ${done.skipped} ${done.skipped === 1 ? "was" : "were"} already here and left untouched.`
                : ""}
            </p>
            <div className="sheet-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {error ? <div className="error">{error}</div> : null}

            {!parsed ? (
              <>
                <label className="receipt-drop import-drop">
                  <span>
                    Choose a CSV or OFX file
                    <small>
                      <TrustBadge tier={0} /> read on this device, stored encrypted — the file goes
                      nowhere
                    </small>
                  </span>
                  <input
                    type="file"
                    accept=".csv,.ofx,.qfx,.txt,text/csv,application/x-ofx"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void pick(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="hint" style={{ marginTop: 10 }}>
                  Every bank exports one of these, and so do the services that won't allow a direct
                  connection. Nothing is saved until you've seen the preview and said so.
                </p>
              </>
            ) : (
              <>
                <p className="import-summary">
                  <strong>{fileName}</strong> — {rows.length} transaction
                  {rows.length === 1 ? "" : "s"}, {formatMoney(totals.out)} out
                  {totals.inn.minor > 0 ? <>, {formatMoney(totals.inn)} in</> : null}.
                </p>

                {parsed.issues.length > 0 ? (
                  <ul className="import-issues">
                    {parsed.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : null}

                {unsigned ? (
                  <label className="import-flip">
                    <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
                    <span>These are charges — positive numbers mean money out</span>
                  </label>
                ) : null}

                <div className="import-preview">
                  {rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <div className="import-row" key={r.natural}>
                      <span className="import-date">
                        {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <span className="import-merchant">{r.merchant}</span>
                      <span className="import-cat">
                        {CATEGORIES[categoryFor(r.merchant, r.amount.minor)].label}
                      </span>
                      <span className={`import-amount${r.amount.minor < 0 ? "" : " is-above"}`}>
                        {formatMoney(r.amount, { sign: true })}
                      </span>
                    </div>
                  ))}
                  {rows.length > PREVIEW_ROWS ? (
                    <div className="import-more">…and {rows.length - PREVIEW_ROWS} more</div>
                  ) : null}
                </div>

                {accounts.length > 0 ? (
                  <label className="field">
                    <span className="label">Which account? (optional)</span>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <p className="hint">
                  Categories are the categoriser's best reading of each description — it learns from
                  the corrections you make later, one at a time. Importing this file again is safe:
                  rows already here are skipped, not duplicated.
                </p>

                <div className="sheet-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setParsed(null);
                      setFileName(null);
                    }}
                  >
                    Different file
                  </button>
                  <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
                    {busy ? "Importing…" : `Import ${rows.length}`}
                  </button>
                </div>
              </>
            )}

            {!parsed ? (
              <div className="sheet-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
