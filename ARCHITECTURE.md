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
  grove       a family tree written together          (hourglass tree · keepsakes · GEDCOM)
  aura        your home's light, following your day   (day rhythm · vibes · automations)
  manifest    the list of what you carry              (shared checklists · claims · clone)
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
- **Hook** (`useJournal` / `useLedger` / `useHearth` / `useGrove` / `useManifest`) — the only place state, IO,
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

## Recovery — the ways back in

The passphrase never leaves the device and the server holds only ciphertext, so
there is **no reset by email** — a reset button would mean the operator could
read the vault (operator-recoverability and operator-readability are the same
property). Instead there are three doors, all built in `@lantern/core` and wired
into every app, presented **bridge-before-cliff** in the UI (lead with the way
back in, then state the trade as the reason the privacy is real):

1. **Biometric quick unlock** (`core/biometric`) — per-device, opt-in. A
   platform passkey's PRF secret wraps the DEK; the wrap never syncs. Enrolling
   two devices is a practical everyday safety net: either device opens the
   vault if the passphrase slips.
2. **Guardians — social recovery** (`core/recovery`) — K-of-N people you trust,
   each holding an encrypted key share unlockable only with their identity key
   *plus* a codeword told out loud, behind a server-enforced delay window.
   Recovery ends by **setting a fresh passphrase** (`setPassphraseFromDEK` —
   the DEK is re-wrapped; nothing is re-encrypted; the old passphrase dies).
   Guardians must hold accounts on the same app; right for the shared apps,
   wrong for a solo vault.
3. **The paper recovery kit** (`core/kit`) — the solo answer, right for a
   Ballast with no circle. A random 130-bit code (Crockford base32, typo- and
   case-forgiving) derives a wrapping key; the DEK is wrapped under it and the
   blob rides with the vault envelope — locally and in the `vaults.recovery_kit`
   column (`PUT /vault/recovery-kit`, returned by `GET /vault`) — so the code
   works on a replacement device after sign-in. The code itself exists only on
   the printed page (`RecoveryKit.tsx`; `window.print()` behind a CSS veil).
   The page says honestly what it is: anyone holding it can open the vault —
   the deed to the house. Minting a new kit or removing it retires the old
   page. The locked-out door ("Use a recovery code" on every lock screen) ends
   the same way guardians do: code → DEK → verify → fresh passphrase → unlock.

The escalation deliberately **not** built: an operator-held spare key
("recoverable vault" tier). If real people still bounce off the model, that
would be offered per-vault at creation as an informed trade-off — never as a
silent default.

## What is deliberately NOT shared

- **The account/sync lifecycle hook** (connect / sign-in / disconnect / delete /
  runSync). The apps diverge most here — boolean vs `string|null` returns, different
  reload steps, currency vs identity vs sharing state — so a shared hook would be a
  config-heavy abstraction that hurts more than it helps. Left per-app by choice.
- ~~Driftless's sharing crypto~~ — this one *did* move: the sharing crypto
  (ECIES DEK wrapping, invite links) and the shared-strand/recovery server
  routes now live in the core, exactly because a second app needed them. Each
  app binds only its frozen HKDF invite labels, the same discipline as
  `VERIFIER_TEXT`.

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
Worker + D1 + custom domain (driftless.page · ballast.gold · hearth.garden ·
grove.page · auravibe.app · tripmanifest.app). The monorepo is a source
reorganization only; it does not change any deploy target.
