// index.ts — Aura's only server: a single anonymous feedback box. Aura has no
// account and needs none for anything about your lights — this exists purely
// so "tell me what's clunky" can land without leaving the app. It never sees a
// light, a room, a scene, or a credential, and nothing else in Aura ever talks
// to it. Deliberately its own tiny Worker rather than @lantern/server's
// createServer factory: that factory's base is an account/vault/sync system,
// and pulling it in just to mount one open route would mean carrying (and
// exposing) register/login endpoints Aura will never use.
import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = { DB: D1Database; ALLOWED_ORIGIN: string };
const app = new Hono<{ Bindings: Env }>();

app.use("*", (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : null),
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next);
});

const TOO_MANY = "Too many attempts from here — please wait a little and try again.";

// Fixed-window rate limit, same shape as the other lantern servers' — kept
// standalone here rather than imported, since @lantern/server's version is
// typed against the account-oriented BaseEnv this Worker doesn't have.
async function withinRateLimit(db: D1Database, ip: string, limit: number, windowMs: number): Promise<boolean> {
  const key = `feedback:${ip}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const row = await db
      .prepare(
        "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count"
      )
      .bind(key, Date.now() + windowMs)
      .first<{ count: number }>();
    if (Math.random() < 0.05) {
      await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Date.now()).run();
    }
    return (row?.count ?? 1) <= limit;
  } catch {
    return true; // never let the limiter itself take the box down
  }
}

app.post("/feedback", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await withinRateLimit(c.env.DB, ip, 8, 3_600_000))) return c.json({ error: TOO_MANY }, 429);
  const b = await c.req.json().catch(() => null);
  const message = (b?.message ?? "").toString().trim();
  if (!message) return c.json({ error: "Say a little something first." }, 400);
  if (message.length > 4000) return c.json({ error: "That's a bit long — trim it a touch." }, 400);
  const contact = (b?.contact ?? "").toString().trim().slice(0, 200) || null;
  await c.env.DB.prepare("INSERT INTO feedback (id, created_at, message, contact) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), Date.now(), message.slice(0, 4000), contact)
    .run();
  return c.json({ ok: true });
});

export default app;
