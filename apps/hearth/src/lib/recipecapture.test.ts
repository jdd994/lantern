// recipecapture.test.ts — the loose-recipe model.
//
// The thing under test is a promise, not just arithmetic: a meal you threw
// together can be written down in the words you'd actually use, and Hearth will
// never invent numbers to fill the gaps or quietly rewrite what you typed.

import { describe, it, expect } from "vitest";
import {
  parseIngredientLines, ingredientKeywords, searchHintFor,
  normalizeIngredient, normalizeRecipeContent, costedIngredients,
  recipeCoverage, recipeTotalGrams, recipeTotalNutrients, recipePerServing,
  recipeHasNumbers, recipeAsFood, loggedNutrients,
  type Nutrients, type RecipeContent, type RecipeIngredient,
} from "./nutrition";
import { matchRecipe, type PantryItem } from "./pantry";
import { fitWithin, dataUrlBytes, MAX_EDGE } from "./photo";

const nut = (over: Partial<Nutrients> = {}): Nutrients => ({
  kcal: 0, protein: 0, carbs: 0, sugars: 0, fibre: 0, fat: 0, satFat: 0,
  sodium: 0, potassium: 0, calcium: 0, iron: 0, vitC: 0, vitD: 0, ...over,
});

const loose = (text: string): RecipeIngredient => ({ text });
const costed = (text: string, name: string, grams: number, per100g: Nutrients): RecipeIngredient =>
  ({ text, cost: { foodId: `f-${name}`, name, grams, per100g } });

describe("parseIngredientLines", () => {
  it("splits the way people actually type — newlines and commas in one breath", () => {
    expect(parseIngredientLines("olive oil, two onions\nthe rest of the chickpeas")).toEqual([
      "olive oil", "two onions", "the rest of the chickpeas",
    ]);
  });

  it("drops bullets and dashes from a paste", () => {
    expect(parseIngredientLines("- rice\n* two eggs\n• chilli oil")).toEqual(["rice", "two eggs", "chilli oil"]);
  });

  it("keeps a decimal comma intact — '1,5 dl' is one ingredient, not two", () => {
    expect(parseIngredientLines("1,5 dl cream\nbutter")).toEqual(["1,5 dl cream", "butter"]);
  });

  it("ignores blank lines and stray separators", () => {
    expect(parseIngredientLines("\n\nrice,,\n  \n eggs ;")).toEqual(["rice", "eggs"]);
  });

  it("is empty for empty input, so an unfinished thought saves nothing", () => {
    expect(parseIngredientLines("   \n  ")).toEqual([]);
  });
});

describe("ingredientKeywords", () => {
  it("strips amounts down to the food", () => {
    expect(ingredientKeywords("the rest of the chickpeas")).toEqual(["chickpea"]);
    expect(ingredientKeywords("a big spoon of harissa")).toEqual(["harissa"]);
    expect(ingredientKeywords("two onions")).toEqual(["onion"]);
    expect(ingredientKeywords("200g chicken thighs")).toEqual(["chicken", "thigh"]);
  });

  it("falls back to the raw words rather than vanishing", () => {
    // "cloves" is an amount word AND a spice. Reducing it to nothing would make
    // the line invisible to the pantry, so the fallback keeps it.
    expect(ingredientKeywords("cloves")).toEqual(["clove"]);
    expect(ingredientKeywords("a couple of big ones")).not.toEqual([]);
  });

  it("suggests a search from a loose line", () => {
    expect(searchHintFor(loose("most of that jar of chilli oil"))).toBe("chilli oil");
  });
});

describe("the legacy shape migrates on open", () => {
  // Recipes saved before 2026-08-07 were flat { foodId, name, grams, per100g }
  // and always costed. They live in sealed blobs, so they're migrated on read.
  const legacy = { foodId: "usda-1", name: "Onions, raw", grams: 150, per100g: nut({ kcal: 40 }) };

  it("becomes text + cost, displaying exactly what it did before", () => {
    const got = normalizeIngredient(legacy as never);
    expect(got.text).toBe("Onions, raw");
    expect(got.cost).toEqual(legacy);
  });

  it("leaves an already-new ingredient alone", () => {
    const already = loose("two onions");
    expect(normalizeIngredient(already)).toBe(already);
  });

  it("migrates a whole recipe, and its nutrients are unchanged by the migration", () => {
    const old = { name: "Soup", servings: 2, ingredients: [legacy] } as unknown as RecipeContent;
    const migrated = normalizeRecipeContent(old);
    expect(recipeCoverage(migrated)).toEqual({ costed: 1, total: 1, complete: true });
    expect(recipeTotalNutrients(migrated).kcal).toBeCloseTo(60); // 150g at 40/100g
  });

  it("survives a recipe with no ingredients array at all", () => {
    expect(normalizeRecipeContent({ name: "x", servings: 1 } as RecipeContent).ingredients).toEqual([]);
  });
});

