// receiptparse.ts
// Pure. OCR text in, a ReceiptDraft out. No IO, no DOM, no engine — which is why
// this file is unit-tested and ocr.ts (the engine plumbing) barely needs to be.
//
// OCR output from a real receipt is messy in predictable ways: thermal print
// drops characters, columns collapse into single lines, and the same dollar
// figure appears three times (subtotal, total, amount tendered). The job here is
// not to be clever — it is to extract only what we can defend, and to leave a
// field blank rather than guess. Everything returned lands in an editable form
// the user confirms, so a miss costs eight seconds of typing, exactly what the
// feature replaced. A confident wrong answer would cost trust instead.

import { minorDigits, type Money } from "./money";
import type { ReceiptDraft, ReceiptDraftItem } from "./receipt";

// "TOTAL" as the OCR actually delivers it off thermal paper: T0TAL, TOTAI,
// T0TA1. The word is the anchor the whole parse hangs on, so it gets matched
// the way it arrives, not the way it was printed.
const FUZZY_TOTAL = "T[O0Q]TA[LI1!]";
const FUZZY_SUBTOTAL = `SUB\\s?-?\\s?${FUZZY_TOTAL}`;

// Words that mean a line is arithmetic or payment, not a purchased item. If a
// line says CHANGE 20.00, the twenty dollars is the cashier's, not the store's.
const NOT_AN_ITEM = new RegExp(
  `\\b(${FUZZY_SUBTOTAL}|${FUZZY_TOTAL}|TAX|VAT|GST|HST|TIP|GRATUITY|CASH|CHANGE|CHG|TEND(ER(ED)?)?|VISA|MASTERCARD|M\\/?C|AMEX|DISCOVER|DEBIT|CREDIT|CARD|PAYMENT|PURCHASE|BALANCE|AMOUNT|AUTH|APPROVED|REFUND|SAVINGS?|SAVED|COUPON|DISCOUNT|LOYALTY|POINTS|REWARDS?|ROUNDING)\\b`,
  "i"
);

// Lines whose amount is the one we actually want.
const TOTAL_LINE = new RegExp(
  `\\b(${FUZZY_TOTAL}|AMOUNT\\s+DUE|BALANCE\\s+DUE|TO\\s+PAY|GRAND\\s+${FUZZY_TOTAL})\\b`,
  "i"
);
// ...unless the same line disqualifies itself.
const NOT_THE_TOTAL = new RegExp(
  `\\b(${FUZZY_SUBTOTAL}|TAX|TIP|SAVINGS?|SAVED|ITEMS?\\s+SOLD|POINTS|TENDER)\\b`,
  "i"
);

// Payment lines often repeat the total to the cent; change lines exceed it.
// Neither may win the "largest amount" fallback.
const PAYMENT_LINE =
  /\b(CASH|CHANGE|CHG|TEND(ER(ED)?)?|VISA|MASTERCARD|M\/?C|AMEX|DISCOVER|DEBIT|CREDIT|CARD|AUTH|APPROVED|BALANCE|PURCHASE)\b/i;

// The subset of payment lines that MUST equal the total: a card is charged the
// exact amount, always. (Cash is tendered over it and change comes back, so
// CASH/CHANGE never get a vote.) These are the receipt's own extra copies of
// the total, and each is an independent OCR read of the same number.
const CARD_WITNESS =
  /\b(VISA|MASTERCARD|M\/?C|AMEX|DISCOVER|DEBIT|CREDIT|CARD|PURCHASE)\b/i;

const TAX_WORDS = /\b(TAX|VAT|GST|HST)\b/i;

// A money figure at the end of a line: "4.99", "1,234.56", "12,34", with an
// optional currency symbol, an optional trailing minus or tax-flag code —
// "4.99-", "7.99 A" and "3.59 BF" are all common register formats (two-letter
// flags are real; a receipt in the field taught us that) — and grudging room
// for up to TWO short digit-free scraps after it, because a photographed
// receipt's background bleeds specks into the right margin ("7.99 A   im .").
// Scraps are ≤3 characters each: "USD/lb" and friends stay long enough to keep
// rate lines ("1.45 lb @ 2.29 USD/lb") out of the money.
const TRAILING_AMOUNT =
  /(?:^|\s)[$£€]?\s?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(-)?\s*[A-Z*]{0,2}(\s+[^\s\d]{1,3}){0,2}\s*$/;

