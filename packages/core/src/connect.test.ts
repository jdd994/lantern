// connect.test.ts — the shared Connect/Consent framework's testable heart.
// The PKCE redirect dance needs a window and is exercised by the apps; what's
// pinned here is everything that must never drift: the challenge derivation,
// token normalisation, and above all the stable-id derivation, which existing
// user data already depends on.

import { describe, it, expect } from "vitest";
import { importKeyRaw } from "./crypto";
import { pkceChallenge, tokensFrom, stableId, tagger } from "./connect";

describe("pkceChallenge", () => {
  it("matches the RFC 7636 appendix B vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("tokensFrom", () => {
  it("normalises a token response with a minute of slack", () => {
    const t = tokensFrom(
      { access_token: "a", refresh_token: "r", expires_in: 3600 },
      1_000_000
    );
    expect(t).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1_000_000 + 3540 * 1000,
    });
  });
});

describe("stable ids", () => {
  const rawKey = Array.from({ length: 32 }, (_, i) => i);
  const INFO = "hearth-wearable-id-v1";

  it("is deterministic per (vault, info, natural)", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, INFO, "fitbit:steps:2026-07-15")).toBe(
      await stableId(key, INFO, "fitbit:steps:2026-07-15")
    );
  });

  it("differs per info string, so two apps' ids never collide meaningfully", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, "app-a-v1", "same:natural")).not.toBe(
      await stableId(key, "app-b-v1", "same:natural")
    );
  });

  it("looks like noise", async () => {
    const key = await importKeyRaw(rawKey);
    const id = await stableId(key, INFO, "fitbit:steps:2026-07-15");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("fitbit");
  });

  it("a tagger mints the same ids as one-shot stableId", async () => {
    const key = await importKeyRaw(rawKey);
    const tag = await tagger(key, INFO);
    expect(await tag("x:1")).toBe(await stableId(key, INFO, "x:1"));
  });

  // GOLDEN VECTOR — this is Hearth's frozen derivation, moved here verbatim.
  // Hearth users already have body history deduped under these exact ids. If
  // this fails, the extraction drifted and the next Fitbit import would
  // silently duplicate every reading a person has. Don't "fix" the expectation.
  it("matches Hearth's frozen wearable derivation", async () => {
    const key = await importKeyRaw(rawKey);
    expect(await stableId(key, INFO, "fitbit:steps:2026-07-15")).toBe(
      "7f3ee3988b99e6183453e1f77e7138a2"
    );
  });
});
