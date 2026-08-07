// recovery.ts — the server side of social recovery: K-of-N guardians jointly
// help someone regain vault access, without the server ever holding a
// codeword, a plaintext Shamir share, or the DEK.
//
// Enabled per app with createServer({ recovery: true }); requires
// schema.recovery.sql and identity.ts's always-mounted /identity + /keys
// (guardians need to look each other up, independent of whether `sharing` is
// also on). See @lantern/core/recovery for the client-side crypto this wire
// format carries — every `wrapped*` field here is opaque to us.
//
// The two defenses this protocol carries end to end:
//  • A guardian's share only opens with BOTH their identity key AND an
//    out-of-band codeword — neither of which we ever see.
//  • A completed request sits behind a delay window, enforced HERE (a
//    timestamp check on GET /recovery/:id), not trusted to the client. Any of
//    the account's other authenticated devices can cancel in that window —
//    that needs no crypto, just requireAuth + a matching userId, the same
//    auth/encryption separation both apps' CLAUDE.md already states.
import type { Hono } from "hono";
import type { BaseEnv, Vars, ServerContext } from "./server";
import { requireAuth, withinRateLimit, isCipherBlob } from "./server";

type App<E extends BaseEnv> = Hono<{ Bindings: E; Variables: Vars }>;

function isWrappedKey(x: any): boolean {
  return !!x && typeof x.iv === "string" && typeof x.data === "string";
}

type CircleRow = {
  user_id: string;
  k: number;
  n: number;
  delay_ms: number;
  recovery_wrapped_dek: string;
};

type RequestRow = {
  request_id: string;
  user_id: string;
  session_pub: string;
  k: number;
  delay_ms: number;
  status: "collecting" | "pending_delay" | "cancelled" | "completed";
  delay_starts_at: number | null;
  created_at: number;
  updated_at: number;
};

async function getCircle(db: D1Database, userId: string): Promise<CircleRow | null> {
  return db
    .prepare("SELECT user_id, k, n, delay_ms, recovery_wrapped_dek FROM recovery_circles WHERE user_id = ?")
    .bind(userId)
    .first<CircleRow>();
}

async function getOpenRequest(db: D1Database, userId: string): Promise<RequestRow | null> {
  return db
    .prepare(
      "SELECT * FROM recovery_requests WHERE user_id = ? AND status IN ('collecting','pending_delay')"
    )
    .bind(userId)
    .first<RequestRow>();
}

