// pairing.ts — the server side of QR device linking: an unset-up device shows
// a QR, an already-signed-in device scans it and hands over everything the
// new device needs to be unlocked immediately — no passphrase, no account
// password typed anywhere. See @lantern/core/pairing for the client-side
// crypto this wire format carries; `payload` here is opaque to us the whole
// time (ECIES ciphertext, same shape as recovery's wrapped shares).
//
// Enabled per app with createServer({ pairing: true }); requires
// schema.pairing.sql. Unlike sharing/recovery, POST /pair/start and
// GET /pair/:id are deliberately UNAUTHENTICATED — the new device has no
// account yet. What stands in for auth: a random, unguessable id (122 bits,
// client-generated) and a short server-enforced expiry (~5 minutes), the same
// two properties an invite link's fragment secret leans on in sharing.ts.
import type { Hono } from "hono";
import type { BaseEnv, Vars, ServerContext } from "./server";
import { requireAuth, withinRateLimit } from "./server";

type App<E extends BaseEnv> = Hono<{ Bindings: E; Variables: Vars }>;

const PAIRING_TTL_MS = 5 * 60_000;

function isWrappedKey(x: any): boolean {
  return !!x && typeof x.iv === "string" && typeof x.data === "string";
}
function isWrappedBytes(x: any): boolean {
  return !!x && typeof x.ephemeralPub === "string" && isWrappedKey(x.wrapped);
}

type Row = {
  id: string;
  public_key: string;
  status: "pending" | "delivered" | "cancelled";
  payload: string | null;
  delivered_by: string | null;
  created_at: number;
  expires_at: number;
  delivered_at: number | null;
};

async function purgeExpired(db: D1Database): Promise<void> {
  // Same "cheap, probabilistic" sweep withinRateLimit uses — never worth a cron
  // for a table this small and this short-lived.
  if (Math.random() < 0.05) {
    await db.prepare("DELETE FROM pairing_requests WHERE expires_at < ? AND status <> 'delivered'").bind(Date.now()).run();
  }
}

export function mountPairing<E extends BaseEnv>(app: App<E>): void {
  // New device: register the session so a scanning device has somewhere to
  // deliver to. No auth — by definition, this device doesn't have an account.
  app.post("/pair/start", async (c: ServerContext<E>) => {
    if (!(await withinRateLimit(c, "pair-start", 20, 3_600_000))) {
      return c.json({ error: "Too many pairing attempts from here — please wait and try again." }, 429);
    }
    const b = await c.req.json().catch(() => null);
    const id = b?.id;
    const publicKeyB64 = b?.publicKeyB64;
    if (typeof id !== "string" || id.length < 8 || id.length > 200) {
      return c.json({ error: "Invalid pairing id." }, 400);
    }
    if (typeof publicKeyB64 !== "string" || publicKeyB64.length < 1 || publicKeyB64.length > 2000) {
      return c.json({ error: "Invalid public key." }, 400);
    }
    await purgeExpired(c.env.DB);
    const now = Date.now();
    const expiresAt = now + PAIRING_TTL_MS;
    try {
      await c.env.DB.prepare(
        "INSERT INTO pairing_requests (id, public_key, status, delivered_by, created_at, expires_at) VALUES (?, ?, 'pending', NULL, ?, ?)"
      )
        .bind(id, publicKeyB64, now, expiresAt)
        .run();
    } catch {
      return c.json({ error: "That pairing id is already in use — try again." }, 409);
    }
    return c.json({ ok: true, expiresAt });
  });

  // New device: poll until the scanning device has delivered a payload (or it
  // expires / gets cancelled). Rate-limited per IP as a cheap guard against
  // hammering arbitrary ids — the id itself is the only thing worth guessing,
  // and at 122 bits of entropy that's not a practical risk.
  app.get("/pair/:id", async (c: ServerContext<E>) => {
    if (!(await withinRateLimit(c, "pair-poll", 120, 60_000))) {
      return c.json({ error: "Too many requests — please slow down." }, 429);
    }
    const id = c.req.param("id")!;
    const row = await c.env.DB.prepare("SELECT * FROM pairing_requests WHERE id = ?").bind(id).first<Row>();
    if (!row) return c.json({ error: "No such pairing request." }, 404);

    if (row.status === "cancelled") return c.json({ status: "cancelled" });
    if (row.status === "pending" && Date.now() >= row.expires_at) return c.json({ status: "expired" });
    if (row.status === "pending") return c.json({ status: "pending" });

    return c.json({ status: "delivered", wrapped: row.payload ? JSON.parse(row.payload) : null });
  });

  // Existing, authenticated device, right after scanning the QR: hand over the
  // wrapped payload for the server to relay. Only succeeds once, onto a
  // request that's still open and hasn't expired.
  app.post("/pair/:id/deliver", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const id = c.req.param("id")!;
    if (!(await withinRateLimit(c, "pair-deliver", 30, 3_600_000))) {
      return c.json({ error: "Too many pairing attempts from this account — please wait and try again." }, 429);
    }
    const b = await c.req.json().catch(() => null);
    const wrapped = b?.wrapped;
    if (!isWrappedBytes(wrapped)) return c.json({ error: "Missing or malformed payload." }, 400);

    const row = await c.env.DB.prepare("SELECT * FROM pairing_requests WHERE id = ?").bind(id).first<Row>();
    if (!row) return c.json({ error: "No such pairing request." }, 404);
    if (row.status !== "pending" || Date.now() >= row.expires_at) {
      return c.json({ error: "This pairing code is no longer open — ask the new device for a fresh one." }, 410);
    }

    const now = Date.now();
    const res = await c.env.DB.prepare(
      "UPDATE pairing_requests SET status = 'delivered', payload = ?, delivered_by = ?, delivered_at = ? WHERE id = ? AND status = 'pending'"
    )
      .bind(JSON.stringify(wrapped), userId, now, id)
      .run();
    if (!res.meta.changes) return c.json({ error: "This pairing code was just used — ask for a fresh one." }, 409);
    return c.json({ ok: true });
  });

  // Existing device: "that wasn't me" — undo a delivery it just made, within
  // the same short window. Deliberately narrow: only the device that
  // delivered can cancel, and only before the new device has had a chance to
  // consume it and move on.
  app.post("/pair/:id/cancel", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const id = c.req.param("id")!;
    const res = await c.env.DB.prepare(
      "UPDATE pairing_requests SET status = 'cancelled', payload = NULL WHERE id = ? AND delivered_by = ? AND status = 'delivered'"
    )
      .bind(id, userId)
      .run();
    if (!res.meta.changes) return c.json({ error: "No open delivery to cancel." }, 404);
    return c.json({ ok: true });
  });
}
