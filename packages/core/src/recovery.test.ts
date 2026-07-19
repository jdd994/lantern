// The social-recovery crypto, exercised as an owner and a handful of
// guardians: Shamir shares reconstruct exactly with k of n and no fewer, a
// guardian's share is unreadable without both their identity key AND the
// codeword, and the full circle -> approve -> reconstruct loop yields back
// the original DEK.
import { describe, expect, it } from "vitest";
import { exportKeyRaw, generateDEK, generateIdentityKeypair, exportPublicKeyB64 } from "./crypto";
import {
  approveAsGuardian,
  combineShares,
  createRecoveryCircle,
  reconstructDEK,
  splitSecret,
  unwrapBytesForRecipient,
  unwrapShareFromGuardian,
  wrapBytesForRecipient,
  wrapShareForGuardian,
  type ShamirShare,
} from "./recovery";

const raw = async (k: CryptoKey) => Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", k)));
const ITER = 1000; // fast for tests; the app default is PBKDF2_ITERATIONS

describe("Shamir secret sharing", () => {
  it("reconstructs exactly with k of n shares (k === n)", () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const shares = splitSecret(secret, 3, 3);
    expect(shares).toHaveLength(3);
    expect(Array.from(combineShares(shares, 3))).toEqual(Array.from(secret));
  });

  it("reconstructs from any k of n > k shares", () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const shares = splitSecret(secret, 3, 5);
    // Two different 3-subsets should both reconstruct the same secret.
    const subsetA = [shares[0], shares[2], shares[4]];
    const subsetB = [shares[1], shares[2], shares[3]];
    expect(Array.from(combineShares(subsetA, 3))).toEqual(Array.from(secret));
    expect(Array.from(combineShares(subsetB, 3))).toEqual(Array.from(secret));
  });

  it("rejects reconstruction with fewer than k shares", () => {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const shares = splitSecret(secret, 4, 6);
    expect(() => combineShares(shares.slice(0, 3), 4)).toThrow();
  });

  it("rejects duplicate share indices", () => {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const shares = splitSecret(secret, 2, 4);
    const dup: ShamirShare[] = [shares[0], { ...shares[0] }];
    expect(() => combineShares(dup, 2)).toThrow();
  });

  it("rejects an invalid k/n", () => {
    const secret = new Uint8Array(8);
    expect(() => splitSecret(secret, 1, 5)).toThrow(); // k must be >= 2
    expect(() => splitSecret(secret, 6, 5)).toThrow(); // k must be <= n
  });
});

describe("generalized ECIES (arbitrary bytes)", () => {
  it("lets the intended recipient — and only them — unwrap the bytes", async () => {
    const alice = await generateIdentityKeypair();
    const mallory = await generateIdentityKeypair();
    const message = new TextEncoder().encode("a shamir share, roughly");

    const wrapped = await wrapBytesForRecipient(await exportPublicKeyB64(alice.publicKey), message);
    const got = await unwrapBytesForRecipient(alice.privateKey, wrapped.ephemeralPub, wrapped.wrapped);
    expect(new TextDecoder().decode(got)).toBe("a shamir share, roughly");

    await expect(
      unwrapBytesForRecipient(mallory.privateKey, wrapped.ephemeralPub, wrapped.wrapped)
    ).rejects.toThrow();
  });

  it("uses a fresh ephemeral key each call", async () => {
    const alice = await generateIdentityKeypair();
    const pub = await exportPublicKeyB64(alice.publicKey);
    const message = new TextEncoder().encode("same message");
    const a = await wrapBytesForRecipient(pub, message);
    const b = await wrapBytesForRecipient(pub, message);
    expect(a.ephemeralPub).not.toBe(b.ephemeralPub);
    expect(a.wrapped.data).not.toBe(b.wrapped.data);
  });
});

