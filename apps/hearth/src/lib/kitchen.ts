// kitchen.ts — a shared kitchen: the recipes (and later, the week's plan) you
// keep with the people you actually cook with.
//
// "Plan meals with the people you feed." This is the one part of Hearth that
// another person can see, and it is opt-in per kitchen. What NEVER enters it:
// your food log, your body metrics, your goals. Cooking something from a shared
// kitchen logs it PRIVATELY to you — the plan is shared, the eating isn't.
//
// The crypto (from @lantern/core/sharing): a kitchen has its own random key. Its
// contents are encrypted with THAT key, and each member holds a copy wrapped to
// their own identity key. The server stores ciphertext and membership; it can
// never read an ingredient.
import type { Recipe } from "./nutrition";
import type { PlanContent } from "./mealplan";

/** What a kitchen looks like to the UI. The key itself never lives here — it
 *  stays in a ref in the hook, like the vault key. */
export type Kitchen = {
  strandId: string;
  ownerId: string;
  role: string; // 'owner' | 'member'
  dekEpoch: number;
  name: string;
  recipes: Recipe[]; // shared, decrypted for display
  plans: SharedPlan[]; // the week, co-authored
};

// A planned meal inside a kitchen. Unlike a personal plan — whose `at` is
// plaintext meta so a week can be windowed without decrypting — a shared plan
// carries `at` INSIDE the ciphertext. Shared records have no meta channel, and
// it's the better default anyway: the server learns nothing about when you eat.
export type SharedPlanContent = PlanContent & { at: number };
export type SharedPlan = SharedPlanContent & { id: string };

/** The record kinds that live inside a kitchen. */
export type KitchenKind = "meta" | "recipe" | "mealPlan";

/** The kitchen's own details, stored as an encrypted record like everything else
 *  — so even its name is nobody else's business. */
export type KitchenMeta = { name: string };

export const KITCHEN_META_ID = "meta";