async function countApprovals(db: D1Database, requestId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM recovery_approvals WHERE request_id = ?")
    .bind(requestId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Mount the recovery routes. Called by createServer({ recovery: true }).
 * `minDelayMs` (from ServerConfig.recoveryMinDelayMs) is an app-wide floor —
 * e.g. Ballast requires a longer delay than a journaling app, since the
 * stakes of a wrongly-completed recovery are higher.
 */
export function mountRecovery<E extends BaseEnv>(app: App<E>, opts: { minDelayMs?: number } = {}): void {
  const minDelayMs = opts.minDelayMs ?? 0;

  // ---- Circle setup / rotation --------------------------------------------

  app.post("/recovery/circle", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const b = await c.req.json().catch(() => null);
    const { k, n, delayMs, recoveryWrappedDEK, guardians } = b ?? {};
    if (
      typeof k !== "number" ||
      typeof n !== "number" ||
      k < 2 ||
      n < k ||
      n > 255 ||
      typeof delayMs !== "number" ||
      delayMs < minDelayMs ||
      !isCipherBlob(recoveryWrappedDEK) ||
      !Array.isArray(guardians) ||
      guardians.length !== n
    ) {
      return c.json({ error: "Invalid recovery circle." }, 400);
    }
    for (const g of guardians) {
      if (
        typeof g?.email !== "string" ||
        typeof g?.shareIndex !== "number" ||
        typeof g?.ephemeralPub !== "string" ||
        !isWrappedKey(g?.wrapped) ||
        !Array.isArray(g?.codewordSalt) ||
        typeof g?.codewordIterations !== "number"
      ) {
        return c.json({ error: "Invalid guardian entry." }, 400);
      }
    }

    const emails = guardians.map((g: any) => (g.email as string).trim().toLowerCase());
    const rows = await c.env.DB.prepare(
      `SELECT id, email FROM users WHERE email IN (${emails.map(() => "?").join(",")})`
    )
      .bind(...emails)
      .all<{ id: string; email: string }>();
    const byEmail = new Map((rows.results ?? []).map((r) => [r.email, r.id]));
    const missing = emails.filter((e) => !byEmail.has(e));
    if (missing.length) return c.json({ error: `No account for: ${missing.join(", ")}` }, 404);

    const now = Date.now();
    const stmts = [
      // Rotation invalidates any in-flight request: old guardian shares wrap
      // the OLD recovery key, which a fresh circle just replaced.
      c.env.DB.prepare(
        "UPDATE recovery_requests SET status = 'cancelled', cancelled_by = ?, updated_at = ? WHERE user_id = ? AND status IN ('collecting','pending_delay')"
      ).bind(userId, now, userId),
      c.env.DB.prepare("DELETE FROM recovery_guardians WHERE user_id = ?").bind(userId),
      c.env.DB.prepare(
        `INSERT INTO recovery_circles (user_id, k, n, delay_ms, recovery_wrapped_dek, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET k = excluded.k, n = excluded.n, delay_ms = excluded.delay_ms,
           recovery_wrapped_dek = excluded.recovery_wrapped_dek, updated_at = excluded.updated_at`
      ).bind(userId, k, n, delayMs, JSON.stringify(recoveryWrappedDEK), now, now),
      ...guardians.map((g: any) =>
        c.env.DB.prepare(
          `INSERT INTO recovery_guardians
             (user_id, guardian_user_id, share_index, ephemeral_pub, wrapped, codeword_salt, codeword_iterations, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          userId,
          byEmail.get((g.email as string).trim().toLowerCase())!,
          g.shareIndex,
          g.ephemeralPub,
          JSON.stringify(g.wrapped),
          JSON.stringify(g.codewordSalt),
          g.codewordIterations,
          now
        )
      ),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

  app.get("/recovery/circle", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const circle = await getCircle(c.env.DB, userId);
    if (!circle) return c.json({ error: "No recovery circle configured." }, 404);
    const rows = await c.env.DB.prepare(
      "SELECT u.email, g.share_index, g.added_at FROM recovery_guardians g JOIN users u ON u.id = g.guardian_user_id WHERE g.user_id = ? ORDER BY g.share_index"
    )
      .bind(userId)
      .all<{ email: string; share_index: number; added_at: number }>();
    return c.json({
      k: circle.k,
      n: circle.n,
      delayMs: circle.delay_ms,
      guardians: (rows.results ?? []).map((r) => ({ email: r.email, shareIndex: r.share_index, addedAt: r.added_at })),
    });
  });

  // ---- Starting and watching a request ------------------------------------

  app.post("/recovery/request", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    if (!(await withinRateLimit(c, "recovery-request", 5, 86_400_000))) {
      return c.json({ error: "Too many recovery attempts from this account — please wait and try again." }, 429);
    }
    const b = await c.req.json().catch(() => null);
    const sessionPub = b?.sessionPub;
    if (typeof sessionPub !== "string") return c.json({ error: "missing sessionPub" }, 400);

    const circle = await getCircle(c.env.DB, userId);
    if (!circle) return c.json({ error: "No recovery circle configured." }, 404);
    if (await getOpenRequest(c.env.DB, userId)) {
      return c.json({ error: "A recovery request is already open on this account." }, 409);
    }

    const requestId = crypto.randomUUID();
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO recovery_requests (request_id, user_id, session_pub, k, delay_ms, status, delay_starts_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'collecting', NULL, ?, ?)`
    )
      .bind(requestId, userId, sessionPub, circle.k, circle.delay_ms, now, now)
      .run();

    const guardianRows = await c.env.DB.prepare(
      "SELECT u.email FROM recovery_guardians g JOIN users u ON u.id = g.guardian_user_id WHERE g.user_id = ?"
    )
      .bind(userId)
      .all<{ email: string }>();
    return c.json({
      requestId,
      k: circle.k,
      n: circle.n,
      delayMs: circle.delay_ms,
      guardianEmails: (guardianRows.results ?? []).map((r) => r.email),
    });
  });

  // Owner-side pull surface: is there a pending recovery request on MY account
  // right now? Checked from the normal sync/open-app path on every device —
  // this is the (deliberately pull-only) substitute for a push notification.
  app.get("/recovery/status", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const request = await getOpenRequest(c.env.DB, userId);
    if (!request) return c.json({ request: null });
    const approvals = await countApprovals(c.env.DB, request.request_id);
    const readyAt = request.delay_starts_at != null ? request.delay_starts_at + request.delay_ms : null;
    return c.json({
      request: {
        requestId: request.request_id,
        status: request.status,
        approvals,
        k: request.k,
        createdAt: request.created_at,
        readyAt,
      },
    });
  });

  // Guardian-side pull surface: requests where I'm a registered guardian and
  // haven't approved yet, bundled with my own (still-wrapped) share.
  app.get("/recovery/pending-for-me", requireAuth, async (c: ServerContext<E>) => {
    const guardianId = c.get("userId");
    const rows = await c.env.DB.prepare(
      `SELECT r.request_id, r.session_pub, r.k, u.email AS owner_email, cir.n,
              g.ephemeral_pub, g.wrapped, g.codeword_salt, g.codeword_iterations
       FROM recovery_requests r
       JOIN recovery_guardians g ON g.user_id = r.user_id AND g.guardian_user_id = ?
       JOIN users u ON u.id = r.user_id
       JOIN recovery_circles cir ON cir.user_id = r.user_id
       WHERE r.status = 'collecting'
         AND NOT EXISTS (
           SELECT 1 FROM recovery_approvals a WHERE a.request_id = r.request_id AND a.guardian_user_id = ?
         )`
    )
      .bind(guardianId, guardianId)
      .all<{
        request_id: string;
        session_pub: string;
        k: number;
        owner_email: string;
        n: number;
        ephemeral_pub: string;
        wrapped: string;
        codeword_salt: string;
        codeword_iterations: number;
      }>();
    return c.json({
      requests: (rows.results ?? []).map((r) => ({
        requestId: r.request_id,
        ownerEmail: r.owner_email,
        k: r.k,
        n: r.n,
        sessionPub: r.session_pub,
        myShare: {
          ephemeralPub: r.ephemeral_pub,
          wrapped: JSON.parse(r.wrapped),
          codewordSalt: JSON.parse(r.codeword_salt),
          codewordIterations: r.codeword_iterations,
        },
      })),
    });
  });

  // ---- Approving, polling, cancelling, completing -------------------------

  app.post("/recovery/:id/approve", requireAuth, async (c: ServerContext<E>) => {
    const guardianId = c.get("userId");
    const requestId = c.req.param("id")!;
    const b = await c.req.json().catch(() => null);
    const wrapped = b?.wrappedShareForRequester;
    if (!wrapped || typeof wrapped.ephemeralPub !== "string" || !isWrappedKey(wrapped.wrapped)) {
      return c.json({ error: "missing wrappedShareForRequester" }, 400);
    }

    const request = await c.env.DB.prepare("SELECT * FROM recovery_requests WHERE request_id = ?")
      .bind(requestId)
      .first<RequestRow>();
    if (!request || request.status !== "collecting") {
      return c.json({ error: "This recovery request is no longer open." }, 410);
    }
    const isGuardian = await c.env.DB.prepare(
      "SELECT 1 FROM recovery_guardians WHERE user_id = ? AND guardian_user_id = ?"
    )
      .bind(request.user_id, guardianId)
      .first();
    if (!isGuardian) return c.json({ error: "You aren't a guardian for this account." }, 403);

    const now = Date.now();
    try {
      await c.env.DB.prepare(
        `INSERT INTO recovery_approvals (request_id, guardian_user_id, ephemeral_pub, wrapped, approved_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(requestId, guardianId, wrapped.ephemeralPub, JSON.stringify(wrapped.wrapped), now)
        .run();
    } catch {
      return c.json({ error: "You've already approved this request." }, 409);
    }

    const approvals = await countApprovals(c.env.DB, requestId);
    if (approvals >= request.k) {
      await c.env.DB.prepare(
        "UPDATE recovery_requests SET status = 'pending_delay', delay_starts_at = ?, updated_at = ? WHERE request_id = ? AND status = 'collecting'"
      )
        .bind(now, now, requestId)
        .run();
    }
    return c.json({ ok: true, approvals, ready: approvals >= request.k });
  });

  // Requester's own poll. Approval material (the actual wrapped shares) is
  // only released once the delay window has cleared, server-side.
  app.get("/recovery/:id", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const requestId = c.req.param("id")!;
    const request = await c.env.DB.prepare("SELECT * FROM recovery_requests WHERE request_id = ? AND user_id = ?")
      .bind(requestId, userId)
      .first<RequestRow>();
    if (!request) return c.json({ error: "No such recovery request." }, 404);

    const approvals = await countApprovals(c.env.DB, requestId);
    const readyAt = request.delay_starts_at != null ? request.delay_starts_at + request.delay_ms : null;
    const cleared = request.status === "pending_delay" && readyAt !== null && Date.now() >= readyAt;

    if (!cleared) {
      return c.json({ status: request.status, approvals, k: request.k, readyAt });
    }

    const circle = await getCircle(c.env.DB, userId);
    const rows = await c.env.DB.prepare("SELECT ephemeral_pub, wrapped FROM recovery_approvals WHERE request_id = ?")
      .bind(requestId)
      .all<{ ephemeral_pub: string; wrapped: string }>();
    return c.json({
      status: request.status,
      approvals,
      k: request.k,
      readyAt,
      recoveryWrappedDEK: circle ? JSON.parse(circle.recovery_wrapped_dek) : null,
      approvalShares: (rows.results ?? []).map((r) => ({ ephemeralPub: r.ephemeral_pub, wrapped: JSON.parse(r.wrapped) })),
    });
  });

  app.post("/recovery/:id/cancel", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const requestId = c.req.param("id")!;
    const res = await c.env.DB.prepare(
      "UPDATE recovery_requests SET status = 'cancelled', cancelled_by = ?, updated_at = ? WHERE request_id = ? AND user_id = ? AND status IN ('collecting','pending_delay')"
    )
      .bind(userId, Date.now(), requestId, userId)
      .run();
    if (!res.meta.changes) return c.json({ error: "No open request to cancel." }, 404);
    return c.json({ ok: true });
  });

  app.post("/recovery/:id/complete", requireAuth, async (c: ServerContext<E>) => {
    const userId = c.get("userId");
    const requestId = c.req.param("id")!;
    const res = await c.env.DB.prepare(
      "UPDATE recovery_requests SET status = 'completed', updated_at = ? WHERE request_id = ? AND user_id = ? AND status = 'pending_delay'"
    )
      .bind(Date.now(), requestId, userId)
      .run();
    if (!res.meta.changes) return c.json({ error: "This request isn't ready to complete." }, 400);
    return c.json({ ok: true });
  });
}
