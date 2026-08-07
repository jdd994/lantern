// gemini.test.ts — the tier-2 promise, asserted.
// Same contract as alpaca.test.ts: the money math is exact, and the connector
// only ever reads. If a change makes either test fail, the change is wrong,
// not the test.

import { describe, it, expect, vi, afterEach } from "vitest";
import { gemini } from "./gemini";
import type { SourceRef } from "../ledger";

const REF: SourceRef = { kind: "gemini", apiKey: "account-testkey", secret: "s3cret" };

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("gemini.validate", () => {
  it("wants both halves of the key", () => {
    expect(gemini.validate!({ kind: "gemini", apiKey: "", secret: "x" })).toMatch(/API key/);
    expect(gemini.validate!({ kind: "gemini", apiKey: "account-abc", secret: "" })).toMatch(/secret/);
    expect(gemini.validate!(REF)).toBeNull();
  });
});

describe("gemini.read", () => {
  it("sums notional balances exactly, as integer minor units, in USD", async () => {
    mockFetch(200, [
      { currency: "BTC", amountNotional: "103245.37" },
      { currency: "ETH", amountNotional: "2.25" },
      // More precision than a dollar has: truncated, never rounded up.
      { currency: "USD", amountNotional: "10.999" },
    ]);
    expect(await gemini.read!(REF)).toEqual({
      type: "balance",
      value: { minor: 10325861, currency: "USD" },
    });
  });

  it("reports an empty account as genuinely zero", async () => {
    mockFetch(200, []);
    expect(await gemini.read!(REF)).toEqual({
      type: "balance",
      value: { minor: 0, currency: "USD" },
    });
  });

  it("sends the signed read to Gemini and nowhere else, and only ever reads", async () => {
    const fn = mockFetch(200, []);
    await gemini.read!(REF);
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    // THE PROMISE: one POST of the balance read. No orders endpoint exists in
    // this connector, and no method that could reach one.
    expect(url).toBe("https://api.gemini.com/v1/notionalbalances/usd");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-GEMINI-APIKEY"]).toBe("account-testkey");
    // The signed payload names the read path and nothing else — the request
    // the signature authorises IS the balance read.
    const payload = JSON.parse(atob(headers["X-GEMINI-PAYLOAD"])) as { request: string; nonce: number };
    expect(payload.request).toBe("/v1/notionalbalances/usd");
    expect(typeof payload.nonce).toBe("number");
    // HMAC-SHA384 → 48 bytes → 96 hex chars, derived from the payload.
    expect(headers["X-GEMINI-SIGNATURE"]).toMatch(/^[0-9a-f]{96}$/);
  });

  it("says plainly when the key was refused", async () => {
    mockFetch(401, {});
    await expect(gemini.read!(REF)).rejects.toThrow(/didn't accept that key/);
  });

  it("treats a malformed reply as unknown, never as zero", async () => {
    mockFetch(200, { not: "an array" });
    await expect(gemini.read!(REF)).rejects.toThrow(/unexpected/);
  });

  it("refuses to fold an unpriceable row into a short total", async () => {
    // One row Gemini can't state in dollars makes the WHOLE read unknown — a
    // plausible-but-short total is worse than no total (invariant 4).
    mockFetch(200, [
      { currency: "BTC", amountNotional: "100.00" },
      { currency: "DOGE", amountNotional: null },
    ]);
    await expect(gemini.read!(REF)).rejects.toThrow(/unexpected/);
  });

  it("keeps the refusals it advertises", () => {
    expect(gemini.refuses?.some((r) => /trading/i.test(r))).toBe(true);
    expect(Object.keys(gemini).sort()).toEqual(
      ["discloses", "kind", "label", "read", "refuses", "takes", "tier", "validate"].sort()
    );
  });
});
