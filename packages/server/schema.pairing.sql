-- schema.pairing.sql — the table QR device-linking needs.
--
-- Canonical DDL, shared by every app that turns pairing on
-- (createServer({ pairing: true })). Apply it to an app's D1 alongside its
-- own schema.sql, e.g. from apps/<app>/server:
--
--   npx wrangler d1 execute <db> --remote --file=../../../packages/server/schema.pairing.sql
--
-- Unlike sharing/recovery, this table has no foreign key to `users` on its
-- primary row — the whole point is that the NEW device has no account yet
-- when it creates one. `delivered_by` is filled in once an existing,
-- authenticated device hands over a wrapped payload.
--
-- What the server can see here: that some device asked to be linked, and
-- (once delivered) which account linked it and when. What it can never see:
-- the account's DEK, its auth token, or any vault content — `payload` is
-- opaque ECIES ciphertext the whole time, same threat model as
-- recovery_circles.recovery_wrapped_dek.

CREATE TABLE IF NOT EXISTS pairing_requests (
  id            TEXT PRIMARY KEY,       -- client-generated, high-entropy (crypto.randomUUID())
  public_key    TEXT NOT NULL,          -- the new device's throwaway ECDH public key
  status        TEXT NOT NULL,          -- 'pending' | 'delivered' | 'cancelled'
  payload       TEXT,                   -- JSON WrappedBytes once delivered; null until then
  delivered_by  TEXT REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  delivered_at  INTEGER
);
CREATE INDEX IF NOT EXISTS pairing_requests_expiry ON pairing_requests(expires_at);
