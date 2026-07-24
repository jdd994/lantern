import { describe, expect, it } from "vitest";
import { decodeTransferQr, encodeTransferQr, isTransferQr } from "./transfer";

describe("transfer", () => {
  it("round-trips a setup payload through the QR envelope", () => {
    const json = JSON.stringify({ app: "aura", version: 1, rooms: [] });
    const encoded = encodeTransferQr(json);
    expect(isTransferQr(encoded)).toBe(true);
    expect(decodeTransferQr(encoded)).toBe(json);
  });

  it("passes bare JSON through unchanged (pasted text has no envelope)", () => {
    const json = JSON.stringify({ app: "aura", version: 1, rooms: [] });
    expect(isTransferQr(json)).toBe(false);
    expect(decodeTransferQr(json)).toBe(json);
  });

  it("doesn't mistake unrelated text for a transfer code", () => {
    expect(isTransferQr("https://example.com")).toBe(false);
    expect(isTransferQr("driftless-pair:v1:abc:def")).toBe(false);
  });
});
