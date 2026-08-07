import { describe, it, expect } from "vitest";
import { money } from "./money";
import { normalizeMerchant, suggestCategory, remember, type MerchantMemory } from "./categorize";
import {
  byCategory,
  spentIn,
  earnedIn,
  monthWindow,
  notable,
  recurring,
  itemPatterns,
  hsaAmount,
  hsaBanked,
  type Transaction,
} from "./spend";

const USD = "USD";
let seq = 0;
function tx(at: string, amount: number, merchant: string, category: Transaction["category"]): Transaction {
  return {
    id: `t${seq++}`,
    at: new Date(at).getTime(),
    amount: money(amount, USD),
    merchant,
    category,
  };
}

describe("normalizeMerchant", () => {
  it("strips the noise card descriptors are full of", () => {
    expect(normalizeMerchant("TRADER JOE'S #412")).toBe("TRADER JOE'S");
    expect(normalizeMerchant("SQ *BLUE BOTTLE 4412")).toBe("BLUE BOTTLE");
    expect(normalizeMerchant("TST* PIZZERIA 03/14")).toBe("PIZZERIA");
    expect(normalizeMerchant("PAYPAL SPOTIFY")).toBe("SPOTIFY");
  });

  it("collapses the same shop written two ways to one key", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE 4412")).toBe(normalizeMerchant("SQ *BLUE BOTTLE #9"));
  });
});

describe("the categoriser learns from you", () => {
  it("knows nothing about an unknown merchant, and says so", () => {
    expect(suggestCategory("KWIK-E-MART", {})).toBeNull();
  });

  it("remembers what you taught it", () => {
    let memory: MerchantMemory = {};
    memory = remember("KWIK-E-MART #7", "groceries", memory);
    const s = suggestCategory("KWIK-E-MART #12", memory);
    expect(s).toEqual({ category: "groceries", from: "learned" });
  });

  it("matches a merchant it has seen inside a longer descriptor", () => {
    const memory = remember("BLUE BOTTLE", "dining", {});
    expect(suggestCategory("BLUE BOTTLE COFFEE OAKLAND", memory)?.category).toBe("dining");
  });

  it("offers a built-in hint, but marks it as a guess", () => {
    expect(suggestCategory("NETFLIX.COM", {})).toEqual({ category: "subscriptions", from: "hint" });
  });

  it("lets your correction beat the built-in hint, permanently", () => {
    // You file Netflix under entertainment, not subscriptions. You are right,
    // because it's your money.
    const memory = remember("NETFLIX.COM", "entertainment", {});
    expect(suggestCategory("NETFLIX.COM", memory)).toEqual({
      category: "entertainment",
      from: "learned",
    });
  });
});

describe("spend totals", () => {
  const txns: Transaction[] = [
    tx("2026-07-02", -4500, "TRADER JOES", "groceries"),
    tx("2026-07-05", -1200, "BLUE BOTTLE", "dining"),
    tx("2026-07-09", -8000, "TRADER JOES", "groceries"),
    tx("2026-07-10", 500000, "ACME PAYROLL", "income"),
    // Moving money to your own savings is NOT spending.
    tx("2026-07-11", -200000, "TRANSFER TO SAVINGS", "transfer"),
    // Last month, outside the window.
    tx("2026-06-15", -9900, "TRADER JOES", "groceries"),
  ];
  const w = monthWindow(new Date("2026-07-13").getTime());

  it("counts money out, in spending categories only", () => {
    // 4500 + 1200 + 8000 = 13700. The transfer and the salary are excluded.
    expect(spentIn(txns, w.from, w.to, USD).minor).toBe(13700);
  });

  it("does not count a transfer as spending", () => {
    const cats = byCategory(txns, w.from, w.to, USD);
    expect(cats.find((c) => c.category === "transfer")).toBeUndefined();
  });

  it("counts income separately", () => {
    expect(earnedIn(txns, w.from, w.to, USD).minor).toBe(500000);
  });

  it("breaks spend down by category, biggest first", () => {
    const cats = byCategory(txns, w.from, w.to, USD);
    expect(cats[0].category).toBe("groceries");
    expect(cats[0].total.minor).toBe(12500);
    expect(cats[0].count).toBe(2);
    expect(cats[0].share).toBeCloseTo(12500 / 13700, 4);
    expect(cats[1].category).toBe("dining");
  });

  it("excludes last month's spend from this month's window", () => {
    expect(byCategory(txns, w.from, w.to, USD).find((c) => c.category === "groceries")!.total.minor).toBe(
      12500
    );
  });
});

