import { afterEach, describe, expect, it, vi } from "vitest";
import { isBarcode, lookupBarcode } from "./off";

const mockOff = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response));

afterEach(() => vi.unstubAllGlobals());

describe("isBarcode", () => {
  it("accepts 8–14 digit codes and rejects anything else", () => {
    expect(isBarcode("5000159407236")).toBe(true);
    expect(isBarcode("  01234567  ")).toBe(true);
    expect(isBarcode("123")).toBe(false);
    expect(isBarcode("oats")).toBe(false);
  });
});

describe("lookupBarcode", () => {
  it("maps OFF's per-100g fields, converting units to ours", async () => {
    mockOff({
      status: 1,
      product: {
        product_name: "Porridge Oats",
        brands: "Acme, Other",
        nutriments: {
          "energy-kcal_100g": 379,
          proteins_100g: 11.2,
          carbohydrates_100g: 60,
          sugars_100g: 1.1,
          fiber_100g: 9,
          fat_100g: 8,
          "saturated-fat_100g": 1.4,
          sodium_100g: 0.01, // g → 10 mg
          iron_100g: 0.004, // g → 4 mg
          "vitamin-d_100g": 0.000005, // g → 5 µg
        },
      },
    });
    const food = (await lookupBarcode("5000159407236"))!;
    expect(food.id).toBe("off:5000159407236");
    expect(food.source).toBe("off");
    expect(food.name).toBe("Porridge Oats · Acme"); // first brand only
    expect(food.per100g.kcal).toBeCloseTo(379);
    expect(food.per100g.protein).toBeCloseTo(11.2);
    expect(food.per100g.sodium).toBeCloseTo(10);
    expect(food.per100g.iron).toBeCloseTo(4);
    expect(food.per100g.vitD).toBeCloseTo(5);
  });

  it("falls back to kJ when kcal is absent", async () => {
    mockOff({ status: 1, product: { product_name: "X", nutriments: { energy_100g: 418.4 } } });
    expect((await lookupBarcode("01234567"))!.per100g.kcal).toBeCloseTo(100);
  });

  it("offers a serving portion when OFF knows one, always keeping 100 g", async () => {
    mockOff({
      status: 1,
      product: { product_name: "X", serving_size: "40 g", serving_quantity: 40, nutriments: {} },
    });
    const food = (await lookupBarcode("01234567"))!;
    expect(food.portions[0]).toEqual({ label: "1 serving (40 g)", grams: 40 });
    expect(food.portions.some((p) => p.grams === 100)).toBe(true);
  });

  it("returns null for an unknown product rather than throwing", async () => {
    mockOff({ status: 0 });
    expect(await lookupBarcode("01234567")).toBeNull();
  });

  it("ignores junk values instead of poisoning the numbers", async () => {
    mockOff({ status: 1, product: { product_name: "X", nutriments: { proteins_100g: "not a number", fat_100g: -5 } } });
    const food = (await lookupBarcode("01234567"))!;
    expect(food.per100g.protein).toBe(0);
    expect(food.per100g.fat).toBe(0);
  });

  it("never calls the network for a non-barcode", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await lookupBarcode("oats")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
