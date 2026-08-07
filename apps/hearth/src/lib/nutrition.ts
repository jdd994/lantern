// nutrition.ts
// Pure, IO-free nutrition logic. No storage, no network, no React.
//
// A deliberate contrast with Ballast's money.ts: there, money is an exact integer
// count of minor units, because a cent of drift destroys trust. HERE, nutrients
// are floats — because the underlying data is *inherently* approximate (USDA
// values are population averages; a "medium banana" is an estimate; you ate
// "about a cup"). Pretending otherwise would be false precision. So we compute in
// floats and round only for display, and the app's copy never implies more
// accuracy than the data has.

// The nutrient set we track. More is not kinder — a wall of 40 micronutrients is
// its own kind of pressure. Kept small and useful; the schema is open to extend.
export type Nutrients = {
  kcal: number; // energy, kilocalories
  protein: number; // g
  carbs: number; // g
  sugars: number; // g (of which)
  fibre: number; // g
  fat: number; // g
  satFat: number; // g (of which)
  sodium: number; // mg
  potassium: number; // mg
  calcium: number; // mg
  iron: number; // mg
  vitC: number; // mg
  vitD: number; // µg
};

export const NUTRIENT_KEYS = [
  "kcal", "protein", "carbs", "sugars", "fibre", "fat", "satFat",
  "sodium", "potassium", "calcium", "iron", "vitC", "vitD",
] as const;

export type NutrientKey = keyof Nutrients;

// Display metadata: label, unit, decimals. Also which are the "headline" macros
// the dashboard leads with, vs. the micros shown on request.
export const NUTRIENT_META: Record<NutrientKey, { label: string; unit: string; dp: number; headline?: boolean }> = {
  kcal: { label: "Energy", unit: "kcal", dp: 0, headline: true },
  protein: { label: "Protein", unit: "g", dp: 1, headline: true },
  carbs: { label: "Carbs", unit: "g", dp: 1, headline: true },
  fat: { label: "Fat", unit: "g", dp: 1, headline: true },
  fibre: { label: "Fibre", unit: "g", dp: 1 },
  sugars: { label: "Sugars", unit: "g", dp: 1 },
  satFat: { label: "Saturated fat", unit: "g", dp: 1 },
  sodium: { label: "Sodium", unit: "mg", dp: 0 },
  potassium: { label: "Potassium", unit: "mg", dp: 0 },
  calcium: { label: "Calcium", unit: "mg", dp: 0 },
  iron: { label: "Iron", unit: "mg", dp: 1 },
  vitC: { label: "Vitamin C", unit: "mg", dp: 0 },
  vitD: { label: "Vitamin D", unit: "µg", dp: 1 },
};

export const ZERO: Nutrients = {
  kcal: 0, protein: 0, carbs: 0, sugars: 0, fibre: 0, fat: 0, satFat: 0,
  sodium: 0, potassium: 0, calcium: 0, iron: 0, vitC: 0, vitD: 0,
};

// Nutrients are stored per 100g (USDA's basis). Scale to an actual amount.
export function scale(per100g: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  const out = { ...ZERO };
  for (const k of NUTRIENT_KEYS) out[k] = per100g[k] * f;
  return out;
}

export function add(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...ZERO };
  for (const k of NUTRIENT_KEYS) out[k] = a[k] + b[k];
  return out;
}

export function sum(list: Nutrients[]): Nutrients {
  return list.reduce(add, { ...ZERO });
}

export function formatNutrient(key: NutrientKey, value: number): string {
  const m = NUTRIENT_META[key];
  const rounded = value.toFixed(m.dp);
  return `${Number(rounded).toLocaleString()} ${m.unit}`;
}

// ---- Foods -------------------------------------------------------------

export type Portion = { label: string; grams: number };
export type FoodSource = "seed" | "usda" | "off" | "custom";

export type Food = {
  id: string; // "seed:oats" | "usda:170285" | "off:<barcode>" | "custom:<uuid>"
  name: string;
  source: FoodSource;
  portions: Portion[]; // e.g. { label: "1 cup", grams: 240 }
  per100g: Nutrients;
};

