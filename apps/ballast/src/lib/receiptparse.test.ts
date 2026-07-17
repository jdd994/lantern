import { describe, it, expect } from "vitest";
import { parseReceiptText } from "./receiptparse";

const USD = "USD";
// A fixed "now" so date sanity checks are deterministic: 2026-07-16 noon local.
const NOW = new Date(2026, 6, 16, 12).getTime();

const parse = (text: string) => parseReceiptText(text, USD, NOW);

// Fixtures are shaped like real OCR output: single column, dropped characters,
// register arithmetic mixed in with the items.

const GROCERY = `
TRADER JOE'S
123 SHORELINE BLVD
MOUNTAIN VIEW CA 94040
07/12/2026 18:42

BANANAS ORGANIC 1.49
MILK WHOLE 64OZ 4.29
BREAD SOURDOUGH 3.99
EGGS LARGE DOZEN 5.49

SUBTOTAL 15.26
TAX 0.00
TOTAL 15.26
VISA 15.26
AUTH 048221
`;

describe("parseReceiptText: the total", () => {
  it("finds the TOTAL line and not the subtotal, tax, or card line", () => {
    const d = parse(GROCERY);
    expect(d.amount).toEqual({ minor: 1526, currency: USD });
  });

  it("prefers the labelled total even when a payment line is larger", () => {
    const d = parse(`
CORNER STORE
COFFEE 3.50
TOTAL 3.50
CASH 20.00
CHANGE 16.50
`);
    expect(d.amount).toEqual({ minor: 350, currency: USD });
  });

  it("falls back to the largest non-payment amount when TOTAL never got read", () => {
    // Thermal print fades exactly where you don't want it to.
    const d = parse(`
CORNER STORE
COFFEE 3.50
MUFFIN 4.25
T0T~L 7.75
CASH 20.00
`);
    // "T0T~L" doesn't match, but 7.75 is the largest amount outside payment lines.
    expect(d.amount).toEqual({ minor: 775, currency: USD });
  });

  it("reads comma-decimal amounts", () => {
    const d = parseReceiptText(
      `
BÄCKEREI
BREZEL 1,20
KAFFEE 2,80
TOTAL 4,00
`,
      "EUR",
      NOW
    );
    expect(d.amount).toEqual({ minor: 400, currency: "EUR" });
  });

  it("reads thousands separators", () => {
    const d = parse(`
FURNITURE BARN
SOFA 1,299.00
TOTAL 1,299.00
`);
    expect(d.amount).toEqual({ minor: 129900, currency: USD });
  });

  it("returns nothing rather than guessing when there are no amounts", () => {
    expect(parse("THANK YOU\nCOME AGAIN")).toEqual({});
  });

  it("reads TOTAL the way thermal print actually delivers it", () => {
    // O→0 and L→I are the classic confusions; the anchor word must survive them.
    expect(parse("SHOP\nTEA 2.00\nT0TAL 2.15").amount).toEqual({ minor: 215, currency: USD });
    expect(parse("SHOP\nTEA 2.00\nTOTAI 2.15").amount).toEqual({ minor: 215, currency: USD });
  });

  it("takes the figure below a lone TOTAL label — split lines happen", () => {
    const d = parse("SHOP\nTEA 2.00\nSCONE 3.00\nTOTAL\n5.40");
    expect(d.amount).toEqual({ minor: 540, currency: USD });
  });

  it("refuses to crown an item as the total when the real one went unread", () => {
    // The exact failure from the field: no readable TOTAL line, several items —
    // the old fallback picked the priciest item and presented it as the total.
    // Confidently wrong is worse than blank: claim nothing, keep the items.
    const d = parse("SHOP\nBREAD 5.00\nMILK 4.00\nEGGS 3.00");
    expect(d.amount).toBeUndefined();
    expect(d.items).toHaveLength(3);
  });

  it("still claims a lone amount as the total — nothing contradicts it", () => {
    expect(parse("CAFE\nLATTE 4.50").amount).toEqual({ minor: 450, currency: USD });
  });
});

describe("parseReceiptText: the merchant", () => {
  it("takes the store name from the top, skipping addresses and boilerplate", () => {
    expect(parse(GROCERY).merchant).toBe("TRADER JOE'S");
  });

  it("skips 'WELCOME TO' noise", () => {
    const d = parse(`
WELCOME TO
COSTCO WHOLESALE
SOMETHING 9.99
TOTAL 9.99
`);
    expect(d.merchant).toBe("COSTCO WHOLESALE");
  });
});

describe("parseReceiptText: the date", () => {
  it("reads a US-style date to local noon", () => {
    const d = parse(GROCERY);
    expect(d.at).toBe(new Date(2026, 6, 12, 12).getTime());
  });

  it("reads an unambiguous day-first date", () => {
    const d = parse("SHOP\n25/06/2026\nTEA 2.00\nTOTAL 2.00");
    expect(d.at).toBe(new Date(2026, 5, 25, 12).getTime());
  });

  it("refuses a date from the future — that's a misread, not a fact", () => {
    const d = parse("SHOP\n12/01/2031\nTEA 2.00\nTOTAL 2.00");
    expect(d.at).toBeUndefined();
  });
});

