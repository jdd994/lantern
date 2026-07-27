// index.ts — Grove sync server.
// The base (CORS, auth, rate limits, quotas, register / login / vault / me /
// delete / sync) is the shared factory (@lantern/server), which also mounts the
// identity/key directory, shared trees + invite links (sharing: true), and
// guardian-based social recovery (recovery: true). Grove adds only media (R2
// keepsake scans). Stores opaque ciphertext + non-secret metadata only — from
// birthdates alone a server could sketch a family, which is exactly why every
// date lives inside the ciphertext (see apps/grove/src/lib/db.ts).
import {
  createServer, requireAuth, membership,
  type ServerContext,
} from "@lantern/server";

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  TOKEN_SECRET: string;
  ALLOWED_ORIGIN: string;
};

const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // per blob — images compress client-side; PDFs cap at 10 MB there
// Media byte ceiling per user (R2). Object-count/text quotas live in the factory.
const MAX_USER_MEDIA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB of scans and photos

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

// Delete every R2 object under a prefix (a user's scans, or a shared tree's).
async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length) await bucket.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// Grove's account-delete cascade: private objects + vault + private scans in
// R2 + shared-tree membership. It refuses (409) while the user still OWNS a
// shared tree others are in — deleting that would take a family's co-authored
// tree away from the family. Trees they own alone are deleted in full.
async function deleteGroveAccount(c: ServerContext<Env>, userId: string): Promise<Response> {
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
      error: "You still own shared tree(s) that other family members are in. Hand them over or remove the other members first, so nobody loses the family's tree.",
      trees: blocking,
    }, 409);
  }

  for (const treeId of soloOwned) {
    await deleteR2Prefix(c.env.MEDIA, `s/${treeId}/`);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM shared_objects WHERE strand_id = ?").bind(treeId),
      c.env.DB.prepare("DELETE FROM strand_invites WHERE strand_id = ?").bind(treeId),
      c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ?").bind(treeId),
      c.env.DB.prepare("DELETE FROM shared_strands WHERE strand_id = ?").bind(treeId),
    ]);
  }

  await deleteR2Prefix(c.env.MEDIA, `u/${userId}/`);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM strand_members WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM objects WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM vaults WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM user_usage WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  return c.json({ ok: true });
}

const app = createServer<Env>({
  kinds: ["person", "union", "keepsake"],
  service: "grove-server",
  // /shared/*, /identity and /keys come from @lantern/server — a shared tree
  // rides the same machinery as a shared strand or kitchen.
  sharing: true,
  // /recovery/* — guardian-based social recovery. Requires schema.recovery.sql.
  recovery: true,
  recoveryMinDelayMs: 24 * 3_600_000,
  deleteAccount: deleteGroveAccount,
});

// ==== Grove-specific routes (added onto the shared base app) ================

// ---- Media: keepsake scans and photos --------------------------------------
// R2 stores an opaque blob: iv||ciphertext, already encrypted on the device
// with the vault key (or a shared tree's DEK). Type is non-secret metadata so
// the client can render it. Same wire format as Driftless's polaroids.

app.put("/media/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id")!;
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty upload" }, 400);
  if (body.byteLength > MAX_MEDIA_BYTES) return c.json({ error: "scan too large" }, 413);
  const type = c.req.query("type") || "application/octet-stream";
  const key = `u/${userId}/${id}`;

  // Idempotent: scans are write-once (a client uuid per blob), so a retried
  // upload of one already stored must not be double-counted against the quota.
  const already = await c.env.MEDIA.head(key);
  if (already) return c.json({ ok: true });

  if ((await mediaUsage(c.env.DB, userId)) + body.byteLength > MAX_USER_MEDIA_BYTES) {
    return c.json({ error: "This account has reached its keepsake storage limit." }, 413);
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

// Free the storage when a keepsake's scan is removed. Idempotent.
app.delete("/media/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const key = `u/${userId}/${c.req.param("id")!}`;
  // Read the size before deleting so the quota counter can be credited back.
  const obj = await c.env.MEDIA.head(key);
  await c.env.MEDIA.delete(key);
  if (obj) await addMediaUsage(c.env.DB, userId, -obj.size);
  return c.json({ ok: true });
});

// Shared-tree scans: same as above but encrypted with the tree DEK and gated
// by membership. Keyed s/<treeId>/<mediaId>.
app.put("/shared/:id/media/:mid", requireAuth, async (c) => {
  const treeId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, treeId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty upload" }, 400);
  if (body.byteLength > MAX_MEDIA_BYTES) return c.json({ error: "scan too large" }, 413);
  const type = c.req.query("type") || "application/octet-stream";
  await c.env.MEDIA.put(`s/${treeId}/${mid}`, body, { httpMetadata: { contentType: type } });
  return c.json({ ok: true });
});

app.get("/shared/:id/media/:mid", requireAuth, async (c) => {
  const treeId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, treeId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  const obj = await c.env.MEDIA.get(`s/${treeId}/${mid}`);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=31536000",
    },
  });
});

app.delete("/shared/:id/media/:mid", requireAuth, async (c) => {
  const treeId = c.req.param("id")!;
  const mid = c.req.param("mid")!;
  if (!(await membership(c.env.DB, treeId, c.get("userId")))) return c.json({ error: "not a member" }, 403);
  await c.env.MEDIA.delete(`s/${treeId}/${mid}`);
  return c.json({ ok: true });
});

export default app;