describe("codeword-gated guardian shares", () => {
  it("round-trips a share with the right identity key AND the right codeword", async () => {
    const guardian = await generateIdentityKeypair();
    const share: ShamirShare = { index: 2, bytes: [1, 2, 3, 4, 5] };
    const wrapped = await wrapShareForGuardian("correct horse battery staple", await exportPublicKeyB64(guardian.publicKey), share, ITER);
    const got = await unwrapShareFromGuardian(guardian.privateKey, wrapped, "correct horse battery staple");
    expect(got).toEqual(share);
  });

  it("refuses with the right identity key but the WRONG codeword", async () => {
    const guardian = await generateIdentityKeypair();
    const share: ShamirShare = { index: 1, bytes: [9, 9, 9] };
    const wrapped = await wrapShareForGuardian("right words here", await exportPublicKeyB64(guardian.publicKey), share, ITER);
    await expect(unwrapShareFromGuardian(guardian.privateKey, wrapped, "wrong words here")).rejects.toThrow();
  });

  it("refuses with the right codeword but the WRONG identity key", async () => {
    const guardian = await generateIdentityKeypair();
    const impostor = await generateIdentityKeypair();
    const share: ShamirShare = { index: 1, bytes: [7, 7, 7] };
    const wrapped = await wrapShareForGuardian("a shared secret phrase", await exportPublicKeyB64(guardian.publicKey), share, ITER);
    await expect(unwrapShareFromGuardian(impostor.privateKey, wrapped, "a shared secret phrase")).rejects.toThrow();
  });
});

describe("full recovery circle", () => {
  it("owner setup -> k guardian approvals -> requester reconstructs the exact original DEK", async () => {
    const dek = await generateDEK();
    const dekBefore = await raw(dek);

    const guardianKeys = await Promise.all(Array.from({ length: 5 }, () => generateIdentityKeypair()));
    const guardians = await Promise.all(
      guardianKeys.map(async (kp, i) => ({
        userId: `guardian-${i}`,
        identityPublicKey: await exportPublicKeyB64(kp.publicKey),
        codeword: `codeword for guardian ${i}`,
      }))
    );

    const circle = await createRecoveryCircle(dek, guardians, { k: 3, n: 5, delayMs: 1000 });
    expect(circle.shares).toHaveLength(5);

    // The requester's throwaway session keypair for this one recovery attempt.
    const session = await generateIdentityKeypair();
    const sessionPubB64 = await exportPublicKeyB64(session.publicKey);

    // Only 3 of the 5 guardians approve (indices 0, 2, 4).
    const approving = [0, 2, 4];
    const approvals = await Promise.all(
      approving.map((i) =>
        approveAsGuardian(guardianKeys[i].privateKey, circle.shares[i], guardians[i].codeword, sessionPubB64)
      )
    );

    const reconstructed = await reconstructDEK(session.privateKey, approvals, 3, circle.recoveryWrappedDEK);
    expect(await raw(reconstructed)).toEqual(dekBefore);
  });

  it("rejects createRecoveryCircle when guardian count doesn't match n", async () => {
    const dek = await generateDEK();
    const kp = await generateIdentityKeypair();
    const guardians = [
      { userId: "only-one", identityPublicKey: await exportPublicKeyB64(kp.publicKey), codeword: "x" },
    ];
    await expect(createRecoveryCircle(dek, guardians, { k: 2, n: 3, delayMs: 1000 })).rejects.toThrow();
  });

  it("a guardian who approves with the wrong codeword can't produce a usable share", async () => {
    const dek = await generateDEK();
    const guardianKeys = await Promise.all(Array.from({ length: 3 }, () => generateIdentityKeypair()));
    const guardians = await Promise.all(
      guardianKeys.map(async (kp, i) => ({
        userId: `guardian-${i}`,
        identityPublicKey: await exportPublicKeyB64(kp.publicKey),
        codeword: `real codeword ${i}`,
      }))
    );
    const circle = await createRecoveryCircle(dek, guardians, { k: 3, n: 3, delayMs: 1000 });
    const session = await generateIdentityKeypair();
    const sessionPubB64 = await exportPublicKeyB64(session.publicKey);

    await expect(
      approveAsGuardian(guardianKeys[0].privateKey, circle.shares[0], "totally wrong codeword", sessionPubB64)
    ).rejects.toThrow();
  });
});
