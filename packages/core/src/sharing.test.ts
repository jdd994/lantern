// The sharing crypto, exercised as two people: only the intended recipient can
// unwrap a collection key, and an invite link opens exactly what it should.
import { describe, expect, it } from "vitest";
import { exportPublicKeyB64, generateDEK, generateIdentityKeypair } from "./crypto";
import {
  b64url,
  deriveInviteKeys,
  fromB64url,
  linkUnwrapDEK,
  linkWrapDEK,
  randomLinkSecret,
  sha256B64,
  toBase64,
  unwrapDEK,
  wrapDEKForRecipient,
  type InviteLabels,
} from "./sharing";

const LABELS: InviteLabels = { wrapInfo: "test-wrap", proofInfo: "test-proof" };
const raw = async (k: CryptoKey) => toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", k)));

describe("ECIES DEK wrapping", () => {
  it("lets the intended recipient — and only them — unwrap the key", async () => {
    const alice = await generateIdentityKeypair();
    const mallory = await generateIdentityKeypair();
    const dek = await generateDEK();

    const wrapped = await wrapDEKForRecipient(await exportPublicKeyB64(alice.publicKey), dek);
    const got = await unwrapDEK(alice.privateKey, wrapped.ephemeralPub, wrapped.wrappedDEK);
    expect(await raw(got)).toBe(await raw(dek));

    // Someone else's private key must not open it.
    await expect(unwrapDEK(mallory.privateKey, wrapped.ephemeralPub, wrapped.wrappedDEK)).rejects.toThrow();
  });

  it("uses a fresh ephemeral key each time, so two wraps never look alike", async () => {
    const alice = await generateIdentityKeypair();
    const pub = await exportPublicKeyB64(alice.publicKey);
    const dek = await generateDEK();
    const a = await wrapDEKForRecipient(pub, dek);
    const b = await wrapDEKForRecipient(pub, dek);
    expect(a.ephemeralPub).not.toBe(b.ephemeralPub);
    expect(a.wrappedDEK.data).not.toBe(b.wrappedDEK.data);
    // …but both still open to the same key.
    expect(await raw(await unwrapDEK(alice.privateKey, b.ephemeralPub, b.wrappedDEK))).toBe(await raw(dek));
  });
});

describe("invite links", () => {
  it("derives the same keys from the same secret, and different ones otherwise", async () => {
    const secret = randomLinkSecret();
    const one = await deriveInviteKeys(secret, LABELS);
    const two = await deriveInviteKeys(secret, LABELS);
    expect(toBase64(one.joinProof)).toBe(toBase64(two.joinProof));

    const other = await deriveInviteKeys(randomLinkSecret(), LABELS);
    expect(toBase64(other.joinProof)).not.toBe(toBase64(one.joinProof));
  });

  it("gives independent wrap and proof keys — the proof never reveals the wrap", async () => {
    const secret = randomLinkSecret();
    const { wrapKey, joinProof } = await deriveInviteKeys(secret, LABELS);
    // The proof is what the server sees (hashed); it must not be the wrap key.
    const dek = await generateDEK();
    const blob = await linkWrapDEK(wrapKey, dek);
    expect(toBase64(joinProof)).not.toBe(toBase64(new Uint8Array(blob.data)));
  });

  it("is label-bound: another app's labels can't open this app's link", async () => {
    const secret = randomLinkSecret();
    const mine = await deriveInviteKeys(secret, LABELS);
    const theirs = await deriveInviteKeys(secret, { wrapInfo: "other-wrap", proofInfo: "other-proof" });
    const blob = await linkWrapDEK(mine.wrapKey, await generateDEK());
    await expect(linkUnwrapDEK(theirs.wrapKey, blob)).rejects.toThrow();
  });

  it("round-trips a DEK through a link", async () => {
    const { wrapKey } = await deriveInviteKeys(randomLinkSecret(), LABELS);
    const dek = await generateDEK();
    expect(await raw(await linkUnwrapDEK(wrapKey, await linkWrapDEK(wrapKey, dek)))).toBe(await raw(dek));
  });

  it("survives the URL fragment round-trip (b64url)", async () => {
    for (let i = 0; i < 20; i++) {
      const secret = randomLinkSecret();
      const text = b64url(secret);
      expect(text).not.toMatch(/[+/=]/); // safe in a URL fragment
      expect(Array.from(fromB64url(text))).toEqual(Array.from(secret));
    }
  });

  it("hashes the proof stably (what the server stores)", async () => {
    const proof = new Uint8Array([1, 2, 3]);
    expect(await sha256B64(proof)).toBe(await sha256B64(new Uint8Array([1, 2, 3])));
    expect(await sha256B64(proof)).not.toBe(await sha256B64(new Uint8Array([1, 2, 4])));
  });
});