describe("partial costing is reported honestly", () => {
  const r: RecipeContent = {
    name: "Thrown together",
    servings: 2,
    ingredients: [
      costed("two onions", "Onions, raw", 150, nut({ kcal: 40, protein: 1 })),
      loose("a big spoon of harissa"),
      loose("the rest of the chickpeas"),
    ],
  };

  it("counts what has numbers behind it", () => {
    expect(recipeCoverage(r)).toEqual({ costed: 1, total: 3, complete: false });
    expect(costedIngredients(r)).toHaveLength(1);
  });

  it("sums only the costed part — it never estimates the rest", () => {
    expect(recipeTotalGrams(r)).toBe(150);
    expect(recipeTotalNutrients(r).kcal).toBeCloseTo(60);
    expect(recipePerServing(r).kcal).toBeCloseTo(30);
  });

  it("a fully loose recipe is valid, and has no numbers to log", () => {
    const allLoose: RecipeContent = { name: "Friday", servings: 1, ingredients: [loose("leftovers")] };
    expect(recipeCoverage(allLoose)).toEqual({ costed: 0, total: 1, complete: false });
    expect(recipeHasNumbers(allLoose)).toBe(false);
    // The guard exists so the UI never logs zeros, which would read as "you ate
    // nothing" — worse than not logging it at all.
    expect(recipeTotalNutrients(allLoose).kcal).toBe(0);
  });

  it("a partly costed recipe can be cooked, and logs exactly the costed part", () => {
    expect(recipeHasNumbers(r)).toBe(true);
    const food = recipeAsFood({ ...r, id: "r1" });
    const serving = food.portions[0];
    expect(serving.grams).toBeCloseTo(75); // 150g costed / 2 servings
    // Round-trip: logging one serving reproduces the per-serving numbers.
    const logged = loggedNutrients({ foodId: food.id, name: food.name, per100g: food.per100g, amountGrams: serving.grams });
    expect(logged.kcal).toBeCloseTo(recipePerServing(r).kcal);
  });
});

describe("the pantry understands loose words", () => {
  const pantry: PantryItem[] = [
    { id: "p1", foodId: "usda-onion", name: "Onions, raw", addedAt: 0 },
    { id: "p2", foodId: "usda-chickpea", name: "Chickpeas, canned", addedAt: 0 },
  ];

  it("matches a thrown-together line against what's in the cupboard", () => {
    const r = {
      id: "r", name: "Stew", servings: 2,
      ingredients: [loose("two onions"), loose("the rest of the chickpeas"), loose("a big spoon of harissa")],
    };
    const m = matchRecipe(r, pantry);
    expect(m.have).toEqual(["two onions", "the rest of the chickpeas"]);
    expect(m.missing).toEqual(["a big spoon of harissa"]);
    expect(m.ratio).toBeCloseTo(2 / 3);
  });

  it("still matches a costed ingredient by its food id", () => {
    const r = {
      id: "r", name: "Stew", servings: 1,
      ingredients: [costed("onion", "Onions, raw", 100, nut())],
    };
    expect(matchRecipe(r, pantry).have).toEqual(["onion"]);
  });

  it("names what you're missing in YOUR words, not the database's", () => {
    const r = { id: "r", name: "x", servings: 1, ingredients: [loose("most of that jar of harissa")] };
    expect(matchRecipe(r, pantry).missing).toEqual(["most of that jar of harissa"]);
  });

  it("does not let an uncosted line match everything via an empty food id", () => {
    // Regression guard: an ingredient with no cost has no foodId, and a blank
    // must never collide with a pantry item's blank.
    const blankPantry: PantryItem[] = [{ id: "p", foodId: "", name: "Rice", addedAt: 0 }];
    const r = { id: "r", name: "x", servings: 1, ingredients: [loose("harissa")] };
    expect(matchRecipe(r, blankPantry).have).toEqual([]);
  });
});

describe("photos are shrunk before they are stored", () => {
  it("scales the long edge down and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE, height: 675 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 675, height: MAX_EDGE });
  });

  it("never enlarges a small photo — that would invent detail", () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("survives a degenerate image without dividing by zero", () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("estimates encoded size from a data URL", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,QUJD")).toBe(3); // "ABC"
    expect(dataUrlBytes("data:image/jpeg;base64,QUJDRA==")).toBe(4); // "ABCD"
  });
});