// Any money figure, anywhere in a line. Used ONLY on lines already anchored by
// a total keyword — background clutter loves to append junk after the figure
// ("TOTAL usd 14.90 \ i Sie"), and the anchor word is what makes grabbing a
// mid-line amount safe there and unsafe everywhere else (rate lines like
// "1.45 lb @ 2.29 USD/lb" must never yield a money line).
const ANY_AMOUNT = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g;

// OCR loves to read "$" as "S" or "5" glued to the number; strip a leading
// currency-ish rune before parsing digits.
function parseAmountMinor(raw: string, currency: string): number | null {
  const digits = minorDigits(currency);
  // Normalise "1.234,56" and "12,34" (comma-decimal) to dot-decimal.
  let s = raw;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal separator.
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const m = s.match(/^(\d+)\.(\d{2})$/) ?? s.match(/^(\d+)$/);
  if (!m) return null;
  const whole = m[1];
  const frac = (m[2] ?? "").padEnd(digits, "0").slice(0, digits);
  const minor = Number(whole + frac);
  return Number.isSafeInteger(minor) ? minor : null;
}

// A line as the engine delivered it: the text, and how sure the engine was.
// `confidence` is 0..100 or absent (a plain-text parse has no opinion).
export type ScoredLine = { text: string; confidence?: number };

// Below this, a reading is flagged "worth a glance" in the form. Chosen from
// field photos: garbage lines score 0-35, solid print 80+; the shaky-but-
// present digits live in between.
const SHAKY = 65;

type MoneyLine = {
  index: number;
  text: string; // the line without its trailing amount
  minor: number;
  confidence?: number;
};

function moneyLines(lines: ScoredLine[], currency: string): MoneyLine[] {
  const out: MoneyLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(TRAILING_AMOUNT);
    if (!m) continue;
    const minor = parseAmountMinor(m[1], currency);
    if (minor === null || minor === 0) continue;
    out.push({
      index: i,
      text: lines[i].text.slice(0, lines[i].text.length - m[0].length).trim(),
      minor,
      confidence: lines[i].confidence,
    });
  }
  return out;
}

// ---- The total -------------------------------------------------------------

const letterCount = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;

// `index` is the line the figure was lifted from, when that line isn't a
// normal money line — the caller must keep it out of the items, or a garbled
// "Visa 14.90" that lent us the total shows up as something you bought.
// `corroborated` = at least two independent readings agreed on this value.
type FoundTotal = { minor?: number; index?: number; confidence?: number; corroborated?: boolean };

// A reading of "the total" from one place on the tape. A receipt states its
// total several times — the TOTAL line, the card slip's AMOUNT, the card
// payment line, SUBTOTAL+TAX arithmetic — and each is an independent OCR read
// of the same number. Digit misreads are random per instance, so when copies
// agree, the agreement is evidence; when a lone TOTAL says 44.61 but AMOUNT
// and Visa both say 44.81, the lone reading is the misread. Let them vote.
type Witness = {
  minor: number;
  src: "total" | "arith" | "amount" | "card";
  confidence?: number;
  index?: number;
};

const SRC_RANK: Record<Witness["src"], number> = { total: 0, arith: 1, amount: 2, card: 3 };

