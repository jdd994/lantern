// index.ts — Driftless sync server.
// The base (CORS, auth, rate limits, quotas, register / login / vault / me /
// delete / sync) is the shared factory (@lantern/server), which also mounts the
// identity/key directory, shared strands + invite links (sharing: true), and
// guardian-based social recovery (recovery: true). Driftless adds its own
// routes on top: media (R2 photos) and feedback. Stores opaque ciphertext +
// non-secret metadata only.
import {
  createServer, requireAuth, withinRateLimit, TOO_MANY, verifyToken, membership,
  type ServerContext,
} from "@lantern/server";

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  TOKEN_SECRET: string;
  ALLOWED_ORIGIN: string;
};

const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // 8 MB — per photo (compressed client-side)
// Media byte ceiling per user (R2). Object-count/text quotas live in the factory.
const MAX_USER_MEDIA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB of photos

// Running media byte total, kept in user_usage (R2 has no cheap SUM). Absent = 0.
async function mediaUsage(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT media_bytes AS b FROM user_usage WHERE user_id = ?")
    .bind(userId)
    .first<{ b: number }>();
  return row?.b ?? 0;
}

async function addMediaUsage(db: D1Database, userId: string, delta: number): Promise<void> {
  // Upsert, clamped at zero so a stray decrement can never go negative.
  await db
    .prepare(
      "INSERT INTO user_usage (user_id, media_bytes) VALUES (?, MAX(0, ?)) " +
        "ON CONFLICT(user_id) DO UPDATE SET media_bytes = MAX(0, media_bytes + ?)"
    )
    .bind(userId, delta, delta)
    .run();
}

// Delete every R2 object under a prefix (a user's photos, or a strand's).
async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length) await bucket.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// Driftless's account-delete cascade (used as the factory's deleteAccount hook):
// private objects + vault + private photos in R2 + shared-strand membership. It
// refuses (409) while the user still OWNS a shared strand others are in — deleting
// that would destroy someone else's copy of a shared memory. Strands they own
// alone are deleted in full.
async function deleteDriftlessAccount(c: ServerContext<Env>, userId: string): Promise<Response> {
  const owned = (await c.env.DB.prepare("SELECT strand_id FROM shared_strands WHERE owner_id = ?")
    .bind(userId).all<{ strand_id: string }>()).results ?? [];

  const blocking: string[] = [];
  const soloOwned: string[] = [];
  for (const { strand_id } of owned) {
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM strand_members WHERE strand_id = ? AND user_id <> ?")
      .bind(strand_id, userId).first<{ n: number }>();
    ((row?.n ?? 0) > 0 ? blocking : soloOwned).push(strand_id);
  }
  if (blocking.length > 0) {
    return c.json({
      error: "You still own shared strand(s) that other people are in. Hand them over or remove the other members first, so nobody else loses a shared strand.",
      strands: blocking,
    }, 409);
  }

  for (const strandId of soloOwned) {
    await deleteR2Prefix(c.env.MEDIA, `s/${strandId}/`);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM shared_objects WHERE strand_id = ?").bind(strandId),
      c.env.DB.prepare("DELETE FROM strand_invites WHERE strand_id = ?").bind(strandId),
      c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ?").bind(strandId),
      c.env.DB.prepare("DELETE FROM shared_strands WHERE strand_id = ?").bind(strandId),
    ]);
  }

  await deleteR2Prefix(c.env.MEDIA, `u/${userId}/`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM strand_members WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM objects WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM vaults WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM user_usage WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("UPDATE feedback SET user_id = NULL WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  return c.json({ ok: true });
}

const app = createServer<Env>({
  kinds: ["entry", "strand"],
  service: "driftless-server",
  // /shared/*, /identity and /keys now come from @lantern/server — same routes,
  // same SQL, same wire format. Below, Driftless keeps only what's truly its own:
  // media (R2) and the feedback box.
  sharing: true,
  // /recovery/* — guardian-based social recovery. Requires schema.recovery.sql
  // applied to this app's D1 (see packages/server/schema.recovery.sql).
  recovery: true,
  recoveryMinDelayMs: 24 * 3_600_000,
  deleteAccount: deleteDriftlessAccount,
});

// ==== Driftless-specific routes (added onto the shared base app) ============

// ---- Media (M1: personal photos) -----------------------------------------
// R2 stores an opaque blob: iv||ciphertext, already encrypted on the device
// with the vault key. Keyed by owner; only the owner can read it back. Type is
// non-secret metadata so the client can render it. See MEDIA_PLAN.md.

app.put("/media/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id")!;
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty upload" }, 400);
  if (body.byteLength > MAX_MEDIA_BYTES) return c.json({ error: "image too large" }, 413);
  const type = c.req.query("type") || "application/octet-stream";
  const key = `u/${userId}/${id}`;

  // Idempotent: photos are write-once (a client uuid per image), so a retried
  // upload of one already stored must not be double-counted against the quota.
  const already = await c.env.MEDIA.head(key);
  if (already) return c.json({ ok: true });

  if ((await mediaUsage(c.env.DB, userId)) + body.byteLength > MAX_USER_MEDIA_BYTES) {
    return c.json({ error: "This account has reached its photo storage limit." }, 413);
  }

  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  await addMediaUsage(c.env.DB, userId, body.byteLength);
  return c.json({ ok: true });
});

