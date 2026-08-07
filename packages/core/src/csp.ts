// csp.ts — the no-analytics promise, made checkable.
//
// Every lantern app says the same thing in its README, its CLAUDE.md and its
// welcome screen: no analytics, no third-party scripts, nothing that could ever
// see what you eat / write / owe. That promise currently lives in prose and in
// seven hand-written `public/_headers` files, which means it holds exactly as
// long as nobody edits a CSP in a hurry.
//
// WHY THIS EXISTS (2026-08-07). Cloudflare was found injecting its Web Analytics
// beacon (`static.cloudflareinsights.com/beacon.min.js`) into the HTML of six of
// the seven live sites — server-side, at the zone level, nothing to do with our
// code. Nothing was collected, because `script-src 'self'` refused to load it
// and `connect-src` never listed the host, so it was blocked twice over. The CSP
// did its job silently and perfectly.
//
// But that's the point: the protection was invisible, and one loosened directive
// years from now would switch a real analytics beacon on with nobody noticing.
// So the guard becomes a test. Each app asserts its own shipped `_headers`
// against these rules; if someone widens `script-src` or admits a tracker host,
// a test goes red in the same commit rather than a promise quietly becoming
// false in production.
//
// Pure string logic — no filesystem, no network. Each app's test does the
// reading, because each app owns its own CSP.

export type Directives = Record<string, string[]>;

// "default-src 'self'; script-src 'self'" → { "default-src": ["'self'"], … }
// Directive names are case-insensitive per spec; values are not.
export function parseCSP(header: string): Directives {
  const out: Directives = {};
  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const [name, ...values] = tokens;
    out[name.toLowerCase()] = values;
  }
  return out;
}

// Hosts that exist to watch people. Not exhaustive and never will be — the
// structural defence is `script-src 'self'`, which refuses ALL of them and
// everything not yet invented. This list is the second belt: it catches a host
// added deliberately to some other directive, where 'self' wouldn't help.
//
// Cloudflare Insights is first because it's the one that actually turned up.
export const TRACKER_HOSTS = [
  "cloudflareinsights.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "connect.facebook.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.com",
  "segment.io",
  "amplitude.com",
  "sentry.io",
  "bugsnag.com",
  "fullstory.com",
  "clarity.ms",
  "plausible.io",
  "posthog.com",
  "matomo.cloud",
  "newrelic.com",
  "datadoghq.com",
];

// Source expressions that let arbitrary code run. A CSP that permits these has
// stopped being a boundary — 'unsafe-inline' in script-src would let an injected
// beacon tag execute no matter what hosts are listed.
const UNSAFE_SCRIPT = ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:"];

export type Finding = { directive: string; problem: string };

export type AuditOptions = {
  /**
   * Script origins this app has DELIBERATELY accepted, passed from its own test.
   * An exception has to be named out loud in the app that made it — that's the
   * point. Aura serves onnxruntime's WASM glue from its own R2 bucket; nobody
   * else has one, and if a host appears here without a comment explaining what
   * it costs the user, that's the review catching it.
   */
  allowScriptOrigins?: string[];
};

/**
 * Audit one Content-Security-Policy header value against the family's promise.
 * Returns every problem found; an empty array is the pass condition.
 *
 * The rules are deliberately few and all load-bearing:
 *  1. `script-src` must exist, must not permit arbitrary code ('unsafe-inline',
 *     'unsafe-eval', `*`, data:, blob:), and must name no remote origin the app
 *     hasn't explicitly declared. This is what actually blocked the beacon.
 *  2. `default-src` must exist, so anything not named falls back to a closed door.
 *  3. No directive may name a known tracker host.
 *  4. `object-src 'none'` — plugins are an unpoliced script channel.
 */
export function auditCSP(header: string, opts: AuditOptions = {}): Finding[] {
  const d = parseCSP(header);
  const findings: Finding[] = [];
  const allowed = new Set(opts.allowScriptOrigins ?? []);

  if (!d["default-src"]) findings.push({ directive: "default-src", problem: "missing — unnamed directives should fall back to a closed door" });

  const script = d["script-src"];
  if (!script) {
    findings.push({ directive: "script-src", problem: "missing — scripts would fall back to default-src; state it explicitly" });
  } else {
    for (const v of script) {
      if (UNSAFE_SCRIPT.includes(v)) {
        findings.push({ directive: "script-src", problem: `${v} lets arbitrary script run — an injected analytics tag would execute` });
      } else if (v !== "'self'" && !v.startsWith("'") && !allowed.has(v)) {
        // Quoted keywords ('self', 'wasm-unsafe-eval', hashes, nonces) are
        // capability grants, not origins, and the unsafe ones are caught above.
        // A bare host is somewhere code could COME FROM — it must be declared.
        findings.push({ directive: "script-src", problem: `${v} is an undeclared remote script origin; declare it in the app's own test with a comment saying what it costs the user, or remove it` });
      }
    }
  }

  if (d["object-src"] && d["object-src"].join(" ") !== "'none'") {
    findings.push({ directive: "object-src", problem: "should be 'none' — plugins are an unpoliced script channel" });
  }

  for (const [directive, values] of Object.entries(d)) {
    for (const v of values) {
      const host = TRACKER_HOSTS.find((t) => v === t || v.endsWith(`//${t}`) || v.endsWith(`.${t}`) || v.includes(`//${t}/`) || v.includes(`.${t}/`));
      if (host) findings.push({ directive, problem: `names the tracker host ${host} — the no-analytics promise is structural, not a preference` });
    }
  }

  return findings;
}

/**
 * Pull the CSP out of a Cloudflare Pages `_headers` file. Comment lines start
 * with `#`; the policy is indented under a path pattern. Returns null when no
 * policy is present at all, which is itself worth failing on.
 */
export function cspFromHeadersFile(text: string): string | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) continue;
    const m = /^content-security-policy\s*:\s*(.+)$/i.exec(t);
    if (m) return m[1].trim();
  }
  return null;
}
