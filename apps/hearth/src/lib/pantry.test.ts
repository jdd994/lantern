import { describe, expect, it } from "vitest";
import { ingredientCovered, matchRecipe, matchRecipes, recipeTags, type PantryItem } from "./pantry";
import { ZERO, type Recipe } from "./nutrition";

const per100g = { ...ZERO, kcal: 100 };
const item = (foodId: string, name: string): PantryItem => ({ id: foodId, foodId, name, addedAt: 0 });

const recipe = (name: string, ings: [string, string][]): Recipe => ({
  id: name,
  name,
  servings: 2,
  ingredients: ings.map(([foodId, n]) => ({ foodId, name: n, grams: 100, per100g })),
});

describe("ingredientCovered", () => {
  it("matches on foodId regardless of the name", () => {
    expect(ingredientCovered("Onions, raw", "usda:11282", [item("usda:11282", "Whatever")])).toBe(true);
  });

  it("matches loosely across naming styles and plurals", () => {
    expect(ingredientCovered("Onions, raw", "usda:1", [item("x", "onion")])).toBe(true);
    expect(ingredientCovered("Rice", "usda:2", [item("x", "rice, white, long-grain")])).toBe(true);
  });

  it("does not treat a more specific pantry item as the plain ingredient", () => {
    expect(ingredientCovered("Onions, raw", "usda:1", [item("x", "onion powder")])).toBe(false);
  });

  it("is false for an empty pantry", () => {
    expect(ingredientCovered("Onions", "usda:1", [])).toBe(false);
  });
});

describe("matchRecipe", () => {
  it("splits have vs missing and reports coverage", () => {
    const r = recipe("Stew", [["a", "Beans"], ["b", "Onions, raw"], ["c", "Thyme"]]);
    const m = matchRecipe(r, [item("a", "Beans"), item("z", "onion")]);
    expect(m.have).toEqual(["Beans", "Onions, raw"]);
    expect(m.missing).toEqual(["Thyme"]);
    expect(m.ratio).toBeCloseTo(2 / 3);
  });
});

describe("matchRecipes", () => {
  const cookable = recipe("Cookable", [["a", "Beans"]]);
  const oneAway = recipe("One away", [["a", "Beans"], ["b", "Thyme"]]);
  const farOff = recipe("Far off", [["a", "Beans"], ["x", "Saffron"], ["y", "Duck"], ["z", "Port"]]);
  const pantry = [item("a", "Beans")];

  it("ranks what you can make now first, then closest", () => {
    expect(matchRecipes([oneAway, cookable], pantry).map((m) => m.recipe.name)).toEqual([
      "Cookable",
      "One away",
    ]);
  });

  it("hides the hopeless ones so the list stays encouraging", () => {
    expect(matchRecipes([cookable, farOff], pantry).map((m) => m.recipe.name)).toEqual(["Cookable"]);
  });

  it("respects a wider maxMissing when asked", () => {
    expect(matchRecipes([farOff], pantry, 3)).toHaveLength(1);
  });

  it("returns nothing for an empty pantry rather than every recipe", () => {
    expect(matchRecipes([cookable], [])).toEqual([]);
  });
});

describe("moods (tags)", () => {
  const tagged = (name: string, tags: string[]): Recipe => ({
    ...recipe(name, [["a", "Beans"]]),
    tags,
  });
  const pantry = [item("a", "Beans")];

  it("offers back only the tags you actually used, normalised", () => {
    expect(recipeTags([tagged("A", ["Asian", " comfort "]), tagged("B", ["asian"])])).toEqual([
      "asian",
      "comfort",
    ]);
  });

  it("narrows to a mood, case-insensitively", () => {
    const list = [tagged("Ramen", ["Asian"]), tagged("Stew", ["comfort"])];
    expect(matchRecipes(list, pantry, 2, "asian").map((m) => m.recipe.name)).toEqual(["Ramen"]);
  });

  it("returns everything makeable when no mood is asked for", () => {
    const list = [tagged("Ramen", ["asian"]), tagged("Stew", ["comfort"])];
    expect(matchRecipes(list, pantry)).toHaveLength(2);
  });

  it("leaves untagged recipes out of a mood, but never out of 'anything'", () => {
    const list = [recipe("Plain", [["a", "Beans"]])];
    expect(matchRecipes(list, pantry, 2, "asian")).toHaveLength(0);
    expect(matchRecipes(list, pantry)).toHaveLength(1);
  });
});