// A logged item — the ENCRYPTED content of a food-log record. The nutrients are
// SNAPSHOTTED onto the log (not just a reference to the food), so refreshing the
// bundled database later never silently rewrites your history — the same
// "don't rewrite the past" honesty Ballast keeps.
export type FoodLogContent = {
  foodId: string;
  name: string; // denormalised, so a log is readable even if the food is gone
  amountGrams: number;
  per100g: Nutrients; // snapshot at log time
  note?: string;
};

export type FoodLog = FoodLogContent & { id: string; at: number };

export function loggedNutrients(log: FoodLogContent): Nutrients {
  return scale(log.per100g, log.amountGrams);
}

// Total for a set of logs within a time window [from, to).
export function windowTotal(logs: FoodLog[], from: number, to: number): Nutrients {
  return sum(logs.filter((l) => l.at >= from && l.at < to).map(loggedNutrients));
}

export function dayBounds(now: number): { from: number; to: number } {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { from, to: from + 24 * 60 * 60 * 1000 };
}

// ---- Recipes -----------------------------------------------------------
// A recipe is a named list of ingredients split into servings. Cooking one is a
// one-tap log of a serving — that's the whole reason recipes belong in this app.
//
// THE SHAPE IS DELIBERATE, and it changed on 2026-08-07. An ingredient's WORDS
// are required; its NUMBERS are optional. Most meals are thrown together — you
// know what went in, not what it weighed — and the old shape (every ingredient
// searched and weighed before you could save at all) meant those meals simply
// never got written down. A recipe nobody can be bothered to enter records
// nothing. So "olive oil, two onions, the rest of the chickpeas" is a complete,
// valid recipe the moment you type it, because it's what you'd tell a friend.
//
// Costing is curation you may do later, per ingredient, or never. What's costed
// contributes nutrients; what isn't contributes its words. Nothing is ever
// estimated on your behalf — an uncosted line is an honest blank, not a guess.
// See `recipeCoverage` for how that partiality is told truthfully.

// The numbers half, present only once you've resolved a line against a food and
// said how much. Snapshots per-100g (like a food log) so editing the food
// database later never silently rewrites a saved recipe.
export type IngredientCost = { foodId: string; name: string; grams: number; per100g: Nutrients };

export type RecipeIngredient = {
  // What you wrote, verbatim — "a big spoon of harissa". Always present. This is
  // the recipe; the cost below is bookkeeping laid on top of it.
  text: string;
  cost?: IngredientCost;
};

export type RecipeContent = {
  name: string;
  ingredients: RecipeIngredient[];
  servings: number; // how many servings the whole recipe makes (>= 1)
  // Free-form moods/cuisines you choose ("asian", "quick", "comfort"). Yours, not
  // an imposed taxonomy — the UI only ever offers back the tags you've used.
  tags?: string[];
  // How you made it, in your words. Optional and unparsed — Hearth never tries to
  // read your method, it just keeps it.
  method?: string;
  // A photo of the finished thing, as a data URL, downscaled on device before it
  // ever reaches storage (see lib/photo.ts). It is sealed with everything else in
  // this record, so it is E2E encrypted exactly like an ingredient is. NOTHING
  // looks at it: no recognition, no inference, no upload anywhere but your own
  // sync. That remains the FoodRecognizer seam's job, and that seam is still
  // empty. This is a photo you keep, not a photo you're read by.
  photo?: string;
};

export type Recipe = RecipeContent & { id: string };

// Legacy shape: ingredients used to be flat { foodId, name, grams, per100g }.
// Stored recipes are sealed blobs, so they're migrated on open (both for your own
// recipes and for ones shared into a kitchen), not by a database version bump.
// An old ingredient was always costed, so it becomes text + cost with the food's
// name as the words — which is exactly what it displayed before.
type LegacyIngredient = IngredientCost & { text?: undefined };

