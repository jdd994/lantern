-- schema.recovery.sql — the tables social recovery needs.
--
-- Canonical DDL, shared by every app that turns recovery on
-- (createServer({ recovery: true })). Apply it to an app's D1 alongside its
-- own schema.sql, e.g. from apps/<app>/server:
--
--   npx wrangler d1 execute <db> --remote --file=../../../packages/server/schema.recovery.sql
--
-- It requires the base schema's `users` and is additive: every statement is
-- IF NOT EXISTS. It also requires identity.ts's /identity + /keys routes
-- (always mounted, not gated by `sharing`) so guardians can look each other up.
--
-- What the server can see here: who is whose guardian, when a recovery
-- request is open, and how many guardians have approved it. What it can
-- never see: a codeword, a plaintext Shamir share, or the DEK — every
-- `wrapped*` column is opaque ciphertext, same threat model as
-- strand_members.wrapped_dek in schema.sharing.sql.

-- One account's recovery configuration. `recovery_wrapped_dek` is the vault's
-- DEK wrapped by the recovery key (RK) whose bytes are Shamir-split below.
CREATE TABLE IF NOT EXISTS recovery_circles (
  user_id              TEXT PRIMARY KEY REFERENCES users(id),
  k                    INTEGER NOT NULL,
  n                    INTEGER NOT NULL,
  delay_ms             INTEGER NOT NULL,
  recovery_wrapped_dek TEXT NOT NULL,   -- JSON CipherBlob
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- One guardian's double-wrapped share of the recovery key. `share_index` is
-- the Shamir x-coordinate (1..n), not secret. `wrapped` is the outer ECIES
-- layer (to the guardian's identity key); the codeword-encrypted share is
-- inside it, opaque to us either way.
CREATE TABLE IF NOT EXISTS recovery_guardians (
  user_id             TEXT NOT NULL REFERENCES users(id),         -- the protected account
  guardian_user_id    TEXT NOT NULL REFERENCES users(id),
  share_index         INTEGER NOT NULL,
  ephemeral_pub       TEXT NOT NULL,
  wrapped             TEXT NOT NULL,   -- JSON WrappedKey
  codeword_salt       TEXT NOT NULL,   -- JSON number[]
  codeword_iterations INTEGER NOT NULL,
  added_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, guardian_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_guardians_share_idx ON recovery_guardians(user_id, share_index);

-- A recovery attempt. `session_pub` is the recovering device's THROWAWAY
-- keypair for this one attempt (never the account's real identity key, which
-- is itself locked). The delay window is enforced server-side: GET
-- /recovery/:id only returns approval material once now >= delay_starts_at +
-- delay_ms.
CREATE TABLE IF NOT EXISTS recovery_requests (
  request_id      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  session_pub     TEXT NOT NULL,
  k               INTEGER NOT NULL,
  delay_ms        INTEGER NOT NULL,
  status          TEXT NOT NULL,   -- 'collecting' | 'pending_delay' | 'cancelled' | 'completed'
  delay_starts_at INTEGER,         -- set when the k-th approval lands
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  cancelled_by    TEXT
);
-- At most one open request per account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS recovery_requests_one_open ON recovery_requests(user_id)
  WHERE status IN ('collecting', 'pending_delay');

-- One guardian's approval of one request: their share, re-wrapped to the
-- requester's session key (never their real identity key — see above). The
-- primary key blocks a guardian from approving the same request twice.
CREATE TABLE IF NOT EXISTS recovery_approvals (
  request_id       TEXT NOT NULL REFERENCES recovery_requests(request_id),
  guardian_user_id TEXT NOT NULL,
  ephemeral_pub    TEXT NOT NULL,
  wrapped          TEXT NOT NULL,   -- JSON WrappedKey
  approved_at      INTEGER NOT NULL,
  PRIMARY KEY (request_id, guardian_user_id)
);