function findTotal(lines: ScoredLine[], monied: MoneyLine[], currency: string): FoundTotal {
  const byIndex = new Map(monied.map((l) => [l.index, l]));
  const witnesses: Witness[] = [];

  // Every TOTAL-anchored reading, scanned from the BOTTOM ("TOTAL" is often
  // preceded by "SUBTOTAL", and running totals appear mid-tape). The keyword is
  // the anchor; the figure can be messier than a trailing amount — anywhere in
  // the line (background clutter appends junk after it), or on the line below
  // (registers and column-splitting OCR both do that).
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!TOTAL_LINE.test(lines[i].text) || NOT_THE_TOTAL.test(lines[i].text)) continue;
    const on = byIndex.get(i);
    if (on) {
      witnesses.push({ minor: on.minor, src: "total", confidence: on.confidence });
      continue;
    }
    const inLine = [...lines[i].text.matchAll(ANY_AMOUNT)]
      .map((m) => parseAmountMinor(m[1], currency))
      .filter((n): n is number => n !== null && n > 0);
    if (inLine.length > 0) {
      witnesses.push({
        minor: inLine[inLine.length - 1],
        src: "total",
        confidence: lines[i].confidence,
        index: i,
      });
      continue;
    }
    const next = byIndex.get(i + 1);
    if (next && !PAYMENT_LINE.test(next.text) && letterCount(next.text) <= 2) {
      witnesses.push({ minor: next.minor, src: "total", confidence: next.confidence, index: next.index });
    }
  }

  // SUBTOTAL + TAX: keyword-anchored, arithmetic exact. TAX may legitimately be
  // absent (or 0.00, which moneyLines skips) — then the subtotal IS the total.
  const taxMinor = monied.filter((l) => TAX_WORDS.test(l.text)).reduce((a, l) => a + l.minor, 0);
  const subtotal = monied.filter((l) => new RegExp(`\\b${FUZZY_SUBTOTAL}`, "i").test(l.text));
  if (subtotal.length > 0) {
    const sub = subtotal[subtotal.length - 1];
    witnesses.push({ minor: sub.minor + taxMinor, src: "arith", confidence: sub.confidence });
  }

  // The card slip's copies. Skip lines already counted as TOTAL-anchored.
  for (const l of monied) {
    const full = lines[l.index]?.text ?? "";
    if (TOTAL_LINE.test(full) && !NOT_THE_TOTAL.test(full)) continue;
    if (/\bAMOUNT\b/i.test(l.text)) {
      witnesses.push({ minor: l.minor, src: "amount", confidence: l.confidence });
    } else if (CARD_WITNESS.test(l.text)) {
      witnesses.push({ minor: l.minor, src: "card", confidence: l.confidence });
    }
  }

  // What the items themselves add up to — a CORROBORATOR only, never a winner:
  // partial reads make it wrong too often to trust alone, but when it lands on
  // the same number as a real witness, that number is solid. Echo lines
  // (an "item" repeating an anchored value) are dropped the same way findItems
  // drops them, unless the receipt is a single line (a latte's price IS the total).
  const anchored = new Set(witnesses.map((w) => w.minor));
  let itemish = monied.filter(
    (l) =>
      !PAYMENT_LINE.test(l.text) &&
      !NOT_AN_ITEM.test(l.text) &&
      letterCount(cleanLabel(l.text)) >= 2
  );
  if (itemish.length >= 2) itemish = itemish.filter((l) => !anchored.has(l.minor));
  const itemsum = itemish.reduce((a, l) => a + l.minor, 0) + taxMinor;

  // The vote. A value carried by two or more readings — including the item
  // arithmetic — wins; ties break toward the better-anchored source.
  const tally = new Map<number, { votes: number; best: Witness }>();
  for (const w of witnesses) {
    const t = tally.get(w.minor);
    if (!t) tally.set(w.minor, { votes: 1, best: w });
    else {
      t.votes += 1;
      if (SRC_RANK[w.src] < SRC_RANK[t.best.src]) t.best = w;
    }
  }
  if (itemsum > 0) {
    const t = tally.get(itemsum);
    if (t) t.votes += 1;
  }
  const agreed = [...tally.values()]
    .filter((t) => t.votes >= 2)
    .sort((a, b) => b.votes - a.votes || SRC_RANK[a.best.src] - SRC_RANK[b.best.src]);
  if (agreed.length > 0) {
    const w = agreed[0].best;
    return { minor: w.minor, index: w.index, confidence: w.confidence, corroborated: true };
  }

  // No agreement: fall back to the best-anchored single reading, in source
  // order. Honest uncertainty rides along — the form says "worth a glance"
  // when the reading was shaky and nothing corroborated it.
  const ranked = [...witnesses].sort((a, b) => SRC_RANK[a.src] - SRC_RANK[b.src]);
  if (ranked.length > 0) {
    const w = ranked[0];
    return { minor: w.minor, index: w.index, confidence: w.confidence };
  }

  // Nothing anchored anywhere: the largest amount that isn't payment
  // arithmetic — usually the total, since the total is the sum of everything
  // above it. But that logic cuts both ways: when the OTHER amounts add up to
  // well over the candidate, it cannot be their total — it's just the priciest
  // item, and the real total went unread. Claim nothing; the items speak.
  const candidates = monied.filter((l) => !PAYMENT_LINE.test(l.text));
  if (candidates.length === 0) return {};
  const max = Math.max(...candidates.map((l) => l.minor));
  const rest =
    itemish.reduce((a, l) => a + l.minor, 0) -
    (itemish.some((l) => l.minor === max) ? max : 0);
  if (rest > 0 && max < rest * 0.8) return {};
  const winner = candidates.find((l) => l.minor === max);
  return {
    minor: max,
    confidence: winner?.confidence,
    ...(itemsum === max && itemish.length > 1 ? { corroborated: true } : {}),
  };
}