export function normalizeIngredient(i: RecipeIngredient | LegacyIngredient): RecipeIngredient {
  if (typeof i?.text === "string") return i as RecipeIngredient;
  const old = i as LegacyIngredient;
  return { text: old.name ?? "", cost: { foodId: old.foodId, name: old.name, grams: old.grams, per100g: old.per100g } };
}

export function normalizeRecipeContent<T extends RecipeContent>(c: T): T {
  return { ...c, ingredients: (c.ingredients ?? []).map(normalizeIngredient) };
}

// Only costed ingredients carry numbers. Everything below sums over these, and
// `recipeCoverage` is how the UI admits what's missing.
export const costedIngredients = (r: RecipeContent): IngredientCost[] =>
  r.ingredients.map((i) => i.cost).filter((c): c is IngredientCost => !!c);

// How much of this recipe has numbers behind it. The UI states this plainly
// wherever nutrients appear ("4 of 6 ingredients costed") rather than presenting
// a partial total as if it were the whole meal.
export function recipeCoverage(r: RecipeContent): { costed: number; total: number; complete: boolean } {
  const total = r.ingredients.length;
  const costed = costedIngredients(r).length;
  return { costed, total, complete: total > 0 && costed === total };
}

export function recipeTotalGrams(r: RecipeContent): number {
  return costedIngredients(r).reduce((g, i) => g + i.grams, 0);
}

export function recipeTotalNutrients(r: RecipeContent): Nutrients {
  return sum(costedIngredients(r).map((i) => scale(i.per100g, i.grams)));
}

export function recipeServingGrams(r: RecipeContent): number {
  const servings = Math.max(1, r.servings);
  return recipeTotalGrams(r) / servings;
}

export function recipePerServing(r: RecipeContent): Nutrients {
  const servings = Math.max(1, r.servings);
  const total = recipeTotalNutrients(r);
  const out = { ...ZERO };
  for (const k of NUTRIENT_KEYS) out[k] = total[k] / servings;
  return out;
}

// Cooking logs the COSTED part of a recipe, and with nothing costed there is no
// honest number to log at all. Writing zeros into the day would quietly say "you
// ate nothing", which is worse than not logging it — so the UI offers to cost it
// instead of pretending. This is the guard for that, not a judgement on the
// recipe: an uncosted recipe is a perfectly good recipe, it just isn't arithmetic.
export const recipeHasNumbers = (r: RecipeContent): boolean => recipeTotalGrams(r) > 0;

// Normalize the whole recipe to a per-100g vector, so a serving can be logged
// through the ordinary food-log path (loggedNutrients then reproduces the
// per-serving values exactly). Guards an empty recipe. Over a partly-costed
// recipe this describes the costed part only — check `recipeHasNumbers` before
// offering to cook, and tell the person what's counted (see `recipeCoverage`).
export function recipeAsFood(r: Recipe): Food {
  const grams = recipeTotalGrams(r);
  const total = recipeTotalNutrients(r);
  const per100g = { ...ZERO };
  if (grams > 0) for (const k of NUTRIENT_KEYS) per100g[k] = (total[k] / grams) * 100;
  return {
    id: r.id,
    name: r.name,
    source: "custom",
    portions: [{ label: "1 serving", grams: recipeServingGrams(r) }],
    per100g,
  };
}

// ---- Reading what you typed ---------------------------------------------
// You dump a meal in as prose; these split it up and find the food in it. Both
// are best-effort BY DESIGN and neither ever changes what you wrote: the lines
// stay editable and the original words are what's stored. A wrong guess here
// costs a tap to fix, never a silent rewrite of your recipe.

// One ingredient per line, and commas count as line breaks — people type both
// ways in the same breath ("olive oil, two onions\nthe rest of the chickpeas").
// Leading bullets and dashes from a paste are dropped. Numbers with commas
// ("1,5 dl") would split wrongly, so a comma between digits is left alone.
export function parseIngredientLines(text: string): string[] {
  return text
    .split(/\n|;|,(?![0-9])/) // a comma before a digit is "1,5 dl", not a break
    .map((l) => l.replace(/^\s*[-*\u2022\u00b7\u2013\u2014]\s*/, "").trim())
    .filter(Boolean);
}

