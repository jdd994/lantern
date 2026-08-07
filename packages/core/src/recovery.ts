// recovery.ts — social recovery: K-of-N trusted guardians can jointly help
// someone regain vault access, without the server (or any single guardian)
// ever holding the recovery secret.
//
// Model:
//  • A fresh random AES-256 "recovery key" (RK) wraps the vault's DEK — the
//    same KEK-wraps-DEK envelope vault.ts already uses for a passphrase, just
//    with RK standing in for the passphrase-derived KEK. Rotating guardians
//    later means a new RK + a cheap re-wrap; the DEK and all encrypted data
//    are untouched.
//  • RK's raw bytes are split with Shamir's Secret Sharing (GF(256), the same
//    field AES itself uses) into N shares; any K reconstruct RK exactly, and
//    K-1 reveal nothing about it.
//  • Each guardian's share is DOUBLE-wrapped: an inner AES-GCM layer keyed by
//    a CODEWORD the owner tells that guardian out loud, never digitally — so
//    a guardian who only has their identity private key still can't read
//    their own share; an outer ECIES layer (the same "encrypt to someone's
//    public key" scheme as sharing.ts) so the server never sees even the
//    codeword-encrypted share.
//  • A guardian approving a request re-wraps their (now-decrypted) share to
//    the RECOVERING DEVICE's public key — not the account's real identity
//    key, which is itself DEK-wrapped and therefore locked. See the fresh
//    "session keypair" each app generates per recovery attempt.
//
// Honest limits, stated once here rather than scattered: combineShares has no
// integrity check of its own — feed it a wrong or short share set and it
// silently returns wrong bytes. That's fine ONLY because the result is
// immediately used as an AES-GCM key via crypto.ts's unwrapVaultKey, which
// fails loudly (auth tag) on a wrong key — never trust combineShares' output
// for anything else. And codeword verification happens entirely on the
// guardian's device, so no server-side rate limit can throttle guessing —
// the only real defense is codeword entropy (diceware-grade, not a word).

import {
  deriveKeyFromSalt,
  encryptString,
  decryptString,
  exportKeyRaw,
  importKeyRaw,
  generateDEK,
  wrapVaultKey,
  unwrapVaultKey,
  exportPublicKeyB64,
  newSalt,
  PBKDF2_ITERATIONS,
  type CipherBlob,
  type WrappedKey,
} from "./crypto";
import { importPublicKeyB64 } from "./sharing";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBuf(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}
function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
function b64(u8: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---- GF(256) arithmetic, AES's field (reduction poly 0x11B) --------------
// Direct "Russian peasant" multiplication + Fermat's-little-theorem inverse
// (a^-1 = a^254, since the multiplicative group has order 255) — no log/exp
// table, so no dependency on picking a primitive generator. (0x02, the
// obvious first guess, is NOT primitive for this polynomial — a table built
// on it silently cycles early and corrupts every share. 0x03 is, but the
// direct approach sidesteps the whole question.)

function gfMul(a: number, b: number): number {
  let p = 0;
  let x = a & 0xff;
  let y = b & 0xff;
  for (let i = 0; i < 8; i++) {
    if (y & 1) p ^= x;
    const carry = x & 0x80;
    x = (x << 1) & 0xff;
    if (carry) x ^= 0x1b;
    y >>= 1;
  }
  return p;
}
function gfInverse(a: number): number {
  if (a === 0) throw new Error("recovery: GF(256) inverse of zero");
  let result = 1;
  let base = a;
  let exp = 254;
  while (exp > 0) {
    if (exp & 1) result = gfMul(result, base);
    base = gfMul(base, base);
    exp >>= 1;
  }
  return result;
}
function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  return gfMul(a, gfInverse(b));
}

// ---- Shamir's Secret Sharing, byte-wise over GF(256) ----------------------

export type ShamirShare = { index: number; bytes: number[] };

