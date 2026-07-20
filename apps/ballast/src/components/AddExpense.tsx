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
import type { Transaction, TransactionContent, TransactionItem } from "../lib/spend";
import { readReceipt } from "../lib/receipt";
import { compressImage, dataUrl, imageForOcr } from "../lib/media";
import type { Account } from "../lib/ledger";
import { TrustBadge } from "./TrustBadge";
import { ScanCamera } from "./ScanCamera";
import { Receipt } from "./icons";

// The live scan assist needs a camera the browser will admit to having.
// Everywhere else — and whenever permission is declined — the photo picker
// path works exactly as it always has.
const cameraPossible = (): boolean =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

// An item row under edit. Amounts are text while typing; parsed on save.
// category "" means "same as the expense" and follows the headline category.
// `uncertain` = the OCR read this line shakily (calm marker, never hidden);
// `gap` = the arithmetic remainder the reader couldn't itemise, offered as an
// editable row — name it and it becomes real, ignore it and it saves nothing.
// `hsaEligible` mirrors `category`: undefined means "no per-item override",
// so it round-trips untouched through a plain edit until something sets it.
type ItemRow = {
  label: string;
  amount: string;
  category: Category | "";
  uncertain?: boolean;
  gap?: boolean;
  hsaEligible?: boolean;
};

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
  editing,
  onUpdate,
  onLoadReceipt,
  onClose,
}: {
  currency: string;
  accounts: Account[];
  busy: boolean;
  suggest: (merchant: string) => Suggestion | null;
  onAdd: (content: TransactionContent, at: number, receipt?: File) => Promise<void>;
  // Present only when editing an existing transaction. `onUpdate`'s `receipt`
  // is tri-state: undefined keeps whatever's already attached, null detaches
  // it, a File replaces it.
  editing?: Transaction;
  onUpdate?: (
    id: string,
    content: TransactionContent,
    at: number,
    receipt?: File | null
  ) => Promise<void>;
  onLoadReceipt?: (mediaId: string) => Promise<{ dataUrl: string; type: string } | null>;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [amount, setAmount] = useState(
    editing ? minorToText(Math.abs(editing.amount.minor), currency) : ""
  );
  const [category, setCategory] = useState<Category>(
    editing && editing.category !== "income" ? editing.category : "other"
  );
  const [date, setDate] = useState(editing ? dateKey(new Date(editing.at)) : today());
  const [accountId, setAccountId] = useState<string>(editing?.accountId ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [income, setIncome] = useState(editing?.category === "income");
  // The HSA "shoebox" flag — a fact about the purchase, not a budget category,
  // so it lives beside `category` rather than as one more option inside it.
  const [hsaEligible, setHsaEligible] = useState(editing?.hsaEligible ?? false);

  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Set instead of `preview` for a PDF — there's no image to show, just the
  // name of the file that's attached.
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Soft, not an error: "the reader ran and got nothing" must be said — a
  // silently blank form is indistinguishable from the reader not existing —
  // but it must never scold, because typing it in works exactly as it always has.
  const [readNote, setReadNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  // What the engine read, verbatim. Debug affordance: never stored, never sent —
  // it exists so "the scan missed something" can become a copy-pasteable report
  // (and, ultimately, a parser test fixture) instead of a mystery.
  const [rawText, setRawText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [items, setItems] = useState<ItemRow[]>(
    () =>
      editing?.items?.map((i) => ({
        label: i.label,
        amount: minorToText(Math.abs(i.amount.minor), currency),
        category: i.category ?? "",
        hsaEligible: i.hsaEligible,
      })) ?? []
  );
  // The honest header over the items: what was read, what wasn't. Fixed at scan
  // time; the rows below stay editable.
  const [readSummary, setReadSummary] = useState<string | null>(null);
  const [taxMinor, setTaxMinor] = useState(0);
  const [amountShaky, setAmountShaky] = useState(false);

  // Whether the current category came from the user or from the categoriser, so
  // we never overwrite a deliberate choice with a suggestion. An edit opens
  // with a category already chosen — the merchant-suggestion effect must not
  // clobber it the moment the form mounts.
  const [touchedCategory, setTouchedCategory] = useState(Boolean(editing));
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The receipt already on this transaction, loaded read-only so editing
  // never re-runs OCR on a photo that's already been through it. `null` once
  // loaded-and-empty is indistinguishable from not-yet-loaded, which is fine —
  // both render the same "no receipt" state.
  const [existingReceipt, setExistingReceipt] = useState<{ dataUrl: string; type: string } | null>(
    null
  );
  const [removedExisting, setRemovedExisting] = useState(false);

  // Runs once, for the transaction this form opened with — App.tsx mounts a
  // fresh AddExpense per edit session, so there's no later `editing` to react to.
  useEffect(() => {
    if (editing?.receiptId && onLoadReceipt) {
      void onLoadReceipt(editing.receiptId).then((r) => setExistingReceipt(r));
    }
  }, []);

  // The moment itemisation earns its keep: when the rows plus tax equal the
  // total exactly, say so — that's the user NOT having to recheck the paper.
  // Live-computed, so it appears (and disappears) as rows are edited.
  const addsUp = (() => {
    if (income || items.length === 0) return null;
    const total = parseMoney(amount, currency);
    if (!total || total.minor <= 0) return null;
    let sum = 0;
    for (const r of items) {
      if (!r.label.trim() && !r.amount.trim()) continue;
      const m = parseMoney(r.amount, currency);
      if (!m || m.minor <= 0) return null;
      sum += Math.abs(m.minor);
    }
    if (sum === 0) return null;
    if (sum + taxMinor === Math.abs(total.minor)) {
      return taxMinor > 0
        ? `with ${minorToText(taxMinor, currency)} tax, adds up to ${minorToText(total.minor, currency)} ✓`
        : `adds up to ${minorToText(total.minor, currency)} ✓`;
    }
    return null;
  })();

  // Suggest a category from the merchant as it's typed.
  useEffect(() => {
    if (income) return;
    const s = merchant.trim() ? suggest(merchant) : null;
    setSuggestion(s);
    if (s && !touchedCategory) setCategory(s.category);
  }, [merchant, income, suggest, touchedCategory]);

  async function pickReceipt(file: File) {
    setError(null);

    // A PDF has no OCR path — there's nothing to read, so there's nothing to
    // do but attach it and let the fields get filled in by hand.
    if (file.type === "application/pdf") {
      setReceipt(file);
      setPreview(null);
      setPdfName(file.name);
      setReadNote(null);
      setRawText(null);
      setCopied(false);
      setReadSummary(null);
      setAmountShaky(false);
      return;
    }
    setPdfName(null);

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
      setAmountShaky(Boolean(draft.amountUncertain));
      setTaxMinor(draft.tax?.minor ?? 0);
      if (draft.items && draft.items.length > 0) {
        const rows: ItemRow[] = draft.items.map((i) => ({
          label: i.label,
          amount: minorToText(i.amount.minor, currency),
          category: "",
          ...(i.uncertain ? { uncertain: true } : {}),
        }));
        // The gap row: the remainder the reader couldn't itemise, as exact
        // arithmetic. One glance at the paper and a name typed beats
        // re-entering an item — and left unnamed, it saves nothing.
        if (draft.unread) {
          rows.push({
            label: "",
            amount: minorToText(draft.unread.minor, currency),
            category: "",
            gap: true,
          });
        }
        setItems(rows);
        const n = draft.items.length;
        let summary = `read ${n} item${n === 1 ? "" : "s"}`;
        if (draft.soldCount && draft.soldCount !== n) {
          summary += ` — the receipt says ${draft.soldCount}`;
        }
        if (draft.unread) {
          summary += `, ${minorToText(draft.unread.minor, currency)} unaccounted for`;
        }
        setReadSummary(summary);
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
      // A gap row left unnamed was an offer, not a claim — it saves nothing.
      const rows = items.filter(
        (r) => (r.label.trim() || r.amount.trim()) && !(r.gap && !r.label.trim())
      );
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
          // Passed through untouched — there's no per-item HSA control in this
          // form yet, so an edit must never turn a set flag back to unset.
          ...(row.hsaEligible !== undefined ? { hsaEligible: row.hsaEligible } : {}),
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
      hsaEligible: !income && hsaEligible ? true : undefined,
      // No control for this in the form — reimbursement is its own action
      // (see Spending's "Mark reimbursed") — carried through so editing any
      // other field can never silently un-reimburse something.
      reimbursedAt: editing?.reimbursedAt,
    };

    try {
      if (editing && onUpdate) {
        // Tri-state: a newly picked file replaces, an explicit removal
        // detaches, anything else leaves the current receipt untouched.
        const receiptArg: File | null | undefined = receipt ?? (removedExisting ? null : undefined);
        await onUpdate(editing.id, content, instantFor(date), receiptArg);
      } else {
        await onAdd(content, instantFor(date), receipt ?? undefined);
      }
      onClose();
    } catch {
      // useLedger surfaced the reason; keep the sheet open so nothing typed is lost.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? "Edit expense" : income ? "Log income" : "Log an expense"}</h3>

        {/* The receipt is a tier-0 artifact and it says so, because a photo of
            your receipt is more revealing than the number on it. */}
        <div className="receipt-zone">
          {preview || pdfName ? (
            <div className="receipt-preview">
              {pdfName ? (
                <div className="receipt-pdf-chip">
                  <Receipt size={20} /> {pdfName}
                </div>
              ) : (
                <img src={preview!} alt="Receipt" />
              )}
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
                    setPdfName(null);
                    setReadNote(null);
                    setRawText(null);
                    setCopied(false);
                    setReadSummary(null);
                    setAmountShaky(false);
                  }}
                >
                  {pdfName ? "Remove file" : "Remove photo"}
                </button>
              </div>
            </div>
          ) : existingReceipt && !removedExisting ? (
            <div className="receipt-preview">
              {existingReceipt.type === "application/pdf" ? (
                <div className="receipt-pdf-chip">
                  <Receipt size={20} /> PDF attached
                </div>
              ) : (
                <img src={existingReceipt.dataUrl} alt="Receipt" />
              )}
              <div className="receipt-preview-actions">
                {/* Opens the file picker directly, not the camera — a
                    replacement is as likely to be a PDF as a rescan. */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => fileInput.current?.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRemovedExisting(true)}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="receipt-drop"
                onClick={() => (cameraPossible() ? setScanning(true) : fileInput.current?.click())}
                disabled={reading}
              >
                <span className="receipt-icon" aria-hidden="true">
                  <Receipt size={24} />
                </span>
                <span>
                  {reading ? "Reading it, on this device…" : "Scan the receipt"}
                  <small>
                    <TrustBadge tier={0} /> encrypted on this device, never uploaded
                  </small>
                </span>
              </button>
              {cameraPossible() && !reading ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm receipt-alt"
                  onClick={() => fileInput.current?.click()}
                >
                  or pick a file
                </button>
              ) : null}
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
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
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountShaky(false);
                }}
                placeholder="0.00"
                autoFocus
              />
              {amountShaky ? (
                <span className="hint">
                  The reader wasn't confident about this number — worth a glance at the paper.
                </span>
              ) : null}
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
            <label className="check-row">
              <input
                type="checkbox"
                checked={hsaEligible}
                onChange={(e) => setHsaEligible(e.target.checked)}
              />
              <span>
                HSA-eligible — paid out of pocket, banking the receipt to reimburse later
              </span>
            </label>
          ) : null}

          {!income ? (
            <div className="items-block">
              <div className="items-head">
                <span className="label">
                  {items.length > 0
                    ? readSummary
                      ? `On the receipt — ${readSummary}`
                      : "On the receipt — check what it read"
                    : null}
                </span>
              </div>
              {items.map((row, i) => (
                <div className={`item-row${row.gap ? " item-row-gap" : ""}`} key={i}>
                  {row.uncertain ? (
                    <span
                      className="item-flag"
                      title="The reader wasn't sure about this line — worth a glance at the paper."
                      aria-label="Worth a glance"
                    >
                      ●
                    </span>
                  ) : null}
                  <input
                    type="text"
                    className="item-label"
                    value={row.label}
                    placeholder={row.gap ? "Something it couldn't read — name it or remove it" : "Item"}
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
                  {/* Tri-state, cycling undefined → true → false → undefined —
                      "same as the expense" is a real, distinct state, not just
                      "no". Text stays fixed width; only the color changes. */}
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm item-hsa${
                      row.hsaEligible === true
                        ? " item-hsa-yes"
                        : row.hsaEligible === false
                          ? " item-hsa-no"
                          : ""
                    }`}
                    title={
                      row.hsaEligible === true
                        ? "HSA-eligible — click to mark this item not eligible"
                        : row.hsaEligible === false
                          ? "Marked not HSA-eligible (overrides the expense) — click to clear"
                          : "Same as the expense — click to flag this item HSA-eligible"
                    }
                    onClick={() =>
                      setItems((rows) =>
                        rows.map((r, j) =>
                          j === i
                            ? {
                                ...r,
                                hsaEligible:
                                  r.hsaEligible === undefined
                                    ? true
                                    : r.hsaEligible === true
                                      ? false
                                      : undefined,
                              }
                            : r
                        )
                      )
                    }
                  >
                    HSA
                  </button>
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
              {addsUp ? <span className="adds-up">{addsUp}</span> : null}
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

        {scanning ? (
          <ScanCamera
            onCapture={(file) => {
              setScanning(false);
              void pickReceipt(file);
            }}
            onClose={() => setScanning(false)}
            onUnavailable={(message) => {
              // Declining the camera is a fine answer — the picker path is
              // not a consolation prize, it's the original feature.
              setScanning(false);
              setReadNote(message);
              fileInput.current?.click();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
