# CLAUDE.md — Driftless

Context for Claude Code working in this repo. Read this first.

## What this is

Driftless is a personal journaling PWA built around one job: **remove all
friction between a fleeting thought and its safe landing.** Open it, the cursor
is already waiting; type; it's kept, timestamped, and threaded onto a timeline.

It is **local-first** and **end-to-end encrypted**, and **synced across devices**
(Cloudflare Workers + D1, opaque ciphertext only — see Roadmap for what's still
open on top of that).

## Purpose (the north star)

Driftless is an **inward-facing "social" app.** Where social media is outward
performance rewarded by metrics — likes, followers, views, and the comparison
and extraction that follow — Driftless inverts it:

- **Inward first:** catch your own thoughts, remember, reflect. Taking your
  inner life seriously is loving yourself.
- **Then outward from love, not for validation:** share a story, or build one
  *together* with people you love (shared/family strands), openly.
- **No scoreboard:** no likes, follower counts, or rankings — the reward is
  connection and meaning, not dopamine.

**Love is the point — loving yourself, loving others, and sharing that love.**

Filter every feature through one question: *does this deepen love, reflection,
and genuine connection, or does it sneak in performance, comparison, or
extraction?* If the latter, don't build it — no matter how normal it is for a
"social" app. **Never** add likes, follower/vanity counts, public metrics,
algorithmic feeds, ads, or engagement hooks. This is *why* the app is E2E,
local-first, no-ads, no-analytics, and open-source: those choices serve
love-as-the-point, not extraction. And it must stay **easy and intuitive** —
presence shouldn't require effort.

## Design intent (don't flatten this)

- The feeling is a quiet, warm, lamplit room — calm at any hour, including 3am.
- Palette and type are deliberate (warm near-black, amber "lamplight" accent, a
  serif for written words, mono for timestamps). The tokens live in
  `src/styles.css`. Keep new UI consistent with them; don't introduce a generic
  blue/gray admin look.
- The **time rail** (vertical line with the amber "now" tick) is the signature
  element. Newest entry sits at the top, right under the capture box.

## Stack

- Vite + React 18 + TypeScript
- `vite-plugin-pwa` (Workbox) for manifest + offline service worker
- `idb` for IndexedDB
- WebCrypto (AES-GCM + PBKDF2) for encryption — no crypto dependencies

## Architecture

- `src/lib/crypto.ts` — passphrase → AES-GCM key; encrypt/decrypt; verifier.
- `src/lib/db.ts` — IndexedDB (v4). Stores: `vault` (salt + verifier),
  `entries` (ciphertext + plaintext timestamps + `deleted` tombstone + `dirty`
  outbox flag), `sync` (pull cursor + auth token — live, the engine reads/writes
  it every sync), `device` (per-device biometric enrollment: a passkey id + the vault
  key wrapped by its WebAuthn-PRF secret — device-local, never synced), and
  `strands` (named ordered collections; ciphertext of `{title, entryIds}`).
  Deletes are soft (tombstone), filtered out of the UI. See SYNC_PLAN.md.
- Three organizing axes for entries: capture time (Stream), lived/anchor time
  (Timeline — `anchor` lives inside the encrypted payload), and narrative order
  (Strands). Anchors and strand title/order are content, so both are encrypted
  and sync for free as ciphertext.
- `src/lib/journal.ts` — pure, IO-free logic (tags, grouping, search, export).
  Prefer adding logic here and unit-testing it.
- `src/hooks/useJournal.ts` — the only place state and IO meet. Holds decrypted
  entries + the session key (in a ref, never persisted). All CRUD goes through
  it so plaintext never leaks to storage.
- `src/components/*` — presentational; they receive data and callbacks.

### Invariants — please preserve

1. Plaintext entry content must never be written to storage, logs, or the
   network. Only ciphertext leaves memory.
2. The encryption key stays in memory only (a ref in `useJournal`). No writing
   it to IndexedDB/localStorage without an explicit, discussed "remember this
   device" decision.
3. Capture stays instant and offline-capable. Saving a thought must not depend
   on a network round-trip.