/** Split `secret` into `n` shares, any `k` of which reconstruct it exactly. */
export function splitSecret(secret: Uint8Array, k: number, n: number): ShamirShare[] {
  if (k < 2 || n < k || n > 255) {
    throw new Error("recovery: require 2 <= k <= n <= 255");
  }
  const shares: ShamirShare[] = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    bytes: new Array(secret.length),
  }));
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Random polynomial of degree k-1 with constant term = this secret byte.
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[byteIdx];
    const rnd = randomBytes(k - 1);
    for (let c = 1; c < k; c++) coeffs[c] = rnd[c - 1];
    for (let s = 0; s < n; s++) {
      const x = s + 1;
      let y = 0;
      for (let c = k - 1; c >= 0; c--) y = gfMul(y, x) ^ coeffs[c]; // Horner's method
      shares[s].bytes[byteIdx] = y;
    }
  }
  return shares;
}

/** Reconstruct the original secret from >= k shares via Lagrange interpolation at x=0. */
export function combineShares(shares: ShamirShare[], k: number): Uint8Array {
  if (shares.length < k) throw new Error("recovery: not enough shares to reconstruct");
  const used = shares.slice(0, k);
  const seen = new Set(used.map((s) => s.index));
  if (seen.size !== used.length) throw new Error("recovery: duplicate share index");
  const len = used[0].bytes.length;
  if (!used.every((s) => s.bytes.length === len)) throw new Error("recovery: mismatched share length");

  const out = new Uint8Array(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let acc = 0;
    for (let i = 0; i < used.length; i++) {
      const xi = used[i].index;
      const yi = used[i].bytes[byteIdx];
      let li = 1;
      for (let m = 0; m < used.length; m++) {
        if (m === i) continue;
        const xm = used[m].index;
        li = gfMul(li, gfDiv(xm, xm ^ xi));
      }
      acc ^= gfMul(yi, li);
    }
    out[byteIdx] = acc;
  }
  return out;
}

// ---- Generalized ECIES: wrap arbitrary bytes to someone's identity key ----
// Same scheme as sharing.ts's wrapDEKForRecipient/unwrapDEK, but for raw
// bytes instead of a CryptoKey — kept here rather than widening that frozen
// module (see its own file-top warning about not touching its shape).

export type WrappedBytes = { ephemeralPub: string; wrapped: WrappedKey };

export async function wrapBytesForRecipient(recipientPubB64: string, bytes: Uint8Array): Promise<WrappedBytes> {
  const recipient = await importPublicKeyB64(recipientPubB64);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const wrapKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipient },
    eph.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBuf(iv) }, wrapKey, toBuf(bytes));
  return {
    ephemeralPub: await exportPublicKeyB64(eph.publicKey),
    wrapped: { iv: b64(iv), data: b64(new Uint8Array(ct)) },
  };
}

export async function unwrapBytesForRecipient(
  myPriv: CryptoKey,
  ephemeralPubB64: string,
  wrapped: WrappedKey
): Promise<Uint8Array> {
  const eph = await importPublicKeyB64(ephemeralPubB64);
  const wrapKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: eph },
    myPriv,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuf(fromB64(wrapped.iv)) },
    wrapKey,
    toBuf(fromB64(wrapped.data))
  );
  return new Uint8Array(raw);
}

// ---- Codeword-gated guardian shares ---------------------------------------
// Double-wrap: inner layer is AES-GCM keyed by the out-of-band codeword
// (never transmitted digitally); outer layer is ECIES to the guardian's
// identity public key. Both must be satisfied to recover the share.

export type GuardianShare = {
  ephemeralPub: string;
  wrapped: WrappedKey; // outer ECIES layer, wrapping the codeword-encrypted share
  codewordSalt: number[];
  codewordIterations: number;
};

