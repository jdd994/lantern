// AddExpense.tsx
// Snap the receipt, say what it was.
//
// The capture calls `readReceipt()`, which runs OCR on this device and returns a
// DRAFT — total, merchant, date, line items — that pre-fills the form. Every
// field stays editable and nothing is saved until you confirm, so a bad read is
// a nuisance, never a corrupted ledger. When the reader can't run, the fields
// simply open blank and you type, exactly as this form worked on day one.
//
// The categoriser suggests as you type the merchant, and says honestly whether it
// LEARNED that from you or is merely guessing. Confirming a guess teaches it.
//
// Items read off the receipt each get a category of their own (defaulting to the
// expense's). Give two items different categories and the spending breakdown
// splits the money accordingly — a Target run can be half groceries, half
// shopping, and both truths land where they belong.

import { useEffect, useRef, useState } from "react";
import { minorDigits, parseMoney } from "../lib/money";
import { CATEGORIES, SPEND_CATEGORIES, type Category, type Suggestion } from "../lib/categorize";
import type { TransactionContent, TransactionItem } from "../lib/spend";
import { readReceipt } from "../lib/receipt";
import { compressImage, dataUrl, imageForOcr } from "../lib/media";
import type { Account } from "../lib/ledger";
import { TrustBadge } from "./TrustBadge";
import { Receipt } from "./icons";

// An item row under edit. Amounts are text while typing; parsed on save.
// category "" means "same as the expense" and follows the headline category.
type ItemRow = { label: string; amount: string; category: Category | "" };

