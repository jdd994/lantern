import { describe, expect, it } from "vitest";
import {
  entriesForDay,
  plannedDayTotal,
  plannedNutrients,
  startOfDay,
  startOfWeek,
  weekDays,
  type PlanEntry,
} from "./mealplan";
import { ZERO, type Recipe } from "./nutrition";

const per100g = { ...ZERO, kcal: 100, protein: 10 };

const foodEntry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: "f1",
  at: startOfDay(new Date(2021, 5, 1, 9, 0).getTime()),
  slot: "lunch",
  kind: "food",
  foodId: "x",
  name: "Oats",
  grams: 200,
  per100g,
  ...(over as object),
}) as PlanEntry;

const recipe: Recipe = {
  id: "r1",
  name: "Stew",
  servings: 2,
  ingredients: [{ foodId: "a", name: "Beans", grams: 400, per100g }],
};

describe("weeks and days", () => {
  it("starts weeks on Monday", () => {
    // 2021-06-01 is a Tuesday → the week starts Mon 2021-05-31.
    const monday = startOfWeek(new Date(2021, 5, 1, 15, 0).getTime());
    expect(new Date(monday).getDay()).toBe(1);
    expect(new Date(monday).getDate()).toBe(31);
  });

  it("gives seven consecutive day-starts", () => {
    const days = weekDays(new Date(2021, 5, 1).getTime());
    expect(days).toHaveLength(7);
    expect(new Date(days[0]).getDay()).toBe(1); // Mon
    expect(new Date(days[6]).getDay()).toBe(0); // Sun
    for (const d of days) expect(d).toBe(startOfDay(d));
  });
});

describe("entriesForDay", () => {
  it("keeps only that day's entries, in meal order", () => {
    const day = startOfDay(new Date(2021, 5, 1).getTime());
    const other = startOfDay(new Date(2021, 5, 2).getTime());
    const list: PlanEntry[] = [
      foodEntry({ id: "dinner", slot: "dinner" }),
      foodEntry({ id: "breakfast", slot: "breakfast" }),
      foodEntry({ id: "tomorrow", at: other }),
    ];
    expect(entriesForDay(list, day).map((e) => e.id)).toEqual(["breakfast", "dinner"]);
  });
});

describe("plannedNutrients", () => {
  it("scales a planned food by its grams", () => {
    expect(plannedNutrients(foodEntry(), [])!.kcal).toBeCloseTo(200); // 200g at 100kcal/100g
  });

  it("scales a planned recipe by servings", () => {
    const one = plannedNutrients(
      { slot: "dinner", kind: "recipe", recipeId: "r1", name: "Stew", servings: 1 },
      [recipe]
    )!;
    const two = plannedNutrients(
      { slot: "dinner", kind: "recipe", recipeId: "r1", name: "Stew", servings: 2 },
      [recipe]
    )!;
    expect(one.kcal).toBeCloseTo(200); // 400g of beans / 2 servings = 200g a serving
    expect(two.kcal).toBeCloseTo(400);
  });

  it("returns null for a deleted recipe rather than inventing numbers", () => {
    expect(
      plannedNutrients({ slot: "dinner", kind: "recipe", recipeId: "gone", name: "Stew", servings: 1 }, [])
    ).toBeNull();
  });
});

describe("plannedDayTotal", () => {
  it("sums the day, skipping entries it can't resolve", () => {
    const day = startOfDay(new Date(2021, 5, 1).getTime());
    const list: PlanEntry[] = [
      foodEntry({ id: "a" }),
      foodEntry({ id: "b", slot: "dinner" }),
      { id: "c", at: day, slot: "snack", kind: "recipe", recipeId: "gone", name: "Stew", servings: 1 },
    ];
    expect(plannedDayTotal(list, day, []).kcal).toBeCloseTo(400);
  });

  it("is zero for an empty day — not an error, just a day", () => {
    expect(plannedDayTotal([], startOfDay(Date.now()), []).kcal).toBe(0);
  });
});