app.get("/media/:id", requireAuth, async (c) => {
  const id = c.req.param("id")!;
  const obj = await c.env.MEDIA.get(`u/${c.get("userId")}/${id}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=31536000",
    },
  });
});

// Free the storage when a photo is removed (M3). Idempotent.
app.delete("/media/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const key = `u/${userId}/${c.req.param("id")!}`;
  // Read the size before deleting so the quota counter can be credited back.
  const obj = await c.env.MEDIA.head(key);
  await c.env.MEDIA.delete(key);
  if (obj) await addMediaUsage(c.env.DB, userId, -obj.size);
  return c.json({ ok: true });
});

// Shared-strand photos (M2): same as above but encrypted with the strand DEK
// and gated by membership. Keyed s/<strandId>/<mediaId>.
app.put("/shared/:id/media/:mid", requireAuth, async (c) => {
  const strandId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty upload" }, 400);
  if (body.byteLength > MAX_MEDIA_BYTES) return c.json({ error: "image too large" }, 413);
  const type = c.req.query("type") || "application/octet-stream";
  await c.env.MEDIA.put(`s/${strandId}/${mid}`, body, { httpMetadata: { contentType: type } });
  return c.json({ ok: true });
});

app.get("/shared/:id/media/:mid", requireAuth, async (c) => {
  const strandId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  const obj = await c.env.MEDIA.get(`s/${strandId}/${mid}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=31536000",
    },
  });
});

app.delete("/shared/:id/media/:mid", requireAuth, async (c) => {
  const strandId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, strandId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  await c.env.MEDIA.delete(`s/${strandId}/${mid}`);
  return c.json({ ok: true });
});

// A calm "note to the maker". Open (no account needed) so even a first-time
// visitor can send a word. Stored separately from journal data; it's a plain
// message, never touching any ciphertext. Optional token just attributes it.
app.post("/feedback", async (c) => {
  if (!(await withinRateLimit(c, "feedback", 8, 3_600_000))) return c.json({ error: TOO_MANY }, 429);
  const b = await c.req.json().catch(() => null);
  const message = (b?.message ?? "").toString().trim();
  if (!message) return c.json({ error: "Say a little something first." }, 400);
  if (message.length > 4000) return c.json({ error: "That's a bit long — trim it a touch." }, 400);
  const contact = (b?.contact ?? "").toString().trim().slice(0, 200) || null;
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = token ? await verifyToken(token, c.env.TOKEN_SECRET) : null;
  await c.env.DB.prepare(
    "INSERT INTO feedback (id, created_at, message, contact, user_id) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), Date.now(), message.slice(0, 4000), contact, userId)
    .run();
  return c.json({ ok: true });
});

// ---- Sync (Phase 3) ------------------------------------------------------
// The server stores each entry's ciphertext + metadata and assigns a per-user
// monotonic `seq`. Push upserts with last-write-wins by updatedAt; pull returns
// everything with seq greater than the client's cursor. No plaintext is ever
// seen — content is an opaque CipherBlob.

export default app;
