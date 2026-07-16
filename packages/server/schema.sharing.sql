-- schema.sharing.sql — the tables the sharing capability needs.
--
-- Canonical DDL, shared by every app that turns sharing on
-- (createServer({ sharing: true })). Apply it to an app's D1 alongside its own
-- schema.sql, e.g. from apps/<app>/server:
--
--   npx wrangler d1 execute <db> --remote --file=../../../packages/server/schema.sharing.sql
--
-- It requires the base schema's `users` (for identity_pub) and is additive:
-- every statement is IF NOT EXISTS, so applying it to a database that already
-- has these tables (Driftless) is a no-op.
--
-- What the server can see here: who is in which collection, when things changed,
-- and how big they are. What it can never see: the contents (encrypted with a key
-- it never holds) or any member's private key. The vocabulary is "strand" —
-- Driftless's word, kept because it's load-bearing for a live deployment with real
-- data; renaming would be a migration, not a refactor.

-- A shared collection. `strand_id` is chosen by the client.
CREATE TABLE IF NOT EXISTS shared_strands (
  strand_id  TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Who's in it, and their own copy of the collection key — wrapped to their public
-- identity key, so only they can unwrap it. We store it and cannot read it.
CREATE TABLE IF NOT EXISTS strand_members (
  strand_id     TEXT NOT NULL REFERENCES shared_strands(strand_id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL,        -- 'owner' | 'member'
  ephemeral_pub TEXT NOT NULL,        -- for unwrapping the DEK
  wrapped_dek   TEXT NOT NULL,        -- this member's wrapped collection key (JSON)
  dek_epoch     INTEGER NOT NULL,     -- which key version this wrap is for
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (strand_id, user_id)
);

-- The shared contents: opaque ciphertext + a per-collection monotonic `seq` that
-- serves as the pull cursor. `kind` is the app's own record type.
CREATE TABLE IF NOT EXISTS shared_objects (
  strand_id  TEXT NOT NULL REFERENCES shared_strands(strand_id),
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  content    TEXT NOT NULL,           -- opaque, DEK-encrypted
  dek_epoch  INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (strand_id, id)
);
CREATE INDEX IF NOT EXISTS shared_objects_by_seq ON shared_objects(strand_id, seq);

-- A shareable link that lets someone join without an email exchange. The link's
-- secret lives in the URL fragment and never reaches us; the client derives a
-- wrapKey (which encrypts the key below — opaque to us) and a joinProof, of which
-- we store only the HASH. So a breach yields neither the collection key nor a way
-- to join.
CREATE TABLE IF NOT EXISTS strand_invites (
  invite_id       TEXT PRIMARY KEY,
  strand_id       TEXT NOT NULL REFERENCES shared_strands(strand_id),
  created_by      TEXT NOT NULL,
  wrapped_dek     TEXT NOT NULL,       -- key encrypted with the link's wrapKey (JSON CipherBlob)
  join_proof_hash TEXT NOT NULL,       -- base64(SHA-256(joinProof))
  dek_epoch       INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  revoked         INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER NOT NULL DEFAULT 20,
  uses            INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS strand_invites_by_strand ON strand_invites(strand_id);
