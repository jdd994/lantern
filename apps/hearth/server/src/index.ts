// index.ts — Hearth's sync server. The whole app is the shared factory; only the
// record kinds and the service name are Hearth's. Stores opaque ciphertext only.
import { createServer } from "@lantern/server";

export default createServer({
  kinds: ["foodLog", "metric", "goal", "recipe", "mealPlan", "pantryItem"],
  service: "hearth-server",
  // Sharing: the /shared/* collections + the identity/key directory, from the
  // shared factory. This is what "plan meals with the people you feed" runs on —
  // co-authored recipes and meal plans. The server stays blind: it holds each
  // member's key wrapped to their own public key, and never a plaintext ingredient.
  // Tables: packages/server/schema.sharing.sql (applied to the hearth D1).
  sharing: true,
});
