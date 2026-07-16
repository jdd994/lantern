// Driftless's invite crypto must never change.
//
// These are GOLDEN VECTORS captured from the implementation that is already
// deployed and has real invite links in the world. HKDF's `info` string is an
// input to the derivation, so if "driftless-invite-wrap" / "driftless-invite-proof"
// ever change — or the scheme shifts — every existing link silently stops working
// and nobody finds out until someone can't join. These tests fail loudly instead.
//
// They were written when the sharing crypto moved to @lantern/core/sharing, to
// prove that move was byte-identical. Do not "update" the vectors to make a
// failure go away: a failure here means you broke real links.
import { describe, expect, it } from "vitest";
import { INVITE_LABELS, deriveInviteKeys, linkUnwrapDEK, toBase64 } from "./crypto";
import type { CipherBlob } from "@lantern/core/crypto";

// A fixed, reproducible link secret: bytes 0..31.
const SECRET = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

// Captured from the pre-extraction implementation.
const GOLDEN_JOIN_PROOF = "/xP9D9uctuNyAOAi+AYC8c77OrWkXjw9IqcsGNTrBnc=";
const GOLDEN_DEK_RAW = "//79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eA=";
const GOLDEN_BLOB: CipherBlob = {
  iv: [4, 68, 143, 41, 90, 95, 230, 0, 130, 86, 241, 17],
  data: [
    120, 35, 242, 100, 123, 84, 45, 8, 81, 43, 30, 44, 232, 215, 32, 191, 205, 108, 247, 164, 236,
    100, 89, 71, 22, 195, 111, 133, 13, 61, 154, 7, 9, 199, 34, 52, 88, 49, 181, 200, 237, 111, 191,
    28, 78, 182, 3, 205,
  ],
};

describe("Driftless invite crypto — frozen forever", () => {
  it("keeps its HKDF labels", () => {
    // Spelled out so a rename can't sneak through a refactor.
    expect(INVITE_LABELS).toEqual({
      wrapInfo: "driftless-invite-wrap",
      proofInfo: "driftless-invite-proof",
    });
  });

  it("derives the same joinProof as the deployed implementation", async () => {
    const { joinProof } = await deriveInviteKeys(SECRET);
    expect(toBase64(joinProof)).toBe(GOLDEN_JOIN_PROOF);
  });

  it("still unwraps a DEK wrapped by the deployed implementation", async () => {
    // The real compatibility question: an invite link created before the
    // extraction must still open the collection after it.
    const { wrapKey } = await deriveInviteKeys(SECRET);
    const dek = await linkUnwrapDEK(wrapKey, GOLDEN_BLOB);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
    expect(toBase64(raw)).toBe(GOLDEN_DEK_RAW);
  });
});
