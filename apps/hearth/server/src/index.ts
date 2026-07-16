// index.ts — Hearth's sync server. The whole app is the shared factory; only the
// record kinds and the service name are Hearth's. Stores opaque ciphertext only.
import { createServer } from "@lantern/server";

export default createServer({
  kinds: ["foodLog", "metric", "goal", "recipe", "mealPlan", "pantryItem"],
  service: "hearth-server",
});