4. **Authentication and encryption stay separate.** Today there is no account
   of any kind — the passphrase is *only* a decryption key for the local vault;
   it is never sent anywhere and never checked against a server. When sync adds
   an account (to answer "whose ciphertext is this?"), the account secret and
   the encryption passphrase remain two different secrets doing two different
   jobs: the server authenticates the account and stores opaque blobs; the
   passphrase/derived key decrypts them and never leaves the device. Never
   collapse the two (e.g. don't derive the encryption key from the login
   credential, and don't transmit the passphrase or key). A server compromise
   must yield only unreadable ciphertext.

## Conventions

- TypeScript strict is on. Keep it green.
- Small, focused components. Pure logic → `lib/`. State/IO → the hook.
- Match existing class names and the token system in `styles.css`.
- Copy is plain, calm, second person. Errors say what happened and what to do.

## Commands

```bash
npm run dev      # local dev server (PWA enabled in dev for testing install)
npm run build    # tsc -b && vite build
npm run preview  # serve the built app
npm run test     # unit tests (pure logic in lib/)
npm run e2e      # e2e/smoke.mjs — drives the real app in headless Chromium
                 # through capture/strand/photo flows WITH reloads in between;
                 # run it after touching useJournal.ts, db.ts, or sync
```

## Roadmap (in order)

1. **Sync backend — BUILT.** A tiny custom server (Cloudflare Workers + D1),
   chosen over a managed option (e.g. Supabase, decided 2026-06-30) for more
   control and the smallest trust surface. The client encrypts, the server
   (`server/`, factory in `@lantern/server`) stores opaque ciphertext only,
   devices reconcile. Deployed at driftless.page.
2. **Sync engine — BUILT.** `src/lib/sync.ts` binds `@lantern/core/sync` (LWW by
   `updatedAt`, per-user `seq` cursor, `deleted` tombstones) to Driftless's
   entries/strands, plus a `pushMedia` for encrypted photos. Wired end-to-end
   via `useJournal.ts`'s `syncNow`, triggered from `App.tsx`.
3. **Timestamp metadata — DECIDED 2026-07-27: accept + document now, fix fully
   in the shared core later.** What the server can see (writing rhythm: record
   timestamps, seq order, counts/sizes/kinds, day-note ids which are literal
   dates) is documented honestly in SECURITY.md. Encrypting stored timestamps
   alone was rejected: sync fires ~1.5s after writing, so request timing leaks
   the same rhythm to a live server — partial fixes add complexity without
   closing the leak. The full fix — **metadata-private records** (createdAt/
   updatedAt inside the ciphertext, version-counter LWW instead of wall-clock,
   opaque day-note ids, `markAllDirty` re-push as migration) — is a designed-in
   REQUIREMENT of the shared-core sync extraction, so all apps inherit it at
   once. Don't half-do it per-app.
4. **Account + key portability — BUILT.** Register/login on the server; the vault
   salt + verifier travel with the account so a new device re-derives the same
   key from the passphrase. The account (login) and the passphrase stay
   deliberately separate secrets — see invariant 4: the account says *whose*
   ciphertext this is; the passphrase *decrypts* it and never leaves the device.
   The key is never derived from the login credential.
5. Niceties (some done): named threads → **Strands (done)**, biometric →
   **Quick unlock (done)**, richer export → **encrypted Back up (done)**,
   media in entries/strands → **polaroids (done)**, co-authored shared/family
   strands → **Sharing S1–S4 (done)**, in-app landing → **warm first-run
   welcome (done)** — `Welcome.tsx`, the first setup step, states the "no reset"
   trade up front (the PWA link *is* the distribution; no separate marketing
   site), media sync over R2 → **done** (SYNC_PLAN phases 1–5), custom domain →
   **done** (driftless.page is the deployed origin), tags + search → **done**
   (TagBar, search toolbar, read-#tag-as-one). Still open: a **calm suggestion
   box** (GitHub Discussions now — zero-infra, engage at your pace; optional
   in-app box posting to our own D1 later — framed "read when I can, no
   obligation"); pin/favorite; per-day word count (weigh against the no-metrics
   filter before building).
6. **Strand sections — BUILT.** A **section is just a piece flagged as a
   heading** — everything until the next heading belongs to it (the lightest
   approach won: flat model, "everything is a thought," no recursive nesting,
   which would have drifted toward a fiddly outliner). Built as: heading
   flag on entries, "+ New chapter" (write + flag in one step), "+ Add to this
   chapter" (lands at that section's end), reader TOC. See STRANDS_PLAN.md.

## Watch out for

- StrictMode double-invokes effects in dev — keep effects idempotent.
- IndexedDB calls are async; the UI updates optimistically in the hook, then
  persists. Keep that order so capture feels instant.
- **Never compute a record inside a setState updater and persist it after.**
  React defers updaters when another update is pending (any chained mutation),
  so the captured value stays null and the persist silently never happens —
  this is exactly how strand membership was lost until 6311be9. In
  `useJournal`, mutate through the ref mirrors (`entriesRef`/`strandsRef`) and
  the commit helpers (`commitEntries`/`commitStrands`), or the `mutateEntry`/
  `mutateStrand` helpers built on them. `npm run e2e` guards this class of bug.
- Don't add analytics or any third-party script that could see entry content.