// ---- The merchant ----------------------------------------------------------

const MERCHANT_NOISE =
  /\b(RECEIPT|INVOICE|WELCOME\s+TO|THANK\s+YOU|TEL|PHONE|FAX|WWW\.|HTTP|STORE\s*#?\d*|REG(ISTER)?\s*#?\d*|CASHIER|ORDER|SURVEY)\b/i;

function findMerchant(scored: ScoredLine[]): string | undefined {
  const lines = scored.map((l) => l.text);
  // The name is almost always in the first few printed lines, above the
  // address — but a photographed logo shreds into short garbage lines that sit
  // above it. So don't take the FIRST plausible early line; take the most
  // letter-dense one, which is the printed name and not the logo's debris.
  let best: string | undefined;
  let bestLetters = 0;
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3) continue;
    if (MERCHANT_NOISE.test(line)) continue;
    if (/\d{3,}/.test(line)) continue; // street numbers, zips, phones
    if (TRAILING_AMOUNT.test(line)) continue;
    const cleaned = line.replace(/[^A-Za-z0-9\s&'’.-]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3 && letters > bestLetters) {
      best = cleaned;
      bestLetters = letters;
    }
  }
  return best;
}

// ---- The date --------------------------------------------------------------

function findDate(text: string, now: number): number | undefined {
  // ISO first — unambiguous.
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  let y: number | undefined, mo: number | undefined, d: number | undefined;
  if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
  } else {
    const slashed = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (!slashed) return undefined;
    const a = Number(slashed[1]);
    const b = Number(slashed[2]);
    y = Number(slashed[3]);
    if (y < 100) y += 2000;
    // "13/05" can only be day-first; "05/13" can only be month-first. When both
    // readings are possible, month-first — and if that guess is wrong, the date
    // sits right there in the form to correct.
    if (a > 12) { d = a; mo = b; } else { mo = a; d = b; }
  }
  if (!y || !mo || !d || mo > 12 || d > 31 || y < 2000) return undefined;
  const at = new Date(y, mo - 1, d, 12, 0, 0).getTime();
  // A receipt from the future or the distant past is a misread, not a fact.
  if (Number.isNaN(at) || at > now + 24 * 3600 * 1000) return undefined;
  if (at < now - 10 * 365 * 24 * 3600 * 1000) return undefined;
  return at;
}

// ---- The items -------------------------------------------------------------

// Strip register plumbing off the front of an item label. What a person wants
// in their ledger is "GREEK YOGURT", not "E 1048072 GREEK YOGURT" — the flag
// letter and the SKU are the register talking to itself. The pattern is
// general, not one store's: leading tokens carrying no letters (SKUs, £2, #),
// and 1-2 character stubs sitting in front of them or each other. A real word
// like "XL" in "XL Eggs" survives, because what follows it has letters.
function cleanLabel(text: string): string {
  const qtyless = text.replace(/^\d+\s*[xX@]\s*/, "").replace(/\s{2,}/g, " ").trim();
  const tokens = qtyless.split(/\s+/);
  while (tokens.length > 1) {
    const t = tokens[0];
    const letters = (t.match(/[A-Za-z]/g) ?? []).length;
    const nextHasWord =
      (tokens[1].match(/[A-Za-z]/g) ?? []).length > 0 && tokens[1].length > 2;
    if (letters === 0) tokens.shift(); // 1048072, £2, #, **
    else if (t.length <= 2 && !nextHasWord) tokens.shift(); // E before a SKU, stray "g"
    else break;
  }
  return tokens.join(" ");
}

