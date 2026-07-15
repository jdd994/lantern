# lantern

A small family of **local-first, end-to-end-encrypted** apps that share one
core — and one soul. Everything you write is encrypted on your device before it
is stored anywhere; the passphrase that unlocks it never leaves the device, and
never reaches a server. A breach yields nothing but noise.

The name is the idea: a lantern is the warm light you carry, and `packages/core`
is the flame each app is lit from.

## The apps

| App | What it holds | Signature element |
|-----|---------------|-------------------|
| **[Driftless](apps/driftless)** | a quiet place to catch your thoughts | the time rail |
| **[Ballast](apps/ballast)** | steady footing with your money | the waterline |
| **[Hearth](apps/hearth)** | tending and nourishing yourself, gently | the day's plate |

Each is a Vite + React PWA, deployed independently to its own domain
(driftless.page · ballast.gold · hearth.garden). None of them can see your data,
and neither can we — that's the whole point.

## Layout

```
packages/
  core     @lantern/core   — headless: crypto (envelope encryption, verifier,
                             identity), biometric quick-unlock, the vault lifecycle
                             (pure, tested), the sync reconcile engine, the API client.
  server   @lantern/server — Workers + D1: auth, and createServer() — the whole base
                             sync server as a factory. Stores opaque ciphertext only.
  ui       @lantern/ui     — Sheet, useTheme, ThemePicker, themed by each app's tokens.
apps/
  driftless  ballast  hearth   — each supplies its own content, domain logic,
                                  palette, copy, and config; imports the shared core.
```

An npm-workspaces monorepo. The shared spine lives in `packages/`; each app is its
own flavor on top. See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how an app is built
on the core, the per-app "taste" points, and what's deliberately not shared.

## Develop

```bash
npm install                     # once, at the root — installs every workspace
npm run dev   -w ballast        # a dev server for one app
npm run build -w hearth         # tsc + vite build
npm run test  -w driftless      # vitest
```

## The rule for what gets built

Every feature is filtered through one question: *does this deepen reflection,
care, and genuine connection — or does it sneak in performance, comparison, or
extraction?* If the latter, it isn't built. No likes, no follower counts, no
public metrics, no ads, no analytics, no engagement hooks. That is *why* these
apps are E2E, local-first, and open-source.

## License

[AGPL-3.0](LICENSE). Each app also carries its own copy.
