-- Manifest sync server schema.
-- The server stores OPAQUE CIPHERTEXT and non-secret metadata only. It never
-- sees plaintext, the passphrase, or any encryption key. Same generic shape as
-- its siblings (ported from Driftless via Ballast/Grove); shared strands and
-- social recovery ride packages/server/schema.sharing.sql + schema.recovery.sql.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,     -- random uuid
  email         TEXT UNIQUE NOT NULL,
  pw_hash       TEXT NOT NULL,        -- PBKDF2(password) — login secret only
  pw_salt       TEXT NOT NULL,
  identity_pub  TEXT,                 -- public half of the identity keypair
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  salt        TEXT NOT NULL,          -- JSON number[] — non-secret KDF salt
  verifier    TEXT NOT NULL,          -- JSON CipherBlob — checks the passphrase
  iterations  INTEGER NOT NULL,
  identity_priv_wrapped TEXT,         -- identity private key, wrapped by the vault key (opaque)
  currency    TEXT,                   -- unused by Manifest; kept for a shared server shape
  wrapped_dek TEXT,                   -- envelope: the data key (DEK) wrapped by the passphrase-derived KEK (opaque)
  created_at  INTEGER NOT NULL
);

-- Synced objects. One table for all record kinds — 'list', 'item'. `content`
-- is always an opaque JSON CipherBlob; even which list an item belongs to
-- lives inside it. `meta` is a passthrough the server never inspects (unused
-- by Manifest — nothing rides outside the ciphertext). `seq` is a per-user
-- monotonic counter; the pull cursor is "everything with seq > since".
CREATE TABLE IF NOT EXISTS objects (
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,          -- JSON CipherBlob (opaque)
  meta        TEXT,                   -- JSON of extra non-secret fields (opaque)
  seq         INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS objects_by_seq ON objects(user_id, seq);

-- Per-user usage (storage quota accounting). media_bytes unused by Manifest
-- (no blobs); kept for the shared factory's shape.
CREATE TABLE IF NOT EXISTS user_usage (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  media_bytes INTEGER NOT NULL DEFAULT 0
);

-- Fixed-window rate-limit counters keyed by action + IP + time bucket.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_by_expiry ON rate_limits(expires_at);