export async function wrapShareForGuardian(
  codeword: string,
  guardianPubB64: string,
  share: ShamirShare,
  iterations: number = PBKDF2_ITERATIONS
): Promise<GuardianShare> {
  const salt = newSalt();
  const codewordKey = await deriveKeyFromSalt(codeword, salt, iterations);
  const inner = await encryptString(codewordKey, JSON.stringify(share));
  const outer = await wrapBytesForRecipient(guardianPubB64, enc.encode(JSON.stringify(inner)));
  return { ephemeralPub: outer.ephemeralPub, wrapped: outer.wrapped, codewordSalt: salt, codewordIterations: iterations };
}

/** Throws (AES-GCM auth failure) on a wrong codeword OR a wrong identity key. */
export async function unwrapShareFromGuardian(
  myPriv: CryptoKey,
  g: GuardianShare,
  codeword: string
): Promise<ShamirShare> {
  const outerBytes = await unwrapBytesForRecipient(myPriv, g.ephemeralPub, g.wrapped);
  const inner = JSON.parse(dec.decode(outerBytes)) as CipherBlob;
  const codewordKey = await deriveKeyFromSalt(codeword, g.codewordSalt, g.codewordIterations);
  return JSON.parse(await decryptString(codewordKey, inner)) as ShamirShare;
}

// ---- The circle: owner setup, guardian approval, requester reconstruction -

export type RecoveryConfig = { k: number; n: number; delayMs: number };

/**
 * Owner setup (or rotation): a fresh RK wraps the current DEK, RK's bytes are
 * Shamir-split k-of-n, and each share is double-wrapped for one guardian.
 * `guardians.length` must equal `config.n`.
 */
export async function createRecoveryCircle(
  dek: CryptoKey,
  guardians: { userId: string; identityPublicKey: string; codeword: string }[],
  config: RecoveryConfig
): Promise<{ recoveryWrappedDEK: CipherBlob; shares: (GuardianShare & { userId: string; shareIndex: number })[] }> {
  const { k, n } = config;
  if (guardians.length !== n) throw new Error("recovery: guardian count must equal n");

  const rk = await generateDEK(); // any random AES-256 key — reused as the recovery key
  const recoveryWrappedDEK = await wrapVaultKey(rk, dek);
  const rkBytes = new Uint8Array(await exportKeyRaw(rk));
  const shamirShares = splitSecret(rkBytes, k, n);

  const shares = await Promise.all(
    guardians.map(async (guardian, i) => {
      const share = shamirShares[i];
      const wrapped = await wrapShareForGuardian(guardian.codeword, guardian.identityPublicKey, share);
      return { ...wrapped, userId: guardian.userId, shareIndex: share.index };
    })
  );
  return { recoveryWrappedDEK, shares };
}

/** Guardian approval: unwrap my own share, then re-wrap it to the requester's throwaway session key. */
export async function approveAsGuardian(
  myPriv: CryptoKey,
  g: GuardianShare,
  codeword: string,
  requesterSessionPubB64: string
): Promise<WrappedBytes> {
  const share = await unwrapShareFromGuardian(myPriv, g, codeword);
  return wrapBytesForRecipient(requesterSessionPubB64, enc.encode(JSON.stringify(share)));
}

/**
 * Requester reconstruction, once >= k approvals have arrived (and the server-
 * enforced delay window has cleared). Throws loudly on a wrong/insufficient
 * set of approvals via unwrapVaultKey's auth tag, never returns a plausible
 * wrong DEK silently.
 */
export async function reconstructDEK(
  sessionPriv: CryptoKey,
  approvals: WrappedBytes[],
  k: number,
  recoveryWrappedDEK: CipherBlob
): Promise<CryptoKey> {
  const shares: ShamirShare[] = [];
  for (const a of approvals) {
    const bytes = await unwrapBytesForRecipient(sessionPriv, a.ephemeralPub, a.wrapped);
    shares.push(JSON.parse(dec.decode(bytes)) as ShamirShare);
  }
  const rkBytes = combineShares(shares, k);
  const rk = await importKeyRaw(Array.from(rkBytes));
  return unwrapVaultKey(rk, recoveryWrappedDEK);
}
