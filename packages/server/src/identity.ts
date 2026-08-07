// identity.ts — the identity key directory: publish your public key, look up
// someone else's by an address you already know.
//
// Always mounted (not gated by any feature flag). Split out of sharing.ts so
// an app that wants guardian-based recovery (see recovery.ts) without turning
// on full family-strand sharing can still look up guardians' public keys.
// Publishing a key here reveals nothing new about who has an account (the
// email already existed) — only a value that's useless without the matching
// private key, which is wrapped by the owner's vault key and never seen here.
import type { Hono } from "hono";
import type { BaseEnv, Vars } from "./server";
import { requireAuth } from "./server";

type App<E extends BaseEnv> = Hono<{ Bindings: E; Variables: Vars }>;

export function mountIdentity<E extends BaseEnv>(app: App<E>): void {
  app.post("/identity", requireAuth, async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json().catch(() => null);
    const pub = body?.identityPublicKey;
    const wrapped = body?.identityPrivWrapped;
    if (typeof pub !== "string" || !wrapped) return c.json({ error: "missing identity keys" }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET identity_pub = ? WHERE id = ?").bind(pub, userId),
      c.env.DB.prepare("UPDATE vaults SET identity_priv_wrapped = ? WHERE user_id = ?").bind(
        JSON.stringify(wrapped),
        userId
      ),
    ]);
    return c.json({ ok: true });
  });

  // Look up one person's public key, by an address you already know. Deliberately
  // NOT a search: you can't browse people here.
  app.get("/keys", requireAuth, async (c) => {
    const email = (c.req.query("email") ?? "").trim().toLowerCase();
    if (!email) return c.json({ error: "email required" }, 400);
    const u = await c.env.DB.prepare("SELECT identity_pub FROM users WHERE email = ?")
      .bind(email)
      .first<{ identity_pub: string | null }>();
    if (!u) return c.json({ error: "No such user." }, 404);
    return c.json({ identityPublicKey: u.identity_pub });
  });
}
