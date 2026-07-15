// index.ts — Ballast's sync server. The whole app is the shared factory; only the
// record kinds and the service name are Ballast's. Stores opaque ciphertext only.
import { createServer } from "@lantern/server";

export default createServer({
  kinds: ["account", "snapshot", "transaction", "goal"],
  service: "ballast-server",
});
