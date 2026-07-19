// index.ts — Ballast's sync server. The whole app is the shared factory; only the
// record kinds and the service name are Ballast's. Stores opaque ciphertext only.
import { createServer } from "@lantern/server";

export default createServer({
  kinds: ["account", "snapshot", "transaction", "goal"],
  service: "ballast-server",
  // /recovery/* — guardian-based social recovery. Doesn't need `sharing: true`
  // (Ballast stays single-owner-feeling on purpose) — /identity + /keys are
  // always mounted, independent of that flag, so guardian lookups still work.
  // Requires schema.recovery.sql applied to this app's D1.
  recovery: true,
  // Money warrants a stricter floor than a journal or a food log: a longer
  // safety window before a recovery completes.
  recoveryMinDelayMs: 96 * 3_600_000,
});