function today(): string {
  return dateKey(new Date());
}

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Minor units → the text a human would type in the amount field. Display-only;
// parseMoney is the way back.
function minorToText(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  const s = String(Math.abs(minor)).padStart(digits + 1, "0");
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

// The form takes a date, but a transaction is stored at an instant. For a past
// date, noon is a fair, timezone-safe stand-in for "some time that day".
//
// For TODAY, though, use the actual clock. Stamping an expense you just logged at
// 8pm as if it happened at noon is simply untrue, and it bites: a goal started
// this afternoon would silently exclude a receipt you entered this evening,
// because the expense would sit before the goal's own start line.
function instantFor(date: string): number {
  const now = new Date();
  if (date === dateKey(now)) return now.getTime();
  return new Date(`${date}T12:00:00`).getTime();
}

export function AddExpense({
  currency,
  accounts,
  busy,
  suggest,
  onAdd,
  onClose,
}: {
  currency: string;
  accounts: Account[];
  busy: boolean;
  suggest: (merchant: string) => Suggestion | null;
  onAdd: (content: TransactionContent, at: number, receipt?: File) => Promise<void>;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string>("");
  const [note, setNote] = useState("");
  const [income, setIncome] = useState(false);

  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Soft, not an error: "the reader ran and got nothing" must be said — a
  // silently blank form is indistinguishable from the reader not existing —
  // but it must never scold, because typing it in works exactly as it always has.
  const [readNote, setReadNote] = useState<string | null>(null);
  // What the engine read, verbatim. Debug affordance: never stored, never sent —
  // it exists so "the scan missed something" can become a copy-pasteable report
  // (and, ultimately, a parser test fixture) instead of a mystery.
  const [rawText, setRawText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);

  // Whether the current category came from the user or from the categoriser, so
  // we never overwrite a deliberate choice with a suggestion.
  const [touchedCategory, setTouchedCategory] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Suggest a category from the merchant as it's typed.
  useEffect(() => {
    if (income) return;
    const s = merchant.trim() ? suggest(merchant) : null;
    setSuggestion(s);
    if (s && !touchedCategory) setCategory(s.category);
  }, [merchant, income, suggest, touchedCategory]);

  async function pickReceipt(file: File) {
    setError(null);
    setReading(true);
    try {
      // Downscale first, then preview — so what you see is what gets stored.
      const { bytes, type } = await compressImage(file);
      setPreview(dataUrl(bytes, type));
      setReceipt(file);

      // The seam. The reader gets the ORIGINAL photo — the compressed copy
      // above is for storage; its re-encode eats the thin strokes OCR needs.
      // The reader returns whatever it could defend; a blank draft just means
      // the form opens blank, as it always did.
      setReadNote(null);
      setRawText(null);
      setCopied(false);
      const forOcr = await imageForOcr(file).catch(() => new Blob([bytes], { type }));
      const { draft, outcome } = await readReceipt(forOcr, currency);
      if (draft.rawText?.trim()) setRawText(draft.rawText);
      if (draft.merchant) setMerchant(draft.merchant);
      if (draft.amount) setAmount(minorToText(Math.abs(draft.amount.minor), currency));
      if (draft.at) setDate(dateKey(new Date(draft.at)));
      if (draft.items && draft.items.length > 0) {
        setItems(
          draft.items.map((i) => ({
            label: i.label,
            amount: minorToText(i.amount.minor, currency),
            category: "",
          }))
        );
      }
      // Two kinds of nothing, said differently: a photo the OCR lost to is
      // worth retaking; a reader that couldn't run isn't, and pretending
      // otherwise sends someone off to photograph the same receipt five times.
      if (outcome === "empty") {
        setReadNote(
          "Couldn't read this one. What helps: fill the frame with the receipt, flatten it, and avoid glare. The photo is kept either way — typing it in works as always."
        );
      } else if (outcome === "failed") {
        setReadNote(
          "The reader couldn't run in this browser, so nothing was read — the photo is kept and typing it in works as always. (Retaking the photo won't change this one.)"
        );
      }
    } catch (e) {
      // A photo that can't be read must never block logging the expense. The
      // number is the thing that matters; the picture is a nice-to-have.
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
      setReceipt(null);
      setPreview(null);
    } finally {
      setReading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = parseMoney(amount, currency);
    if (!parsed || parsed.minor === 0) {
      setError("How much was it?");
      return;
    }
    if (!merchant.trim()) {
      setError("Who was it? (This is what the categoriser learns from.)");
      return;
    }

    // Item rows, if any survive review. A row that's half-filled is a question
    // the user hasn't answered yet — say so rather than guessing or dropping it.
    let itemContents: TransactionItem[] | undefined;
    if (!income) {
      const rows = items.filter((r) => r.label.trim() || r.amount.trim());
      const built: TransactionItem[] = [];
      for (const row of rows) {
        const label = row.label.trim();
        const rowParsed = parseMoney(row.amount, currency);
        if (!label || !rowParsed || rowParsed.minor <= 0) {
          setError(
            `The item "${label || row.amount || "?"}" needs both a name and an amount — fill it in or remove the row.`
          );
          return;
        }
        built.push({
          label,
          amount: { minor: Math.abs(rowParsed.minor), currency },
          // Stored only when it differs — "same as the expense" stays implicit,
          // so recategorising the expense later carries these items with it.
          ...(row.category && row.category !== category ? { category: row.category } : {}),
        });
      }
      if (built.length > 0) itemContents = built;
    }

    const magnitude = Math.abs(parsed.minor);
    const content: TransactionContent = {
      // Money out is negative. Signed at the boundary, so nothing downstream has
      // to remember a convention.
      amount: { minor: income ? magnitude : -magnitude, currency },
      merchant: merchant.trim(),
      category: income ? "income" : category,
      note: note.trim() || undefined,
      accountId: accountId || undefined,
      items: itemContents,
    };

    try {
      await onAdd(content, instantFor(date), receipt ?? undefined);
      onClose();
    } catch {
      // useLedger surfaced the reason; keep the sheet open so nothing typed is lost.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{income ? "Log income" : "Log an expense"}</h3>

        {/* The receipt is a tier-0 artifact and it says so, because a photo of
            your receipt is more revealing than the number on it. */}
        <div className="receipt-zone">
          {preview ? (
            <div className="receipt-preview">
              <img src={preview} alt="Receipt" />
              {readNote ? <span className="hint">{readNote}</span> : null}
              <div className="receipt-preview-actions">
                {rawText ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Copy the text the reader saw — handy for reporting a scan that missed something"
                    onClick={() => {
                      void navigator.clipboard?.writeText(rawText).then(() => setCopied(true));
                    }}
                  >
                    {copied ? "Copied" : "Copy what it read"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setReceipt(null);
                    setPreview(null);
                    setReadNote(null);
                    setRawText(null);
                    setCopied(false);
                  }}
                >
                  Remove photo
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="receipt-drop"
              onClick={() => fileInput.current?.click()}
              disabled={reading}
            >
              <span className="receipt-icon" aria-hidden="true">
                <Receipt size={24} />
              </span>
              <span>
                {reading ? "Reading it, on this device…" : "Photograph the receipt"}
                <small>
                  <TrustBadge tier={0} /> encrypted on this device, never uploaded
                </small>
              </span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickReceipt(f);
              e.target.value = "";
            }}
          />
        </div>

        <form onSubmit={submit}>
          {error ? <div className="error">{error}</div> : null}

          <div className="row">
            <label className="field">
              <span className="label">{income ? "Amount in" : "Amount"}</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </label>
            <label className="field">
              <span className="label">When</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span className="label">{income ? "From" : "Who"}</span>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder={income ? "Acme Payroll" : "Trader Joe's"}
            />
            {suggestion && !income ? (
              <span className="hint">
                {suggestion.from === "learned" ? (
                  <>
                    You've filed this under{" "}
                    <strong>{CATEGORIES[suggestion.category].label}</strong> before.
                  </>
                ) : (
                  <>
                    Guessing <strong>{CATEGORIES[suggestion.category].label}</strong> — correct it
                    and it'll remember.
                  </>
                )}
              </span>
            ) : null}
          </label>

          {!income ? (
            <label className="field">
              <span className="label">Category</span>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as Category);
                  setTouchedCategory(true);
                }}
              >
                {SPEND_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].label}
                  </option>
                ))}
                <option value="transfer">{CATEGORIES.transfer.label} (not spending)</option>
              </select>
            </label>
          ) : null}

          {!income ? (
            <div className="items-block">
              <div className="items-head">
                <span className="label">
                  {items.length > 0 ? "On the receipt — check what it read" : null}
                </span>
              </div>
              {items.map((row, i) => (
                <div className="item-row" key={i}>
                  <input
                    type="text"
                    className="item-label"
                    value={row.label}
                    placeholder="Item"
                    onChange={(e) =>
                      setItems((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r))
                      )
                    }
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    className="item-amount"
                    value={row.amount}
                    placeholder="0.00"
                    onChange={(e) =>
                      setItems((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))
                      )
                    }
                  />
                  <select
                    className="item-category"
                    value={row.category}
                    onChange={(e) =>
                      setItems((rows) =>
                        rows.map((r, j) =>
                          j === i ? { ...r, category: e.target.value as Category | "" } : r
                        )
                      )
                    }
                  >
                    <option value="">Same as expense</option>
                    {SPEND_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORIES[c].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Remove this item"
                    onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setItems((rows) => [...rows, { label: "", amount: "", category: "" }])
                }
              >
                + Add an item
              </button>
              {items.some((r) => r.category && r.category !== category) ? (
                <span className="hint">
                  Items with their own category split this expense in the monthly breakdown.
                </span>
              ) : null}
            </div>
          ) : null}

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

          <label className="field">
            <span className="label">Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was it for?"
            />
          </label>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setIncome((v) => !v)}
          >
            {income ? "← This is an expense" : "This is income instead →"}
          </button>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || reading}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