// Words that describe HOW MUCH rather than WHAT. Stripping them turns "the rest
// of the chickpeas" into "chickpea", which is what both the pantry matcher and
// the food search actually want. Amounts are never interpreted as quantities —
// Hearth does not guess that "a big spoon" is 15g. It just stops them drowning
// out the noun.
const AMOUNT_WORDS = new Set([
  "a", "an", "the", "of", "some", "few", "couple", "several", "bit", "lot", "lots",
  "rest", "most", "half", "quarter", "third", "whole", "extra", "more", "less",
  "big", "large", "small", "medium", "little", "generous", "heaped", "level",
  "spoon", "spoons", "spoonful", "spoonfuls", "tbsp", "tsp", "tablespoon", "tablespoons",
  "teaspoon", "teaspoons", "cup", "cups", "handful", "handfuls", "pinch", "pinches",
  "dash", "splash", "drizzle", "glug", "knob", "clove", "cloves", "slice", "slices",
  "tin", "tins", "can", "cans", "jar", "jars", "packet", "packets", "pack", "bag", "bags",
  "g", "kg", "mg", "ml", "l", "dl", "cl", "oz", "lb", "lbs", "gram", "grams", "kilo", "kilos",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "dozen",
  "and", "or", "to", "for", "with", "into", "about", "roughly", "maybe", "plus",
  // Pointing words — "most of THAT jar of chilli oil" is still just chilli oil.
  "that", "this", "those", "these", "my", "your", "our", "their", "it", "its", "them",
]);

// The food words in a loose phrase, lowercased and de-pluralised. Falls back to
// the raw words when a line is nothing but amounts, so an odd line still matches
// itself rather than becoming invisible.
export function ingredientKeywords(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // A bare number, or a number welded to its unit ("200g", "1kg", "2tbsp").
    .filter((w) => !/^\d+(\.\d+)?[a-z]*$/.test(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  const meaningful = raw.filter((w) => !AMOUNT_WORDS.has(w));
  return meaningful.length ? meaningful : raw;
}

// What to put in the food-search box when you tap an uncosted line to cost it.
export const searchHintFor = (i: RecipeIngredient): string => ingredientKeywords(i.text).join(" ");

// ---- Goals -------------------------------------------------------------
// YOUR targets, never a norm imposed on you. A goal is a nutrient, a number, and
// a direction. Progress is reported calmly — "you're at 60 of your 100g protein"
// — never as pass/fail, never in red. See CLAUDE.md: awareness over judgement.

export type GoalDirection = "atLeast" | "atMost" | "target";

export type GoalContent = {
  name: string;
  nutrient: NutrientKey;
  amount: number;
  direction: GoalDirection;
};

export type Goal = GoalContent & { id: string };

export type GoalProgress = {
  current: number;
  amount: number;
  fraction: number; // 0..1, clamped — for a calm progress bar
  // A gentle, non-judgemental read. `tone` is "on"/"over"/"under"/"neutral" for
  // subtle colour only; it is NEVER rendered as "good/bad".
  tone: "on" | "over" | "under" | "neutral";
};

export function goalProgress(goal: Goal, today: Nutrients): GoalProgress {
  const current = today[goal.nutrient];
  const amount = goal.amount;
  const fraction = amount <= 0 ? 0 : Math.min(1, current / amount);

  let tone: GoalProgress["tone"] = "neutral";
  if (goal.direction === "atLeast") {
    tone = current >= amount ? "on" : "under";
  } else if (goal.direction === "atMost") {
    tone = current <= amount ? "on" : "over";
  } else {
    // "target": near it is fine; only well past reads as "over" (gently).
    tone = current >= amount ? "on" : "under";
  }
  return { current, amount, fraction, tone };
}