describe("notable — unusual for YOU, in both directions", () => {
  const now = new Date("2026-07-13").getTime();

  it("says nothing without enough history to have a 'usual'", () => {
    const txns = [tx("2026-07-02", -50000, "X", "dining")];
    expect(notable(txns, now, USD)).toEqual([]);
  });

  it("notices a category well above your own normal", () => {
    const txns: Transaction[] = [
      tx("2026-04-05", -10000, "X", "dining"),
      tx("2026-05-05", -10000, "X", "dining"),
      tx("2026-06-05", -10000, "X", "dining"),
      tx("2026-07-05", -40000, "X", "dining"), // 4x
    ];
    const n = notable(txns, now, USD);
    expect(n).toHaveLength(1);
    expect(n[0].category).toBe("dining");
    expect(n[0].ratio).toBeCloseTo(4, 1);
    expect(n[0].usual.minor).toBe(10000);
  });

  it("also notices when you spent markedly LESS — that fact belongs to you too", () => {
    const txns: Transaction[] = [
      tx("2026-05-05", -40000, "X", "dining"),
      tx("2026-06-05", -40000, "X", "dining"),
      tx("2026-07-05", -10000, "X", "dining"), // a quarter
    ];
    const n = notable(txns, now, USD);
    expect(n).toHaveLength(1);
    expect(n[0].ratio).toBeCloseTo(0.25, 2);
  });

  it("never produces NaN when a prior month had none of that category", () => {
    const txns: Transaction[] = [
      tx("2026-05-05", -10000, "X", "dining"),
      tx("2026-06-05", -10000, "X", "dining"),
      tx("2026-06-06", -10000, "Y", "travel"), // travel exists in June only
      tx("2026-07-05", -50000, "Y", "travel"),
    ];
    for (const n of notable(txns, now, USD)) {
      expect(Number.isFinite(n.ratio)).toBe(true);
      expect(Number.isFinite(n.usual.minor)).toBe(true);
    }
  });
});

describe("recurring — the subscriptions you forgot about", () => {
  const now = new Date("2026-07-13").getTime();

  it("finds a steady monthly charge", () => {
    const txns: Transaction[] = [
      tx("2026-05-03", -1599, "NETFLIX", "subscriptions"),
      tx("2026-06-03", -1599, "NETFLIX", "subscriptions"),
      tx("2026-07-03", -1599, "NETFLIX", "subscriptions"),
    ];
    const r = recurring(txns, now, USD);
    expect(r).toHaveLength(1);
    expect(r[0].merchant).toBe("NETFLIX");
    expect(r[0].amount.minor).toBe(1599);
    expect(r[0].months).toBe(3);
  });

  it("does not mistake a coffee habit for a subscription", () => {
    // Same merchant every month, wildly different amounts — that's a habit, not
    // a recurring charge, and calling it one would be noise.
    const txns: Transaction[] = [
      tx("2026-05-03", -450, "BLUE BOTTLE", "dining"),
      tx("2026-06-03", -1800, "BLUE BOTTLE", "dining"),
      tx("2026-07-03", -900, "BLUE BOTTLE", "dining"),
    ];
    expect(recurring(txns, now, USD)).toEqual([]);
  });

  it("ignores a one-off", () => {
    const txns = [tx("2026-07-03", -1599, "NETFLIX", "subscriptions")];
    expect(recurring(txns, now, USD)).toEqual([]);
  });
});

describe("attribute: items split a transaction across categories", () => {
  const now = new Date("2026-07-15").getTime();
  const target: Transaction = {
    ...tx("2026-07-10", -8000, "TARGET", "shopping"),
    items: [
      { label: "PRODUCE", amount: money(3000, USD), category: "groceries" },
      { label: "MILK", amount: money(2000, USD), category: "groceries" },
      { label: "T-SHIRT", amount: money(2500, USD) }, // no category = the headline's
    ],
  };

  it("sends each item's money to its own category, remainder to the headline", () => {
    const r = byCategory([target], monthWindow(now).from, monthWindow(now).to, USD);
    // 3000+2000 groceries; 2500 headline + 500 remainder (tax) = 3000 shopping.
    expect(r).toEqual([
      { category: "groceries", total: { minor: 5000, currency: USD }, count: 1, share: 5000 / 8000 },
      { category: "shopping", total: { minor: 3000, currency: USD }, count: 1, share: 3000 / 8000 },
    ]);
  });

  it("leaves a transaction whose items all agree with it untouched", () => {
    const plain: Transaction = {
      ...tx("2026-07-10", -1526, "TRADER JOE'S", "groceries"),
      items: [
        { label: "BANANAS", amount: money(149, USD) },
        { label: "MILK", amount: money(429, USD) },
      ],
    };
    const r = byCategory([plain], monthWindow(now).from, monthWindow(now).to, USD);
    expect(r).toEqual([
      { category: "groceries", total: { minor: 1526, currency: USD }, count: 1, share: 1 },
    ]);
  });

  it("falls back to the headline when items claim more than the whole transaction", () => {
    // An inconsistent breakdown gets ignored, not rescaled. We don't make data up.
    const broken: Transaction = {
      ...tx("2026-07-10", -1000, "SHOP", "shopping"),
      items: [{ label: "GLITCH", amount: money(99900, USD), category: "groceries" }],
    };
    const r = byCategory([broken], monthWindow(now).from, monthWindow(now).to, USD);
    expect(r).toEqual([
      { category: "shopping", total: { minor: 1000, currency: USD }, count: 1, share: 1 },
    ]);
  });
});

