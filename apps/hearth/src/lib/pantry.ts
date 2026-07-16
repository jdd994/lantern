// pantry.ts — "what can I make with what I have?"
//
// Pure and offline, which is the whole reason this half is worth building first:
// matching your saved recipes against the ingredients you have is just set
// arithmetic over data you already own. Nobody is asked, nothing is sent. (The
// other half — "and here's HOW to cook it" — needs instructions or a model, so it
// stays behind the same consent seam as FoodRecognizer. See CLAUDE.md.)
//
// The tone matters as much as the maths: a recipe you can't quite make is not a
// failure, it's "you're two things away". We rank by what's closest, never scold,
// and "missing" is a neutral word here.
import type { Recipe } from "./nutrition";

// What you have. Quantities are deliberately NOT tracked: a pantry that demands
// you weigh your rice is a pantry nobody updates. Presence is enough to answer
// "can I make this?", and pretending to know you have exactly 340g would be a lie
// that quietly rots.
export type PantryItem = { id: string; foodId: string; name: string; addedAt: number };

export type RecipeMatch = {
  recipe: Recipe;
  have: string[]; // ingredient names you have
  missing: string[]; // ingredient names you don't
  ratio: number; // 0..1 of ingredients covered
};

// Loose name matching: pantry "onion" should cover a recipe's "Onions, raw", and
// vice versa. Exact foodId is the strong signal; the name is the fallback, since
// the same thing gets logged from different sources (seed vs USDA vs a barcode).
const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const words = (s: string) => norm(s).split(" ").filter(Boolean).map(singular);

export function ingredientCovered(ingredientName: string, ingredientFoodId: string, pantry: PantryItem[]): boolean {
  if (pantry.some((p) => p.foodId === ingredientFoodId)) return true;
  const iw = words(ingredientName);
  if (!iw.length) return false;
  return pantry.some((p) => {
    const pw = words(p.name);
    if (!pw.length) return false;
    // Covered when either name's words are all present in the other — so "onion"
    // matches "Onions, raw", without "onion powder" matching plain "onion".
    return pw.every((w) => iw.includes(w)) || iw.every((w) => pw.includes(w));
  });
}

export function matchRecipe(recipe: Recipe, pantry: PantryItem[]): RecipeMatch {
  const have: string[] = [];
  const missing: string[] = [];
  for (const ing of recipe.ingredients) {
    (ingredientCovered(ing.name, ing.foodId, pantry) ? have : missing).push(ing.name);
  }
  const total = recipe.ingredients.length;
  return { recipe, have, missing, ratio: total === 0 ? 0 : have.length / total };
}

export const recipeTags = (recipes: Recipe[]): string[] =>
  [...new Set(recipes.flatMap((r) => r.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))].sort();

export const hasTag = (r: Recipe, tag: string): boolean =>
  (r.tags ?? []).some((t) => t.toLowerCase().trim() === tag.toLowerCase().trim());

/**
 * Your recipes, closest-first: the ones you can make now, then the ones you're a
 * couple of things away from. `maxMissing` keeps the list encouraging rather than
 * a wall of everything you can't do. `tag` narrows it to a mood ("asian") — but
 * only ever to tags you gave your own recipes; nothing is inferred about you.
 */
export function matchRecipes(
  recipes: Recipe[],
  pantry: PantryItem[],
  maxMissing = 2,
  tag?: string
): RecipeMatch[] {
  if (!pantry.length) return [];
  return recipes
    .filter((r) => !tag || hasTag(r, tag))
    .map((r) => matchRecipe(r, pantry))
    .filter((m) => m.recipe.ingredients.length > 0 && m.missing.length <= maxMissing)
    .sort(
      (a, b) =>
        a.missing.length - b.missing.length ||
        b.ratio - a.ratio ||
        a.recipe.name.localeCompare(b.recipe.name)
    );
}
