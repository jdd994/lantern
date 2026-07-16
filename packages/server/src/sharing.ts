// sharing.ts — the server side of sharing a collection with people you love.
//
// Extracted from Driftless (shared strands) when Hearth became the second app to
// need it. Enabled per app with createServer({ sharing: true }); an app without it
// is exactly as private as before — no tables consulted, no routes mounted.
//
// The server's job here is deliberately small and blind:
//  • It gates access by MEMBERSHIP, and stores each shared object's ciphertext with
//    a per-collection monotonic `seq` (the pull cursor). It never holds a key.
//  • Each member's copy of the collection key is stored WRAPPED TO THEIR PUBLIC KEY
//    (see @lantern/core/sharing) — only they can unwrap it.
//  • For an invite LINK it stores the key wrapped by the link's secret (which lives
//    in a URL fragment and never reaches us) plus a HASH of the join proof. So a
//    breach of this database yields neither the collection nor a way to join.
//
// Vocabulary note: the wire format and tables still say "strand" — that's
// Driftless's word, and it's load-bearing for a live deployment with real data.
// Renaming it would be a migration, not a refactor, so the shared code speaks
// Driftless's dialect here and each app's UI names it in its own language.
import type { Hono } from "hono";
import type { BaseEnv, Vars } from "./server";
import { isCipherBlob, MAX_PUSH, PULL_LIMIT, requireAuth } from "./server";

type App<E extends BaseEnv> = Hono<{ Bindings: E; Variables: Vars }>;

/** Is this user a member of this collection? Exported so an app's own routes
 *  (e.g. Driftless's shared media) can gate on the same rule. */
export async function membership(db: D1Database, strandId: string, userId: string) {
  return db
    .prepare("SELECT role FROM strand_members WHERE strand_id = ? AND user_id = ?")
    .bind(strandId, userId)
    .first<{ role: string }>();
}

async function maxSharedSeq(db: D1Database, strandId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM shared_objects WHERE strand_id = ?")
    .bind(strandId)
    .first<{ m: number }>();
  return r?.m ?? 0;
}

function validSharedChange(ch: any): boolean {
  return (
    ch &&
    typeof ch.kind === "string" &&
    typeof ch.id === "string" &&
    typeof ch.createdAt === "number" &&
    typeof ch.updatedAt === "number" &&
    typeof ch.deleted === "boolean" &&
    typeof ch.dekEpoch === "number" &&
    isCipherBlob(ch.content)
  );
}

const UPSERT_SHARED = `
INSERT INTO shared_objects (strand_id, kind, id, created_at, updated_at, deleted, content, dek_epoch, seq)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(strand_id, id) DO UPDATE SET
  updated_at = excluded.updated_at,
  deleted    = excluded.deleted,
  content    = excluded.content,
  dek_epoch  = excluded.dek_epoch,
  seq        = excluded.seq
WHERE excluded.updated_at >= shared_objects.updated_at`;

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let s = "";
  for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
  return btoa(s);
}

type InviteRow = {
  invite_id: string;
  strand_id: string;
  wrapped_dek: string;
  join_proof_hash: string;
  dek_epoch: number;
  expires_at: number;
  revoked: number;
  max_uses: number;
  uses: number;
};

/**
 * Mount the sharing routes. Called by createServer({ sharing: true }); route
 * order is preserved from the original Driftless implementation.
 */
