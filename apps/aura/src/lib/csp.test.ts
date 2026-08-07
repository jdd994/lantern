// csp.test.ts — this app's shipped CSP still keeps the no-analytics promise.
//
// Reads the real `public/_headers` that gets deployed, not a copy. Written after
// Cloudflare was caught injecting its Web Analytics beacon into the live HTML
// (2026-08-07): the CSP blocked it twice over and nothing was collected, but the
// protection was invisible. Now it's a test, so loosening it goes red in the
// same commit instead of quietly making a promise false in production.
//
// Shared rules live in @lantern/core/csp so all seven siblings hold one line.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditCSP, cspFromHeadersFile, parseCSP, TRACKER_HOSTS } from "@lantern/core/csp";

const headers = readFileSync(fileURLToPath(new URL("../../public/_headers", import.meta.url)), "utf8");

// Remote origins this app has deliberately accepted for SCRIPT. Empty is the
// default and the goal — anything added here needs a comment saying what it
// costs the person using the app.
const ALLOWED_SCRIPT_ORIGINS: string[] = [
  // Aura's OWN R2 bucket, serving onnxruntime-web's WASM glue for the on-device
  // ambient model. The cost to the user: a request to a Cloudflare R2 origin
  // that reveals they opened Aura — no account, no content, and the model runs
  // locally once fetched. Documented in full in public/_headers. If this ever
  // becomes a host we don't control, it stops being acceptable.
  "https://pub-265b50abb06d41f9afcab96b2dee95ae.r2.dev",
];

describe("the shipped CSP", () => {
  const csp = cspFromHeadersFile(headers);

  it("exists at all", () => {
    expect(csp).toBeTruthy();
  });

  it("keeps the no-analytics promise", () => {
    // The assertion prints every problem, so a failure explains itself.
    expect(auditCSP(csp!, { allowScriptOrigins: ALLOWED_SCRIPT_ORIGINS })).toEqual([]);
  });

  it("loads script only from itself and its declared origins", () => {
    const origins = parseCSP(csp!)["script-src"].filter((v) => !v.startsWith("'"));
    expect(origins).toEqual(ALLOWED_SCRIPT_ORIGINS);
  });

  it("names no tracker host anywhere in the policy", () => {
    for (const host of TRACKER_HOSTS) expect(csp!).not.toContain(host);
  });
});
