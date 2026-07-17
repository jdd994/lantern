// import.ts
// Pure. A bank export in, candidate transactions out. Tier 0: a file you
// downloaded yourself, read entirely on this device — the cheapest rung on the
// ladder, and the escape hatch for every institution that won't allow a direct
// connection.
//
// Bank exports are hostile in boring ways: three date formats, amounts as
// "-12.34", "(12.34)", "12,34" or split across debit/credit columns, and a
// description column named eight different things. The job here is the same as
// receiptparse.ts: extract only what we can defend, surface what we had to
// assume as `issues` (rendered in the preview, before anything is saved), and
// let the human confirm. Nothing in this file writes anything.
//
// Re-import safety lives in `natural`: every row carries a deterministic natural
// key (OFX's FITID when the bank provides one; otherwise date+amount+description
// +occurrence). The hook HMACs it into the record id via @lantern/core/connect,
// so importing the same file twice maps onto the same records — and the second
// pass changes nothing.

import { minorDigits, type Money } from "./money";

export type ImportedRow = {
  at: number;
  amount: Money; // signed: negative = money out
  merchant: string;
  natural: string;
};

export type ImportResult = {
  kind: "csv" | "ofx";
  rows: ImportedRow[];
  // Assumptions the parser had to make, in plain sentences. Shown in the
  // preview so consenting to them is informed, not implied.
  issues: string[];
};

// ---- loose money -----------------------------------------------------------
// Bank exports write money every way there is: "-12.34", "(12.34)", "12,34",
// "1.234,56", "$1,234.56", "12.34-". Normalise them all to exact minor units.

export function parseLooseMinor(raw: string, currency: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, "");
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[^0-9.,]/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal separator ("1.234,56" or "12,34")...
    // unless it reads like a thousands group ("1,234").
    const frac = s.length - lastComma - 1;
    if (frac === 3 && lastDot === -1 && !/,\d+,/.test(s)) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(/\./g, "").replace(",", ".");
    }
  } else {
    s = s.replace(/,/g, "");
  }

  if ((s.match(/\./g) ?? []).length > 1) return null;
  const digits = minorDigits(currency);
  const [whole = "0", frac = ""] = s.split(".");
  const minor = Number((whole || "0") + frac.padEnd(digits, "0").slice(0, digits));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

// ---- CSV tokenizer -----------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

// ---- dates -------------------------------------------------------------------

type DatedParts = { y: number; mo: number; d: number };

// First pass: what could this cell be? Both readings of "03/04/2026" survive
// until inference (below) has seen the whole column.
function dateCandidates(cell: string): DatedParts[] {
  const s = cell.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return [{ y: +m[1], mo: +m[2], d: +m[3] }];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3] < 100 ? +m[3] + 2000 : +m[3];
    const out: DatedParts[] = [];
    if (a <= 12 && b <= 31) out.push({ y, mo: a, d: b }); // month-first
    if (b <= 12 && a <= 31 && a !== b) out.push({ y, mo: b, d: a }); // day-first
    return out;
  }
  // "01 Jul 2026" / "Jul 1, 2026"
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/) ?? s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const dayFirst = /^\d/.test(m[1]);
    const mon = MONTHS.indexOf((dayFirst ? m[2] : m[1]).slice(0, 3).toLowerCase());
    if (mon >= 0) {
      return [{ y: +m[3], mo: mon + 1, d: +(dayFirst ? m[1] : m[2]) }];
    }
  }
  return [];
}

const atNoon = (p: DatedParts): number => new Date(p.y, p.mo - 1, p.d, 12).getTime();

// ---- CSV column inference ------------------------------------------------------

const DESC_HEADERS = /\b(description|payee|merchant|name|details|memo|narrative|transaction)\b/i;
const DEBIT_HEADERS = /\b(debit|withdrawal|money\s*out|paid\s*out|out)\b/i;
const CREDIT_HEADERS = /\b(credit|deposit|money\s*in|paid\s*in|in)\b/i;
const AMOUNT_HEADERS = /\b(amount|value|sum)\b/i;
const NOT_AMOUNT_HEADERS = /\b(balance|running)\b/i;