function findItems(
  monied: MoneyLine[],
  total: FoundTotal,
  currency: string
): ReceiptDraftItem[] {
  const totalMinor = total.minor;
  let items: ReceiptDraftItem[] = [];
  for (const l of monied) {
    // The line the total's figure was lifted from is spoken for — a garbled
    // payment line that lent us 14.90 is not something you bought.
    if (l.index === total.index) continue;
    if (NOT_AN_ITEM.test(l.text)) continue;
    // An "item" priced above the receipt total is a misread (often the phone
    // number). Better to drop it than to present it as something you bought.
    if (totalMinor !== undefined && l.minor > totalMinor) continue;

    const label = cleanLabel(l.text);
    const letters = (label.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 2) continue;

    items.push({
      label,
      amount: { minor: l.minor, currency },
      ...(l.confidence !== undefined && l.confidence < SHAKY ? { uncertain: true } : {}),
    });
  }

  // A receipt tape has a natural ceiling; hundreds of "items" means the read
  // went wrong, and pre-filling a form with garbage is worse than a blank form.
  if (items.length > 60) return [];

  // A mangled payment line that repeats the total to the cent ("Visa 14.90"
  // with the word Visa unreadable) is an ECHO, not a purchase. When it sneaks
  // in it inflates the sum and used to get every real item withheld along with
  // it — so drop echoes first, and only when the receipt is more than one line
  // (a latte whose price IS the total is a real single-item receipt).
  if (totalMinor !== undefined && items.length >= 2) {
    items = items.filter((i) => i.amount.minor !== totalMinor);
  }

  // If what remains still visibly disagrees with the total (sum wildly above
  // it), the read is untrustworthy — return the total alone, let the human type.
  if (totalMinor !== undefined) {
    const sum = items.reduce((a, i) => a + i.amount.minor, 0);
    if (sum > totalMinor * 1.15) return [];
  }
  return items;
}

// ---- Entry point -----------------------------------------------------------

// The registers that print their own item count give us certainty for free.
const SOLD_COUNT = /\bITEMS?\s+SOLD\b/i;

export function parseReceiptLines(
  scored: ScoredLine[],
  currency: string,
  now: number = Date.now()
): ReceiptDraft {
  const lines = scored
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0);
  if (lines.length === 0) return {};

  const monied = moneyLines(lines, currency);
  // A receipt with no readable amounts on it wasn't read — it was mangled. A
  // merchant or date "found" in that wreckage is noise wearing a name tag, so
  // return nothing and let the form open blank.
  if (monied.length === 0) return {};

  const total = findTotal(lines, monied, currency);

  const draft: ReceiptDraft = {};
  if (total.minor !== undefined) {
    // Spending is signed at the form boundary, so the draft carries magnitude.
    draft.amount = { minor: total.minor, currency } satisfies Money;
    if (total.corroborated) {
      // Two independent readings agreed — confidence earned, not assumed.
      draft.amountCorroborated = true;
    } else if (total.confidence !== undefined && total.confidence < SHAKY) {
      draft.amountUncertain = true;
    }
  }
  const merchant = findMerchant(lines);
  if (merchant) draft.merchant = merchant;
  const text = lines.map((l) => l.text).join("\n");
  const at = findDate(text, now);
  if (at) draft.at = at;

  const items = findItems(monied, total, currency);
  if (items.length > 0) draft.items = items;

  // Tax, as read — it explains the gap between the items and the total.
  const taxMinor = monied
    .filter((l) => TAX_WORDS.test(l.text) && l.index !== total.index)
    .reduce((a, l) => a + l.minor, 0);
  if (taxMinor > 0) draft.tax = { minor: taxMinor, currency };

  // The honesty arithmetic: what the total says minus what we could itemise.
  // Exact subtraction, not a guess — rendered as an editable gap row.
  if (draft.amount && items.length > 0) {
    const gap = draft.amount.minor - items.reduce((a, i) => a + i.amount.minor, 0) - taxMinor;
    if (gap > 0) draft.unread = { minor: gap, currency };
  }

  // "TOTAL NUMBER OF ITEMS SOLD - 2": the register's own count, when printed.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!SOLD_COUNT.test(lines[i].text)) continue;
    const nums = lines[i].text.match(/\d+/g);
    const n = nums ? Number(nums[nums.length - 1]) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 200) draft.soldCount = n;
    break;
  }

  return draft;
}

// Plain-text entry point — used by tests and any reader without line scores.
export function parseReceiptText(
  text: string,
  currency: string,
  now: number = Date.now()
): ReceiptDraft {
  return parseReceiptLines(
    text.split(/\r?\n/).map((t) => ({ text: t })),
    currency,
    now
  );
}
