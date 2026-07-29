// index.ts — Manifest sync server.
// The base (CORS, auth, rate limits, quotas, register / login / vault / me /
// delete / sync) is the shared factory (@lantern/server), which also mounts the
// identity/key directory, shared lists (sharing: true), and guardian-based
// social recovery (recovery: true). Manifest adds nothing of its own — a
// checklist is the thinnest possible skin over the shared core. Stores opaque
// ciphertext + non-secret metadata only: never an item, a title, or who's
// bringing what — even which list a record belongs to lives inside the
// ciphertext (see apps/manifest/src/lib/db.ts).
import { createServer, type ServerContext } from "@lantern/server";

type Env = {
  DB: D1Database;
  TOKEN_SECRET: string;
  ALLOWED_ORIGIN: string;
};

// Manifest's account-delete cascade: private objects + vault + shared-list
// membership. It refuses (409) while the user still OWNS a shared list others
// are in — deleting that would take the group's list away from the group.
// Lists they own alone are deleted in full. (Same shape as Grove's, minus R2.)
async function deleteManifestAccount(c: ServerContext<Env>, userId: string): Promise<Response> {
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
      error: "You still own shared list(s) that other people are packing. Remove the other members first, so nobody loses the group's list.",
      lists: blocking,
    }, 409);
  }

  for (const listId of soloOwned) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM shared_objects WHERE strand_id = ?").bind(listId),
      c.env.DB.prepare("DELETE FROM strand_invites WHERE strand_id = ?").bind(listId),
      c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ?").bind(listId),
      c.env.DB.prepare("DELETE FROM shared_strands WHERE strand_id = ?").bind(listId),
    ]);
  }

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
  kinds: ["list", "item"],
  service: "manifest-server",
  // /shared/*, /identity and /keys come from @lantern/server — a shared list
  // rides the same machinery as a shared strand, kitchen, or family tree.
  sharing: true,
  // /recovery/* — guardian-based social recovery. Requires schema.recovery.sql.
  recovery: true,
  recoveryMinDelayMs: 24 * 3_600_000,
  deleteAccount: deleteManifestAccount,
});

export default app;
