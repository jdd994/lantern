// alpaca.test.ts — the tier-2 promise, asserted.
// The two things that must stay true forever: the money math is exact, and the
// connector only ever reads. If a change makes either test fail, the change is
// wrong, not the test.

import { describe, it, expect, vi, afterEach } from "vitest";
import { alpaca, endpointFor } from "./alpaca";
import type { SourceRef } from "../ledger";

const REF: SourceRef = { kind: "alpaca", keyId: "PKTESTTESTTEST", secret: "s3cret" };

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

describe("endpointFor", () => {
  it("routes paper keys to the paper API and live keys to the live one", () => {
    expect(endpointFor("PKABC123")).toBe("https://paper-api.alpaca.markets");
    expect(endpointFor("AKABC123")).toBe("https://api.alpaca.markets");
  });
});

describe("alpaca.validate", () => {
  it("wants both halves of the key", () => {
    expect(alpaca.validate!({ kind: "alpaca", keyId: "", secret: "x" })).toMatch(/key ID/);
    expect(alpaca.validate!({ kind: "alpaca", keyId: "PKGOODENOUGH", secret: "" })).toMatch(/secret/);
  });

  it("catches a pasted key that isn't an Alpaca key", () => {
    expect(alpaca.validate!({ kind: "alpaca", keyId: "sk-not-alpaca", secret: "x" })).toMatch(
      /doesn't look like/
    );
    expect(alpaca.validate!(REF)).toBeNull();
  });
});

describe("alpaca.read", () => {
  it("parses equity exactly, as integer minor units, in the account's currency", async () => {
    mockFetch(200, { equity: "103245.37", currency: "USD" });
    expect(await alpaca.read!(REF)).toEqual({
      type: "balance",
      value: { minor: 10324537, currency: "USD" },
    });
  });

  it("sends the key to Alpaca and nowhere else, and only ever reads the account", async () => {
    const fn = mockFetch(200, { equity: "1.00", currency: "USD" });
    await alpaca.read!(REF);
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    // THE PROMISE: one GET of the account read. No orders endpoint exists in
    // this connector, and no method that could reach one.
    expect(url).toBe("https://paper-api.alpaca.markets/v2/account");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>)["APCA-API-KEY-ID"]).toBe("PKTESTTESTTEST");
  });

  it("says plainly when the key was refused", async () => {
    mockFetch(401, {});
    await expect(alpaca.read!(REF)).rejects.toThrow(/didn't accept that key/);
  });

  it("treats a malformed reply as unknown, never as zero", async () => {
    mockFetch(200, { equity: null });
    await expect(alpaca.read!(REF)).rejects.toThrow(/unexpected/);
  });

  it("keeps the refusals it advertises", () => {
    // The consent sheet promises we don't trade and don't read positions. The
    // strongest assertion available at this level: the connector exposes no
    // other operation than read/validate, and the read above is a single GET.
    expect(alpaca.refuses?.some((r) => /trading/i.test(r))).toBe(true);
    expect(Object.keys(alpaca).sort()).toEqual(
      ["discloses", "kind", "label", "read", "refuses", "takes", "tier", "validate"].sort()
    );
  });
});
