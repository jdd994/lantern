// mealplan.ts — planning meals with the people you feed.
//
// Pure and IO-free (unit-tested), like nutrition.ts. A plan entry says "on this
// day, at this meal, I mean to eat X" — where X is a saved recipe (n servings) or
// a plain food (grams). It is a PULL surface: you look at it when you want to. It
// never nags, never scores you, and a day you didn't cook is not a failure — it's
// just a day. (See the scheduling decision: pull, never push.)
//
// Snapshot discipline matches food logs: a planned FOOD carries its per-100g
// nutrients, so refreshing the food database later never rewrites your plan. A
// planned RECIPE points at the recipe, so editing the recipe updates the plan —
// which is what you'd want, and it degrades gracefully to just a name if the
// recipe is gone.
import {
  recipeAsFood,
  scale,
  sum,
  ZERO,
  type Nutrients,
  type Recipe,
} from "./nutrition";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// The ENCRYPTED content of a plan record.
export type PlanContent =
  | {
      slot: MealSlot;
      kind: "recipe";
      recipeId: string;
      name: string; // denormalised so it still reads if the recipe is deleted
      servings: number;
      cookedAt?: number; // set when you cook it (which also logs it)
    }
  | {
      slot: MealSlot;
      kind: "food";
      foodId: string;
      name: string;
      grams: number;
      per100g: Nutrients; // snapshot at plan time
      cookedAt?: number;
    };

// `at` is the planned day (local midnight), plaintext like a food log's `at`, so a
// week can be windowed without decrypting everything.
export type PlanEntry = PlanContent & { id: string; at: number };

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// The Monday on or before `ms` (weeks start Monday; meals follow the week you live).
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const shift = (d.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  d.setDate(d.getDate() - shift);
  return d.getTime();
}

// The seven day-starts of the week containing `ms`.
export function weekDays(ms: number): number[] {
  const start = startOfWeek(ms);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.getTime();
  });
}

const slotRank = (s: MealSlot) => MEAL_SLOTS.indexOf(s);

// A day's entries, in the order you'd eat them.
export function entriesForDay(entries: PlanEntry[], dayStart: number): PlanEntry[] {
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return entries
    .filter((e) => e.at >= dayStart && e.at < dayEnd)
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
}

// What a planned entry would contribute. null when a planned recipe has since been
// deleted — we show its name, but we won't invent numbers for it.
export function plannedNutrients(entry: PlanContent, recipes: Recipe[]): Nutrients | null {
  if (entry.kind === "food") return scale(entry.per100g, entry.grams);
  const recipe = recipes.find((r) => r.id === entry.recipeId);
  if (!recipe) return null;
  const asFood = recipeAsFood(recipe);
  return scale(asFood.per100g, asFood.portions[0].grams * entry.servings);
}

// A day's planned total — information, never a verdict.
export function plannedDayTotal(entries: PlanEntry[], dayStart: number, recipes: Recipe[]): Nutrients {
  const list = entriesForDay(entries, dayStart)
    .map((e) => plannedNutrients(e, recipes))
    .filter((n): n is Nutrients => n !== null);
  return list.length ? sum(list) : { ...ZERO };
}
