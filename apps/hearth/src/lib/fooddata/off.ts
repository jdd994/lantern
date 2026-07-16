// fooddata/off.ts
// Tier 1 — Open Food Facts barcode lookup, for packaged goods the bundled USDA
// data can't cover. See FOOD_DATA.md.
//
// THE HONEST LEAK, stated plainly because it's the whole point of the ladder:
// this is the app's only outbound food request. It tells Open Food Facts that
// *some barcode was looked up*, plus your IP. It never learns who you are, what
// else you ate, or anything about your day — the request carries no account, no
// cookie, and no history. Everything it returns is then stored encrypted like any
// other food. That's tier 1: a provider learns a barcode, and nothing else.
//
// Data is ODbL (attribute + share-alike) — compatible with our AGPL app; we
// attribute it in the UI where a result is shown.
import { ZERO, type Food, type Nutrients } from "../nutrition";

const API = "https://world.openfoodfacts.org/api/v2/product";

// Only the fields we actually map — asking for less is both faster and less rude.
const FIELDS = [
  "product_name", "brands", "quantity", "serving_size", "serving_quantity", "nutriments",
].join(",");

type OffNutriments = Record<string, number | string | undefined>;

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// OFF reports per-100g fields with a _100g suffix, in grams (salt/sodium in g),
// and energy in kcal or kJ depending on the product. Map to our per-100g shape.
function toNutrients(n: OffNutriments): Nutrients {
  const kcal = n["energy-kcal_100g"] !== undefined
    ? num(n["energy-kcal_100g"])
    : num(n["energy_100g"]) / 4.184; // kJ → kcal when that's all they have
  return {
    ...ZERO,
    kcal,
    protein: num(n["proteins_100g"]),
    carbs: num(n["carbohydrates_100g"]),
    sugars: num(n["sugars_100g"]),
    fibre: num(n["fiber_100g"]),
    fat: num(n["fat_100g"]),
    satFat: num(n["saturated-fat_100g"]),
    sodium: num(n["sodium_100g"]) * 1000, // g → mg
    potassium: num(n["potassium_100g"]) * 1000,
    calcium: num(n["calcium_100g"]) * 1000,
    iron: num(n["iron_100g"]) * 1000,
    vitC: num(n["vitamin-c_100g"]) * 1000,
    vitD: num(n["vitamin-d_100g"]) * 1_000_000, // g → µg
  };
}

export const isBarcode = (s: string): boolean => /^\d{8,14}$/.test(s.trim());

/**
 * Look up one barcode. Returns null when the product isn't in Open Food Facts
 * (very common for local products) — the caller should let the person enter it
 * by hand rather than treat that as an error.
 */
export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<Food | null> {
  const barcode = code.trim();
  if (!isBarcode(barcode)) return null;
  const res = await fetch(`${API}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, { signal });
  if (!res.ok) throw new Error("Couldn't reach Open Food Facts just now.");
  const data = await res.json();
  if (data?.status !== 1 || !data?.product) return null;

  const p = data.product;
  const name = [p.product_name, p.brands?.split(",")[0]?.trim()].filter(Boolean).join(" · ")
    || `Barcode ${barcode}`;

  // A serving portion when OFF knows one; 100 g is always offered.
  const portions = [{ label: "100 g", grams: 100 }];
  const servingG = num(p.serving_quantity);
  if (servingG > 0) {
    portions.unshift({ label: p.serving_size ? `1 serving (${p.serving_size})` : "1 serving", grams: servingG });
  }

  return { id: `off:${barcode}`, name, source: "off", portions, per100g: toNutrients(p.nutriments ?? {}) };
}
