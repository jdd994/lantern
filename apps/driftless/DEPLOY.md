# Deploying Driftless (Cloudflare Pages)

Driftless builds to static files (`dist/`), so hosting is just serving that
folder over HTTPS. We use Cloudflare Pages: free, HTTPS by default, and you own
the origin — which matters, because for any end-to-end-encrypted web app the
host that serves the JavaScript is part of the trust boundary. The strict
Content-Security-Policy in `public/_headers` blocks any external script or
network connection, so even the host can't quietly exfiltrate a passphrase.

## One-time setup

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
2. Authenticate the CLI (opens a browser once):

   ```bash
   npx wrangler login
   ```

## Deploy

```bash
npm run deploy
```

This builds and uploads `dist/` to a Pages project named `driftless`. The first
run creates the project and asks which branch is production (pick `main` or
`production`). When it finishes, Wrangler prints your URL, e.g.
`https://driftless.pages.dev` — that's the link you and your friend open and
install to your home screens.

To redeploy after changes, just run `npm run deploy` again.

## Notes

- **Each browser starts as its own encrypted vault.** Sync across devices is
  opt-in: connect an account and the server moves opaque ciphertext only (see
  the roadmap in `CLAUDE.md`).
- **Back up occasionally.** In-app: Export (readable Markdown) or Back up
  (encrypted, restorable snapshot) — sync is replication, not a backup.
- The sync API origin (`driftless-server.jdd994.workers.dev`) is allowed in
  `connect-src` in `public/_headers` — keep that list to exactly our own
  origins, nothing else.
- The custom domain **driftless.page** is attached in the Cloudflare Pages
  dashboard; the security headers apply there automatically. The client is
  deployed with `npm run deploy`, the sync server separately from `server/`
  (`npm run deploy` there).