describe("parseReceiptText: the items", () => {
  it("extracts item lines and leaves the register arithmetic out", () => {
    const d = parse(GROCERY);
    expect(d.items).toEqual([
      { label: "BANANAS ORGANIC", amount: { minor: 149, currency: USD } },
      { label: "MILK WHOLE 64OZ", amount: { minor: 429, currency: USD } },
      { label: "BREAD SOURDOUGH", amount: { minor: 399, currency: USD } },
      { label: "EGGS LARGE DOZEN", amount: { minor: 549, currency: USD } },
    ]);
  });

  it("drops an 'item' priced above the total — that's a misread phone number", () => {
    const d = parse(`
SHOP
CALL 555 09.99
TEA 2.00
TOTAL 2.00
`);
    expect(d.items).toEqual([{ label: "TEA", amount: { minor: 200, currency: USD } }]);
  });

  it("withholds items entirely when they visibly disagree with the total", () => {
    // A read where the "items" sum to far more than the total is a read that
    // went wrong; pre-filling a form with it would be worse than a blank form.
    const d = parse(`
SHOP
THING A 9.00
THING B 9.00
THING C 9.00
TOTAL 9.00
`);
    expect(d.items).toBeUndefined();
    expect(d.amount).toEqual({ minor: 900, currency: USD });
  });

  it("drops an echo of the total instead of nuking every real item", () => {
    // A payment line whose keyword got mangled ("Visa" -> "yj sa") repeats the
    // total to the cent. It must not appear as a purchase — and it must not
    // push the item sum past the sanity check and take the real items with it.
    const d = parse(`
SHOP
BREAD 5.00
MILK 4.00
EGGS 3.00
TOTAL 12.00
yj sa 12.00
`);
    expect(d.amount).toEqual({ minor: 1200, currency: USD });
    expect(d.items?.map((i) => i.label)).toEqual(["BREAD", "MILK", "EGGS"]);
  });

  it("never lists the card slip's AMOUNT line as a purchase", () => {
    // Costco taught us this one: the inverted-box TOTAL is unreadable, but
    // "AMOUNT: $33.88" on the card slip reads fine — it may lend us the total,
    // and it must never appear as something you bought.
    const d = parse("SHOP\nGREEK YOGURT 6.89\nAMOUNT: $33.88");
    expect(d.amount).toEqual({ minor: 3388, currency: USD });
    expect(d.items).toEqual([{ label: "GREEK YOGURT", amount: { minor: 689, currency: USD } }]);
  });

  it("keeps a single item whose price IS the total — that's just a latte", () => {
    const d = parse("CAFE\nLATTE 4.50\nTOTAL 4.50");
    expect(d.items).toEqual([{ label: "LATTE", amount: { minor: 450, currency: USD } }]);
  });

  it("strips leading quantity markers from labels", () => {
    const d = parse(`
CAFE
2 X LATTE 9.00
TOTAL 9.00
`);
    expect(d.items?.[0].label).toBe("LATTE");
  });
});

// THE FIELD FIXTURE — verbatim OCR output from a real phone photo of a real
// grocery receipt (crumpled thermal paper, speckled countertop background),
// the first one the feature met in the wild. It packs five hostile realities
// into one tape: background specks appended after amounts ("7.99 A   im"),
// two-letter tax flags ("BF"), a TOTAL line whose figure is followed by junk,
// a mangled payment line that repeats the total, and a per-pound rate line
// that must NOT become an item. If this test breaks, the parser got cleverer
// on paper and worse at the checkout counter.
const FIELD_RECEIPT = `
a      Lhe?7 1 SE
rR a RRR
PERE CoN i    i                             pat tace
Sy mA PR CNEL      TN            Ftamin Cottage
Cs ea       Natural Gragg by oe
CAE,           3061, ontane A
aE MERE           Helena, MI 59601
ER She          Phone; 4q6- 204-3939
ih    LR Date                    55
s         .           ;      me    Stor   Reg Emp  Txn        ATA
Sait GOT        07/12/26 10:55 my yog; 7 15930 49       pare
hs                        us        Te
ES          g 1489 HUMB Lip Balm 0.3 cz     7.99 A        im
bin               1X E2 JUS Cupcake Ca 4.4 c     3.59 BF      Pa
4073 Red Potatoes           3.32 BF      Eo
               1.45 1h      2.29 USD/ 1b          fees
:          SUBTOTAL [3]        USO 14.90     Re
-            A        1.986 0.000% -        0.60       EEE
:           ls       6.96 0.000% -       0.00         re
Loe               TOTAL                   ust        14.90          \\      i Sie
:    4        :  )      po!       14,90       we oe
PURCHASE $14.90                  /    hi
kkpEAR REAR 1060 Visa
CHIP CONTACT Egg
REF#; 060210 APProved
visa Credit
`;

describe("the field fixture: a real phone photo's OCR, end to end", () => {
  const d = parse(FIELD_RECEIPT);

  it("finds the true total despite junk trailing the figure", () => {
    expect(d.amount).toEqual({ minor: 1490, currency: USD });
  });

  it("reads all three items, two-letter tax flags and margin specks included", () => {
    expect(d.items?.map((i) => i.amount.minor)).toEqual([799, 359, 332]);
    expect(d.items?.[2].label).toBe("Red Potatoes");
  });

  it("keeps the rate line, the mangled Visa line, and PURCHASE out of the items", () => {
    const labels = (d.items ?? []).map((i) => i.label.toUpperCase());
    expect(labels.some((l) => l.includes("USD/"))).toBe(false);
    expect(labels.some((l) => l.includes("PURCHASE"))).toBe(false);
    expect(d.items?.some((i) => i.amount.minor === 1490)).toBe(false);
  });

  it("reads the date", () => {
    expect(d.at).toBe(new Date(2026, 6, 12, 12).getTime());
  });
});
