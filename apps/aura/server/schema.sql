-- schema.sql — Aura's feedback box. Two tables, nothing else: this Worker has
-- no accounts, no lights, no scenes. See src/index.ts.

CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  message    TEXT NOT NULL,
  contact    TEXT  -- optional, only if they want a reply
);

-- Fixed-window rate limiting for the open /feedback route.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,        -- "feedback:<ip>:<windowBucket>"
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_by_expiry ON rate_limits(expires_at);
