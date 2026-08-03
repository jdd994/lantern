import { describe, expect, it } from "vitest";
import { formatRecoveryCode, generateRecoveryCode, makeRecoveryKit, normalizeRecoveryCode, openRecoveryKit } from "./kit";

async function freshDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

describe("recovery codes", () => {
  it("prints 26 Crockford chars in groups, unique each time", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(a).not.toBe(b);
  });

  it("forgives what tired hands type", () => {
    expect(normalizeRecoveryCode("k7q2 9xmf")).toBe("K7Q29XMF");
    expect(normalizeRecoveryCode("O0-Il-1o")).toBe("001110"); // o→0, I/l→1
    expect(normalizeRecoveryCode("abcd-EFGH")).toBe("ABCDEFGH");
    expect(formatRecoveryCode("k7q29xmf3t8bj6rdp4vwxn2h5c")).toBe("K7Q2-9XMF-3T8B-J6RD-P4VW-XN2H-5C");
  });
});

describe("the kit", () => {
  it("round-trips the DEK through the printed code", async () => {
    const dek = await freshDEK();
    const { code, kit } = await makeRecoveryKit(dek);
    const opened = await openRecoveryKit(code, kit);
    expect(opened).not.toBeNull();
    // same key material: what one encrypts the other decrypts
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, new TextEncoder().encode("deed"));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, opened!, ct);
    expect(new TextDecoder().decode(pt)).toBe("deed");
  });

  it("opens with sloppy re-typing, refuses a wrong code", async () => {
    const dek = await freshDEK();
    const { code, kit } = await makeRecoveryKit(dek);
    const sloppy = code.toLowerCase().replace(/-/g, " ");
    expect(await openRecoveryKit(sloppy, kit)).not.toBeNull();
    expect(await openRecoveryKit("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA", kit)).toBeNull();
  });

  it("a replaced kit's old code is dead", async () => {
    const dek = await freshDEK();
    const first = await makeRecoveryKit(dek);
    const second = await makeRecoveryKit(dek);
    expect(await openRecoveryKit(first.code, second.kit)).toBeNull();
    expect(await openRecoveryKit(second.code, second.kit)).not.toBeNull();
  });
});