describe("itemPatterns: what you're buying, noticed calmly", () => {
  const now = new Date("2026-07-15").getTime();
  const w = monthWindow(now);
  const withItems = (at: string, merchant: string, items: Array<[string, number]>): Transaction => ({
    ...tx(at, -items.reduce((a, [, m]) => a + m, 0), merchant, "groceries"),
    items: items.map(([label, minor]) => ({ label, amount: money(minor, USD) })),
  });

  it("groups the same item across receipts, sizes and casing ignored", () => {
    const txns = [
      withItems("2026-07-02", "STORE", [["GREEK YOGURT 32OZ", 689], ["CHIPS", 399]]),
      withItems("2026-07-09", "STORE", [["Greek Yogurt", 689]]),
      withItems("2026-07-13", "OTHER STORE", [["CHIPS", 449], ["BREAD", 350]]),
      withItems("2026-07-14", "STORE", [["CHIPS", 399]]),
    ];
    const p = itemPatterns(txns, w.from, w.to, USD);
    expect(p[0]).toEqual({ label: "CHIPS", count: 3, total: { minor: 1247, currency: USD } });
    expect(p[1]).toEqual({ label: "GREEK YOGURT 32OZ", count: 2, total: { minor: 1378, currency: USD } });
    // BREAD appeared once — a one-off is not a pattern.
    expect(p).toHaveLength(2);
  });

  it("says nothing when nothing repeats", () => {
    const txns = [withItems("2026-07-02", "STORE", [["BREAD", 350]])];
    expect(itemPatterns(txns, w.from, w.to, USD)).toEqual([]);
  });
});

describe("HSA banking: the shoebox strategy", () => {
  it("banks an un-itemized transaction flagged eligible, whole amount", () => {
    const t = { ...tx("2026-07-02", -3000, "PHARMACY", "health"), hsaEligible: true };
    expect(hsaAmount(t)).toBe(3000);
  });

  it("banks nothing for an un-itemized transaction that isn't flagged", () => {
    const t = tx("2026-07-02", -3000, "PHARMACY", "health");
    expect(hsaAmount(t)).toBe(0);
  });

  it("on an itemized receipt, only the flagged items count", () => {
    // A Target run: bandages are HSA-eligible, chips aren't. The transaction-
    // level flag is irrelevant once any item overrides it.
    const t: Transaction = {
      ...tx("2026-07-02", -2000, "TARGET", "shopping"),
      items: [
        { label: "Bandages", amount: money(800, USD), hsaEligible: true },
        { label: "Chips", amount: money(1200, USD), hsaEligible: false },
      ],
    };
    expect(hsaAmount(t)).toBe(800);
  });

  it("an itemized receipt with no items overriding falls back to the transaction flag", () => {
    const t: Transaction = {
      ...tx("2026-07-02", -2000, "TARGET", "shopping"),
      hsaEligible: true,
      items: [
        { label: "Bandages", amount: money(800, USD) },
        { label: "Chips", amount: money(1200, USD) },
      ],
    };
    expect(hsaAmount(t)).toBe(2000);
  });

  it("sums banked and unreimbursed totals across the whole ledger, not a window", () => {
    const eligible = { ...tx("2020-01-15", -3000, "PHARMACY", "health"), hsaEligible: true };
    const reimbursed = {
      ...tx("2026-07-02", -5000, "DENTIST", "health"),
      hsaEligible: true,
      reimbursedAt: new Date("2026-07-10").getTime(),
    };
    const notEligible = tx("2026-07-05", -1200, "COFFEE", "dining");
    const b = hsaBanked([eligible, reimbursed, notEligible], USD);
    expect(b.total).toEqual({ minor: 8000, currency: USD });
    expect(b.unreimbursed).toEqual({ minor: 3000, currency: USD });
    expect(b.items).toHaveLength(2);
  });

  it("income and transfers never bank, even if flagged", () => {
    const income = { ...tx("2026-07-02", 3000, "REFUND", "income"), hsaEligible: true };
    expect(hsaBanked([income], USD).total).toEqual({ minor: 0, currency: USD });
  });
});
