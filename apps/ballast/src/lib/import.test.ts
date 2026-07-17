import { describe, it, expect } from "vitest";
import { parseImport, parseLooseMinor, parseCsv, flipSigns } from "./import";

const USD = "USD";

describe("parseLooseMinor: every way a bank writes money", () => {
  it("reads the ordinary forms exactly", () => {
    expect(parseLooseMinor("-12.34", USD)).toBe(-1234);
    expect(parseLooseMinor("12.34", USD)).toBe(1234);
    expect(parseLooseMinor("$1,234.56", USD)).toBe(123456);
  });

  it("reads accountants' parentheses and trailing minus as negative", () => {
    expect(parseLooseMinor("(12.34)", USD)).toBe(-1234);
    expect(parseLooseMinor("12.34-", USD)).toBe(-1234);
  });

  it("reads European decimals", () => {
    expect(parseLooseMinor("12,34", "EUR")).toBe(1234);
    expect(parseLooseMinor("1.234,56", "EUR")).toBe(123456);
  });

  it("treats a lone ,000 group as thousands, not decimals", () => {
    expect(parseLooseMinor("1,234", USD)).toBe(123400);
  });

  it("refuses what it can't read", () => {
    expect(parseLooseMinor("", USD)).toBeNull();
    expect(parseLooseMinor("n/a", USD)).toBeNull();
    expect(parseLooseMinor("1.2.3", USD)).toBeNull();
  });
});

describe("parseCsv: the tokenizer", () => {
  it("handles quoted cells with commas and escaped quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseImport: CSV", () => {
  it("reads a typical signed export, header and all", () => {
    const { rows, issues } = parseImport(
      [
        "Date,Description,Amount,Balance",
        '2026-07-01,"TRADER JOE\'S #412",-45.67,1200.00',
        "2026-07-02,ACME PAYROLL,2500.00,3700.00",
      ].join("\n"),
      USD
    );
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        at: new Date(2026, 6, 1, 12).getTime(),
        amount: { minor: -4567, currency: USD },
        merchant: "TRADER JOE'S #412",
        natural: "csv:2026-07-01:-4567:TRADER JOE'S #412",
      },
      {
        at: new Date(2026, 6, 2, 12).getTime(),
        amount: { minor: 250000, currency: USD },
        merchant: "ACME PAYROLL",
        natural: "csv:2026-07-02:250000:ACME PAYROLL",
      },
    ]);
  });

  it("never mistakes the running balance for the amount", () => {
    const { rows } = parseImport(
      ["Date,Description,Amount,Balance", "2026-07-01,COFFEE,-4.50,995.50"].join("\n"),
      USD
    );
    expect(rows[0].amount.minor).toBe(-450);
  });

  it("reads debit/credit column pairs, debit meaning money out", () => {
    const { rows } = parseImport(
      [
        "Date,Details,Money Out,Money In",
        "2026-07-01,COFFEE,4.50,",
        "2026-07-02,REFUND,,10.00",
      ].join("\n"),
      USD
    );
    expect(rows.map((r) => r.amount.minor)).toEqual([-450, 1000]);
  });

  it("infers day-first dates from a single unambiguous row", () => {
    const { rows } = parseImport(
      ["Date,Description,Amount", "03/04/2026,ONE,-1.00", "25/06/2026,TWO,-2.00"].join("\n"),
      USD
    );
    // 25/06 can only be day-first, which settles 03/04 as April 3rd.
    expect(new Date(rows[0].at).getMonth()).toBe(3);
  });

  it("flags ambiguous slashed dates instead of deciding silently", () => {
    const { issues } = parseImport(
      ["Date,Description,Amount", "03/04/2026,ONE,-1.00"].join("\n"),
      USD
    );
    expect(issues.some((i) => /month\/day/.test(i))).toBe(true);
  });

  it("gives identical rows distinct natural keys, so both import once each", () => {
    const { rows } = parseImport(
      [
        "Date,Description,Amount",
        "2026-07-01,COFFEE,-4.50",
        "2026-07-01,COFFEE,-4.50",
      ].join("\n"),
      USD
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].natural).not.toBe(rows[1].natural);
    // ...and a re-parse mints the same two keys, in the same order.
    expect(rows[0].natural).toBe("csv:2026-07-01:-450:COFFEE");
    expect(rows[1].natural).toBe("csv:2026-07-01:-450:COFFEE:1");
  });

  it("says so when nothing carries a sign, and flipSigns applies the convention", () => {
    const r = parseImport(
      ["Date,Description,Amount", "2026-07-01,COFFEE,4.50"].join("\n"),
      USD
    );
    expect(r.issues.some((i) => /sign/.test(i))).toBe(true);
    expect(flipSigns(r.rows)[0].amount.minor).toBe(-450);
  });

  it("counts unreadable rows honestly", () => {
    const { rows, issues } = parseImport(
      ["Date,Description,Amount", "2026-07-01,COFFEE,-4.50", "not a date,???,x"].join("\n"),
      USD
    );
    expect(rows).toHaveLength(1);
    expect(issues.some((i) => /unreadable/.test(i))).toBe(true);
  });
});

describe("parseImport: OFX", () => {
  const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260701120000
<TRNAMT>-45.67
<FITID>202607010001
<NAME>TRADER JOE'S #412
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260702
<TRNAMT>2500.00
<FITID>202607020001
<NAME>ACME PAYROLL
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads SGML-style OFX and keys rows on the bank's own FITID", () => {
    const { kind, rows, issues } = parseImport(OFX, USD);
    expect(kind).toBe("ofx");
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        at: new Date(2026, 6, 1, 12).getTime(),
        amount: { minor: -4567, currency: USD },
        merchant: "TRADER JOE'S #412",
        natural: "ofx:202607010001",
      },
      {
        at: new Date(2026, 6, 2, 12).getTime(),
        amount: { minor: 250000, currency: USD },
        merchant: "ACME PAYROLL",
        natural: "ofx:202607020001",
      },
    ]);
  });
});

// GOLDEN VECTOR — pins IMPORT_ID_INFO ("ballast-import-id-v1"), the frozen
// parameter import record ids derive from (useLedger.importTransactions). If
// this fails, someone changed the derivation, and re-importing an old file
// would silently duplicate every row instead of skipping it. Don't "fix" the
// expectation.
import { importKeyRaw } from "@lantern/core/crypto";
import { stableId } from "@lantern/core/connect";

describe("import id derivation", () => {
  it("matches the frozen derivation", async () => {
    const key = await importKeyRaw(Array.from({ length: 32 }, (_, i) => i));
    expect(await stableId(key, "ballast-import-id-v1", "csv:2026-07-01:-450:COFFEE")).toBe(
      "131c360afdeee20ce8bd5aa91a574792"
    );
  });
});