function looksLikeHeader(row: string[]): boolean {
  return row.every((cell) => parseLooseMinor(cell, "USD") === null || !/\d/.test(cell)) &&
    row.some((cell) => /[A-Za-z]/.test(cell));
}

function parseCsvRows(text: string, currency: string): ImportResult {
  const issues: string[] = [];
  const grid = parseCsv(text);
  if (grid.length === 0) return { kind: "csv", rows: [], issues: ["The file looks empty."] };

  const header = looksLikeHeader(grid[0]) ? grid[0].map((h) => h.trim()) : null;
  const body = header ? grid.slice(1) : grid;
  if (body.length === 0) return { kind: "csv", rows: [], issues: ["No rows below the header."] };
  const width = Math.max(...body.map((r) => r.length));
  const col = (r: string[], i: number) => (r[i] ?? "").trim();

  // Score every column for every role over the whole body, then pick.
  const dateScores = Array.from({ length: width }, (_, i) =>
    body.filter((r) => dateCandidates(col(r, i)).length > 0).length
  );
  const dateCol = dateScores.indexOf(Math.max(...dateScores));
  if (dateScores[dateCol] === 0) {
    return { kind: "csv", rows: [], issues: ["Couldn't find a date column."] };
  }

  const numericScore = (i: number) =>
    i === dateCol ? 0 : body.filter((r) => col(r, i) !== "" && parseLooseMinor(col(r, i), currency) !== null).length;

  // Debit/credit pair by header, else a single amount column: prefer an
  // "amount"-titled column, refuse a "balance" one, else the most numeric.
  let amountOf: ((r: string[]) => number | null) | null = null;
  if (header) {
    const di = header.findIndex((h) => DEBIT_HEADERS.test(h) && !CREDIT_HEADERS.test(h));
    const ci = header.findIndex((h) => CREDIT_HEADERS.test(h) && !DEBIT_HEADERS.test(h));
    if (di >= 0 && ci >= 0 && di !== ci) {
      amountOf = (r) => {
        const out = parseLooseMinor(col(r, di), currency);
        const inn = parseLooseMinor(col(r, ci), currency);
        if (out !== null && out !== 0) return -Math.abs(out);
        if (inn !== null && inn !== 0) return Math.abs(inn);
        return out ?? inn;
      };
    }
  }
  if (!amountOf) {
    let ai = -1;
    if (header) {
      ai = header.findIndex((h) => AMOUNT_HEADERS.test(h) && !NOT_AMOUNT_HEADERS.test(h));
    }
    if (ai < 0) {
      const scores = Array.from({ length: width }, (_, i) =>
        header && NOT_AMOUNT_HEADERS.test(header[i] ?? "") ? 0 : numericScore(i)
      );
      ai = scores.indexOf(Math.max(...scores));
      if (scores[ai] === 0) return { kind: "csv", rows: [], issues: ["Couldn't find an amount column."] };
    }
    const fixed = ai;
    amountOf = (r) => parseLooseMinor(col(r, fixed), currency);
  }

  // Description: by header, else the column with the most alphabetic text.
  let descCol = header ? header.findIndex((h) => DESC_HEADERS.test(h)) : -1;
  if (descCol < 0) {
    const scores = Array.from({ length: width }, (_, i) => {
      if (i === dateCol) return 0;
      return body.reduce((a, r) => a + (col(r, i).match(/[A-Za-z]/g)?.length ?? 0), 0);
    });
    descCol = scores.indexOf(Math.max(...scores));
  }

  // Date-format inference over the WHOLE column: a single row like "25/06"
  // settles day-first for every row. dateCandidates orders readings
  // [month-first, day-first], so "only the day-first reading survived" shows up
  // as a lone candidate with d > 12.
  const dayFirst = body.some((r) => {
    const c = dateCandidates(col(r, dateCol));
    return c.length === 1 && c[0].d > 12;
  });
  const anyAmbiguous = body.some((r) => dateCandidates(col(r, dateCol)).length > 1);
  if (anyAmbiguous && !dayFirst) {
    issues.push(
      "Dates like 03/04 are read as month/day. If this export is day-first, the preview dates will look wrong — stop there and say so."
    );
  }

  const rows: ImportedRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const r of body) {
    const cands = dateCandidates(col(r, dateCol));
    const picked = cands.length <= 1 ? cands[0] : dayFirst ? cands[1] : cands[0];
    const minor = amountOf(r);
    const merchant = col(r, descCol).replace(/\s+/g, " ").trim();
    if (!picked || minor === null || minor === 0 || !merchant) {
      skipped++;
      continue;
    }
    const at = atNoon(picked);
    const dateKey = `${picked.y}-${String(picked.mo).padStart(2, "0")}-${String(picked.d).padStart(2, "0")}`;
    // Occurrence counter: two identical coffees on one day are both real, and
    // both import — while a re-import maps 1:1 onto the same keys.
    const base = `csv:${dateKey}:${minor}:${merchant.toUpperCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    rows.push({
      at,
      amount: { minor, currency },
      merchant,
      natural: n === 0 ? base : `${base}:${n}`,
    });
  }
  if (skipped > 0) issues.push(`${skipped} row${skipped === 1 ? " was" : "s were"} unreadable and left out.`);

  // A statement where nothing is negative usually means "positive = money out"
  // (card exports do this). We do NOT flip signs on a guess — we say it.
  if (rows.length > 0 && rows.every((r) => r.amount.minor > 0)) {
    issues.push(
      "No amount in this file carries a sign, so everything would import as money in. If these are card charges, the export uses positive-means-out — flip the switch below."
    );
  }
  return { kind: "csv", rows, issues };
}

// ---- OFX / QFX -----------------------------------------------------------------
// OFX 1.x is SGML (unclosed tags), 2.x is XML. Field-level regex inside each
// STMTTRN block tolerates both. FITID is the bank's own stable id for the row —
// the best natural key there is, when it's present.

function ofxField(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const v = m?.[1].trim();
  return v ? v : null;
}

function parseOfx(text: string, currency: string): ImportResult {
  const issues: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  if (blocks.length === 0) {
    return { kind: "ofx", rows: [], issues: ["No transactions found in this OFX file."] };
  }
  const rows: ImportedRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const b of blocks) {
    const amtRaw = ofxField(b, "TRNAMT");
    const dt = ofxField(b, "DTPOSTED");
    const name = ofxField(b, "NAME") ?? ofxField(b, "MEMO");
    const fitid = ofxField(b, "FITID");
    const minor = amtRaw ? parseLooseMinor(amtRaw, currency) : null;
    const dm = dt?.match(/^(\d{4})(\d{2})(\d{2})/);
    if (minor === null || minor === 0 || !dm || !name) {
      skipped++;
      continue;
    }
    const at = atNoon({ y: +dm[1], mo: +dm[2], d: +dm[3] });
    let natural: string;
    if (fitid) {
      natural = `ofx:${fitid}`;
    } else {
      const base = `ofx:${dm[1]}-${dm[2]}-${dm[3]}:${minor}:${name.toUpperCase()}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      natural = n === 0 ? base : `${base}:${n}`;
    }
    rows.push({ at, amount: { minor, currency }, merchant: name.replace(/\s+/g, " ").trim(), natural });
  }
  if (skipped > 0) issues.push(`${skipped} entr${skipped === 1 ? "y was" : "ies were"} unreadable and left out.`);
  return { kind: "ofx", rows, issues };
}

// ---- entry point -----------------------------------------------------------------

export function parseImport(text: string, currency: string): ImportResult {
  if (/<OFX|<STMTTRN/i.test(text)) return parseOfx(text, currency);
  return parseCsvRows(text, currency);
}

/** The positive-means-out convention some card exports use, applied explicitly —
 * only ever by the user flipping the switch in the preview, never by a guess. */
export function flipSigns(rows: ImportedRow[]): ImportedRow[] {
  return rows.map((r) => ({ ...r, amount: { ...r.amount, minor: -r.amount.minor } }));
}
