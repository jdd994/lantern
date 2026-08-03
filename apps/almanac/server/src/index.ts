// index.ts — Almanac sync server.
// The base (CORS, auth, rate limits, quotas, register / login / vault / me /
// delete / sync) is the shared factory (@lantern/server), which also mounts the
// identity/key directory, shared calendars (sharing: true), and guardian-based
// social recovery (recovery: true). Almanac adds nothing of its own — a
// calendar of plans is a thin skin over the shared core, same as Manifest.
// Stores opaque ciphertext + non-secret metadata only: never a title, a date,
// a place, or who's going — even which calendar a record belongs to lives
// inside the ciphertext (see apps/almanac/src/lib/db.ts).
import { createServer, type ServerContext } from "@lantern/server";

type Env = {
  DB: D1Database;
  TOKEN_SECRET: string;
  ALLOWED_ORIGIN: string;
};

// Almanac's account-delete cascade: private objects + vault + shared-calendar
// membership. It refuses (409) while the user still OWNS a shared calendar
// others are in — deleting that would take the circle's calendar away from the
// circle. Calendars they own alone are deleted in full. (Same shape as
// Manifest's, which took it from Grove's, minus R2.)
async function deleteAlmanacAccount(c: ServerContext<Env>, userId: string): Promise<Response> {
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
      error: "You still own shared calendar(s) that other people are keeping with you. Remove the other members first, so nobody loses the circle's calendar.",
      calendars: blocking,
    }, 409);
  }

  for (const calId of soloOwned) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM shared_objects WHERE strand_id = ?").bind(calId),
      c.env.DB.prepare("DELETE FROM strand_invites WHERE strand_id = ?").bind(calId),
      c.env.DB.prepare("DELETE FROM strand_members WHERE strand_id = ?").bind(calId),
      c.env.DB.prepare("DELETE FROM shared_strands WHERE strand_id = ?").bind(calId),
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
  kinds: ["calendar", "happening", "mark"],
  service: "almanac-server",
  // /shared/*, /identity and /keys come from @lantern/server — a shared
  // calendar rides the same machinery as a shared strand, kitchen, list, or
  // family tree.
  sharing: true,
  // /recovery/* — guardian-based social recovery. Requires schema.recovery.sql.
  recovery: true,
  recoveryMinDelayMs: 24 * 3_600_000,
  deleteAccount: deleteAlmanacAccount,
});

export default app;
