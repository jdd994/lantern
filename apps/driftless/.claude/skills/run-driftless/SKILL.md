---
name: run-driftless
description: Launch and drive the Driftless app in a headless browser — dev server, vault setup/unlock, and Playwright selectors for capture, strands, photos, and reload-persistence checks.
---

# Running and driving Driftless

## Fastest path: the smoke test

```bash
cd apps/driftless
npm run e2e     # e2e/smoke.mjs — spawns its own dev server on :5199, drives the
                # full journey (vault → capture → strand → chapter → photo →
                # pull-in → reload → verify), exits nonzero on regression
```

Run it after touching `useJournal.ts`, `db.ts`, or anything in the persist/sync
path. It reloads between writing and reading — persistence bugs only show up
across a reload. Adapt a copy of it when you need to drive a different flow.

## Manual launch

```bash
cd apps/driftless
npm run dev &    # Vite on :5173 (PWA/service worker enabled even in dev)
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
# stop: lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

Pick a different `--port N --strictPort` if :5173 may be in use (the user often
has their own dev server running).

## Driving it (Playwright)

`playwright` is a workspace-root devDependency and Chromium is already in
`~/.cache/ms-playwright` — no install step. Launch with
`chromium.launch({ args: ["--no-sandbox"] })`. `chromium-cli` is NOT available
on this machine.

First run (fresh browser context — the app is a local encrypted vault, so
"auth" is creating/unlocking that vault):

```js
await page.locator(".welcome-begin").click();          // Welcome screen
await page.getByPlaceholder("Passphrase").fill(PASS);  // setup: choose passphrase
await page.getByPlaceholder("Type it again").fill(PASS);
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: /Skip — keep it on this device/ }).click();
```

Returning (after reload, same context):

```js
await page.getByPlaceholder("Passphrase").fill(PASS);
await page.getByRole("button", { name: "Unlock", exact: true }).click();
```

## Selector gotchas (all hit in practice)

- The view switcher (Stream / Timeline / Strands / Shared) uses
  `role="tab"`, not button: `page.getByRole("tab", { name: "Strands" })`.
- React controlled inputs: use `fill`/`type`, never `eval el.value = …`.
- Capture box: `.capture-input` textarea + "Keep thought" button (its
  placeholder changes with time of day — don't match on it).
- Strand compose: `.strand-compose textarea` + "Add piece". Photo goes through
  the hidden `.strand-compose input[type=file]` via `setInputFiles` with an
  in-memory buffer. Decrypted photos render as `.media-thumb img`.
- Two different "Start" buttons exist (new strand, new chapter) — scope or
  sequence them; same for "Add" (chapter add) vs "Add piece".
- Storage is IndexedDB per browser context: same context ⇒ data survives
  `page.goto` (that's the reload test); new context ⇒ fresh vault.
- Leave ~800ms after the last write before reloading — commits are optimistic,
  the encrypt+IndexedDB put lands just after.
- Check `console` errors before declaring success; the app fails quiet.