export function mountSharing<E extends BaseEnv>(app: App<E>): void {
  // ---- Identity / key directory -----------------------------------------
  // Sharing needs a way to reach someone's PUBLIC key. The private half is
  // wrapped by their vault key and stored opaquely — we can never read it.

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

  // ---- Collections + membership -----------------------------------------

  // Create a shared collection + the owner's own membership (their wrapped key).
  app.post("/shared/create", requireAuth, async (c) => {
    const userId = c.get("userId");
    const b = await c.req.json().catch(() => null);
    const { strandId, ephemeralPub, wrappedDEK } = b ?? {};
    if (typeof strandId !== "string" || typeof ephemeralPub !== "string" || !wrappedDEK) {
      return c.json({ error: "missing fields" }, 400);
    }
    const exists = await c.env.DB.prepare("SELECT strand_id FROM shared_strands WHERE strand_id = ?")
      .bind(strandId)
      .first();
    if (exists) return c.json({ error: "strand already exists" }, 409);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO shared_strands (strand_id, owner_id, created_at) VALUES (?, ?, ?)").bind(
        strandId,
        userId,
        now
      ),
      c.env.DB.prepare(
        "INSERT INTO strand_members (strand_id, user_id, role, ephemeral_pub, wrapped_dek, dek_epoch, added_at) VALUES (?, ?, 'owner', ?, ?, 1, ?)"
      ).bind(strandId, userId, ephemeralPub, JSON.stringify(wrappedDEK), now),
    ]);
    return c.json({ ok: true });
  });

  // Invite a member (any member can; they hold the key to wrap for the invitee).
  app.post("/shared/:id/invite", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const b = await c.req.json().catch(() => null);
    const email = (b?.memberEmail ?? "").trim().toLowerCase();
    const { ephemeralPub, wrappedDEK, dekEpoch } = b ?? {};
    if (!email || typeof ephemeralPub !== "string" || !wrappedDEK || typeof dekEpoch !== "number") {
      return c.json({ error: "missing fields" }, 400);
    }
    const member = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (!member) return c.json({ error: "No account for that email." }, 404);
    await c.env.DB.prepare(
      `INSERT INTO strand_members (strand_id, user_id, role, ephemeral_pub, wrapped_dek, dek_epoch, added_at)
       VALUES (?, ?, 'member', ?, ?, ?, ?)
       ON CONFLICT(strand_id, user_id) DO UPDATE SET ephemeral_pub = excluded.ephemeral_pub, wrapped_dek = excluded.wrapped_dek, dek_epoch = excluded.dek_epoch`
    )
      .bind(strandId, member.id, ephemeralPub, JSON.stringify(wrappedDEK), dekEpoch, Date.now())
      .run();
    return c.json({ ok: true, userId: member.id });
  });

  // Members + their public keys (for re-wrapping / rotation).
  app.get("/shared/:id/members", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const rows = await c.env.DB.prepare(
      "SELECT m.user_id, m.role, u.email, u.identity_pub FROM strand_members m JOIN users u ON u.id = m.user_id WHERE m.strand_id = ?"
    )
      .bind(strandId)
      .all<{ user_id: string; role: string; email: string; identity_pub: string | null }>();
    return c.json({
      members: (rows.results ?? []).map((r) => ({
        userId: r.user_id,
        role: r.role,
        email: r.email,
        identityPublicKey: r.identity_pub,
      })),
    });
  });

  // Collections I'm a member of, each with MY wrapped key.
  app.get("/shared/mine", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT s.strand_id, s.owner_id, m.role, m.ephemeral_pub, m.wrapped_dek, m.dek_epoch FROM strand_members m JOIN shared_strands s ON s.strand_id = m.strand_id WHERE m.user_id = ?"
    )
      .bind(c.get("userId"))
      .all<{
        strand_id: string;
        owner_id: string;
        role: string;
        ephemeral_pub: string;
        wrapped_dek: string;
        dek_epoch: number;
      }>();
    return c.json({
      strands: (rows.results ?? []).map((r) => ({
        strandId: r.strand_id,
        ownerId: r.owner_id,
        role: r.role,
        ephemeralPub: r.ephemeral_pub,
        wrappedDEK: JSON.parse(r.wrapped_dek),
        dekEpoch: r.dek_epoch,
      })),
    });
  });

  // ---- Shared sync (membership-gated, LWW like the base) ------------------

  app.post("/shared/:id/push", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const b = await c.req.json().catch(() => null);
    const changes = b?.changes;
    if (!Array.isArray(changes)) return c.json({ error: "changes must be an array" }, 400);
    if (changes.length > MAX_PUSH) return c.json({ error: `too many changes (max ${MAX_PUSH})` }, 400);
    for (const ch of changes) if (!validSharedChange(ch)) return c.json({ error: "malformed change" }, 400);
    let applied = 0;
    if (changes.length > 0) {
      const base = await maxSharedSeq(c.env.DB, strandId);
      const stmts = changes.map((ch: any, i: number) =>
        c.env.DB.prepare(UPSERT_SHARED).bind(
          strandId,
          ch.kind,
          ch.id,
          ch.createdAt,
          ch.updatedAt,
          ch.deleted ? 1 : 0,
          JSON.stringify(ch.content),
          ch.dekEpoch,
          base + i + 1
        )
      );
      const res = await c.env.DB.batch(stmts);
      applied = res.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
    }
    return c.json({ applied, cursor: await maxSharedSeq(c.env.DB, strandId) });
  });

  app.get("/shared/:id/pull", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const since = Math.max(0, Number(c.req.query("since") ?? "0") || 0);
    const rows = await c.env.DB.prepare(
      "SELECT kind, id, created_at, updated_at, deleted, content, dek_epoch, seq FROM shared_objects WHERE strand_id = ? AND seq > ? ORDER BY seq LIMIT ?"
    )
      .bind(strandId, since, PULL_LIMIT)
      .all<{
        kind: string;
        id: string;
        created_at: number;
        updated_at: number;
        deleted: number;
        content: string;
        dek_epoch: number;
        seq: number;
      }>();
    const results = rows.results ?? [];
    const changes = results.map((r) => ({
      kind: r.kind,
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deleted: r.deleted === 1,
      content: JSON.parse(r.content),
      dekEpoch: r.dek_epoch,
    }));
    const cursor = results.length ? results[results.length - 1].seq : since;
    return c.json({ changes, cursor, more: results.length === PULL_LIMIT });
  });

  // ---- Leaving + removing ------------------------------------------------

  app.post("/shared/:id/leave", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    await c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ? AND user_id = ?")
      .bind(strandId, c.get("userId"))
      .run();
    return c.json({ ok: true });
  });

  // Owner removes a member. (Key rotation for future secrecy is client-driven.)
  app.post("/shared/:id/remove", requireAuth, async (c) => {
    const userId = c.get("userId");
    const strandId = c.req.param("id")!;
    const s = await c.env.DB.prepare("SELECT owner_id FROM shared_strands WHERE strand_id = ?")
      .bind(strandId)
      .first<{ owner_id: string }>();
    if (!s || s.owner_id !== userId) return c.json({ error: "only the owner can remove members" }, 403);
    const b = await c.req.json().catch(() => null);
    const target = b?.userId;
    if (typeof target !== "string" || target === userId) return c.json({ error: "bad target" }, 400);
    await c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ? AND user_id = ?")
      .bind(strandId, target)
      .run();
    // A removal triggers a client-side re-key, so any outstanding invite links
    // (which carry the OLD key) must die — a new one can be made after.
    await c.env.DB.prepare("UPDATE strand_invites SET revoked = 1 WHERE strand_id = ?").bind(strandId).run();
    return c.json({ ok: true });
  });

  // ---- Invite links ------------------------------------------------------
  // We hold only opaque ciphertext (the key wrapped with the link's wrapKey) and a
  // hash of the joinProof. We can neither read the collection nor forge a join.

  app.post("/shared/:id/invite-link", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const b = await c.req.json().catch(() => null);
    const { inviteId, wrappedDEK, joinProofHash, dekEpoch, expiresAt, maxUses } = b ?? {};
    if (
      typeof inviteId !== "string" ||
      !isCipherBlob(wrappedDEK) ||
      typeof joinProofHash !== "string" ||
      typeof dekEpoch !== "number" ||
      typeof expiresAt !== "number"
    ) {
      return c.json({ error: "missing fields" }, 400);
    }
    const mu = typeof maxUses === "number" && maxUses > 0 ? Math.min(Math.floor(maxUses), 1000) : 20;
    await c.env.DB.prepare(
      `INSERT INTO strand_invites (invite_id, strand_id, created_by, wrapped_dek, join_proof_hash, dek_epoch, expires_at, revoked, max_uses, uses, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`
    )
      .bind(
        inviteId,
        strandId,
        c.get("userId"),
        JSON.stringify(wrappedDEK),
        joinProofHash,
        dekEpoch,
        expiresAt,
        mu,
        Date.now()
      )
      .run();
    return c.json({ ok: true, inviteId });
  });

  // Redeem a link: prove possession of the joinProof, get back the wrapped key to
  // unwrap client-side.
  app.post("/shared/join/claim", requireAuth, async (c) => {
    const b = await c.req.json().catch(() => null);
    const { inviteId, joinProof } = b ?? {};
    if (typeof inviteId !== "string" || typeof joinProof !== "string") {
      return c.json({ error: "missing fields" }, 400);
    }
    const inv = await c.env.DB.prepare("SELECT * FROM strand_invites WHERE invite_id = ?")
      .bind(inviteId)
      .first<InviteRow>();
    if (!inv) return c.json({ error: "This invite link isn't valid." }, 404);
    if (inv.revoked) return c.json({ error: "This invite link was turned off." }, 410);
    if (inv.expires_at < Date.now()) return c.json({ error: "This invite link has expired." }, 410);
    if (inv.uses >= inv.max_uses) return c.json({ error: "This invite link has been used up." }, 410);
    if ((await sha256B64(b64ToBytes(joinProof))) !== inv.join_proof_hash) {
      return c.json({ error: "This invite link isn't valid." }, 403);
    }
    return c.json({ strandId: inv.strand_id, wrappedDEK: JSON.parse(inv.wrapped_dek), dekEpoch: inv.dek_epoch });
  });

  // …then register the membership (key re-wrapped to the joiner's identity key).
  app.post("/shared/join/finish", requireAuth, async (c) => {
    const userId = c.get("userId");
    const b = await c.req.json().catch(() => null);
    const { inviteId, joinProof, ephemeralPub, wrappedDEK } = b ?? {};
    // wrappedDEK here is the key re-wrapped to the joiner's identity key — a
    // WrappedKey (base64 strings), like every member wrap, not a CipherBlob.
    if (
      typeof inviteId !== "string" ||
      typeof joinProof !== "string" ||
      typeof ephemeralPub !== "string" ||
      !wrappedDEK
    ) {
      return c.json({ error: "missing fields" }, 400);
    }
    const inv = await c.env.DB.prepare("SELECT * FROM strand_invites WHERE invite_id = ?")
      .bind(inviteId)
      .first<InviteRow>();
    if (!inv) return c.json({ error: "This invite link isn't valid." }, 404);
    if (inv.revoked || inv.expires_at < Date.now() || inv.uses >= inv.max_uses) {
      return c.json({ error: "This invite link is no longer valid." }, 410);
    }
    if ((await sha256B64(b64ToBytes(joinProof))) !== inv.join_proof_hash) {
      return c.json({ error: "This invite link isn't valid." }, 403);
    }
    const already = await membership(c.env.DB, inv.strand_id, userId);
    if (!already) {
      await c.env.DB.prepare(
        `INSERT INTO strand_members (strand_id, user_id, role, ephemeral_pub, wrapped_dek, dek_epoch, added_at)
         VALUES (?, ?, 'member', ?, ?, ?, ?)
         ON CONFLICT(strand_id, user_id) DO UPDATE SET ephemeral_pub = excluded.ephemeral_pub, wrapped_dek = excluded.wrapped_dek, dek_epoch = excluded.dek_epoch`
      )
        .bind(inv.strand_id, userId, ephemeralPub, JSON.stringify(wrappedDEK), inv.dek_epoch, Date.now())
        .run();
      await c.env.DB.prepare("UPDATE strand_invites SET uses = uses + 1 WHERE invite_id = ?").bind(inviteId).run();
    }
    return c.json({ ok: true, strandId: inv.strand_id });
  });

  // The links out for a collection (never the secrets — only their status).
  app.get("/shared/:id/invites", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    const rows = await c.env.DB.prepare(
      "SELECT invite_id, expires_at, revoked, max_uses, uses, created_at FROM strand_invites WHERE strand_id = ? ORDER BY created_at DESC"
    )
      .bind(strandId)
      .all<{
        invite_id: string;
        expires_at: number;
        revoked: number;
        max_uses: number;
        uses: number;
        created_at: number;
      }>();
    return c.json({
      invites: (rows.results ?? []).map((r) => ({
        inviteId: r.invite_id,
        expiresAt: r.expires_at,
        revoked: r.revoked === 1,
        maxUses: r.max_uses,
        uses: r.uses,
        createdAt: r.created_at,
      })),
    });
  });

  // Turn a link off.
  app.post("/shared/:id/invites/:inviteId/revoke", requireAuth, async (c) => {
    const strandId = c.req.param("id")!;
    const inviteId = c.req.param("inviteId")!;
    if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
    await c.env.DB.prepare("UPDATE strand_invites SET revoked = 1 WHERE invite_id = ? AND strand_id = ?")
      .bind(inviteId, strandId)
      .run();
    return c.json({ ok: true });
  });
}
