# Architecture

`lantern` is a small family of local-first, end-to-end-encrypted apps that share
one core. The rule: **the core is mechanism, each app is its own flavor.** Anything
that is the same everywhere (crypto, sync, the server) lives in a shared package;
anything that is genuinely the app (what it stores, how it looks, its domain math)
stays in the app.

```
packages/
  core     @lantern/core     headless — no React, no app policy
    crypto      envelope encryption (DEK/KEK), verifier, identity keys, biometric key I/O
    biometric   WebAuthn-PRF quick-unlock (enroll + unlock)
    vault       the vault lifecycle as PURE functions: createVault / openVault
                (with legacy→envelope migration) / rewrapVault / verifyDEK  [unit-tested]
    sync        createSyncEngine(adapter): pull (LWW) + push (dirty, chunked);
                createMediaSync(adapter): upload dirty blobs
    api         createApiClient(baseUrl): register/login/vault/updateVault/delete/push/pull
  server   @lantern/server   Workers + D1
    auth        password hashing (PBKDF2) + HMAC token sign/verify  (a secret SEPARATE
                from the passphrase)
    createServer({ kinds, service, deleteAccount? })  the whole base sync server
  ui       @lantern/ui       React, themed by each app's own tokens
    Sheet, useTheme, ThemePicker

apps/
  driftless   a quiet place to catch your thoughts   (journal · strands · sharing)
  ballast     steady footing with your money          (net worth · trust ladder)
  hearth      tending and nourishing yourself gently  (food log · body · recipes)
```

## How an app is built on the core

Each app supplies **thin adapters + config**, then its own UI and domain logic:

- **Crypto adapter** (`src/lib/crypto.ts`) — `export * from "@lantern/core/crypto"`
  plus the app's bound `VERIFIER_TEXT` and (Driftless) its sharing crypto.
- **Biometric adapter** — binds the app's WebAuthn name + `PRF_SALT`.
- **DB** (`src/lib/db.ts`) — the app's IndexedDB stores + the generic sync accessors
  (`getStoredByKind` / `putStoredByKind` / `clearDirtyByKind` / `dirtyRecords`).
- **API** (`src/lib/api.ts`) — `createApiClient(APP_URL)`; Driftless adds its
  identity/media/sharing endpoints on the shared `req`.
- **Sync** (`src/lib/sync.ts`) — `createSyncEngine(adapter)` supplying the app's
  `kinds`, its `meta` extractors, store access, and network calls.
- **Server** (`server/src/index.ts`) — `createServer({ kinds, service })`; Driftless
  passes a `deleteAccount` cascade hook and adds media/sharing routes on top.
- **Hook** (`useJournal` / `useLedger` / `useHearth`) — the only place state, IO,
  and the decrypted key meet. Its setup/unlock/change-passphrase delegate to
  `@lantern/core/vault`; the rest (CRUD, derived state, connect/sync flows) is the
  app's own.
- **UI** — the app's components + palette, with `<Sheet>`/`<ThemePicker>` from
  `@lantern/ui` where useful.

## Per-app "taste" — and the two constants that must NEVER change

Each app supplies: its record **kinds**, which plaintext fields ride outside the
ciphertext as **`meta`**, its **palette** + vibe presets, its **help copy**, and:

- **`VERIFIER_TEXT`** (e.g. `"ballast-ok"`) — the token the vault verifier is built
  from.
- **`PRF_SALT`** — the per-app WebAuthn PRF salt (Hearth intentionally shares
  Ballast's exact bytes for historical reasons).

**Changing either would lock users out of existing vaults / biometric enrollments.
They are frozen forever.**

## What is deliberately NOT shared

- **The account/sync lifecycle hook** (connect / sign-in / disconnect / delete /
  runSync). The apps diverge most here — boolean vs `string|null` returns, different
  reload steps, currency vs identity vs sharing state — so a shared hook would be a
  config-heavy abstraction that hurts more than it helps. Left per-app by choice.
- **Driftless's sharing crypto** (ECIES / invite links) and its server extension
  (media/R2, shared strands, invites, feedback). Only Driftless needs them today;
  they move to the core if a second app ever does.

## Invariants (the whole point)

1. Plaintext never leaves memory; only ciphertext is stored or synced.
2. The passphrase never leaves the device and is never sent to any server. There is
   no server-side reset.
3. **Envelope encryption:** a random data key (DEK) encrypts everything; the
   passphrase only derives a KEK that *wraps* the DEK. Changing the passphrase
   re-wraps the DEK — no data is re-encrypted, and other devices keep working.
4. The account (login) secret and the passphrase are two different secrets doing two
   different jobs. The server authenticates the account and stores opaque blobs; the
   passphrase decrypts them, on-device only.

## Develop & deploy

```bash
npm install                 # once, at the root — installs every workspace
npm run dev   -w ballast     # a dev server for one app
npm run build -w hearth      # tsc + vite build
npm run test  -w driftless   # vitest
npx vitest run packages/core # the shared-core unit tests (vault, envelope)
```

Each app builds and **deploys independently** to its own Cloudflare Pages project +
Worker + D1 + custom domain (driftless.page · ballast.gold · hearth.garden). The
monorepo is a source reorganization only; it does not change any deploy target.
