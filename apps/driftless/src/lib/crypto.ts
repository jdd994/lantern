// Thin adapter over @lantern/core, plus Driftless-only sharing crypto.
//
// The base (envelope encryption, PBKDF2/AES-GCM, identity keys, verifier) is the
// shared core. This file binds Driftless's verifier token ("driftless-ok" — MUST
// stay stable or existing vaults stop verifying) and keeps the ECIES / invite-link
// crypto that only Driftless (shared strands) uses. When a second app needs
// sharing, this moves to @lantern/core/sharing.
import {
  makeVerifier as coreMakeVerifier,
  checkVerifier as coreCheckVerifier,
  exportPublicKeyB64,
  type CipherBlob,
  type WrappedKey,
} from "@lantern/core/crypto";

export * from "@lantern/core/crypto";

// The per-app verifier token. Exported for @lantern/core/vault (setup / unlock /
// change-passphrase). MUST stay "driftless-ok" forever, or existing vaults break.
export const VERIFIER_TEXT = "driftless-ok";
export const makeVerifier = (key: CryptoKey): Promise<CipherBlob> => coreMakeVerifier(key, VERIFIER_TEXT);
export const checkVerifier = (key: CryptoKey, blob: CipherBlob): Promise<boolean> =>
  coreCheckVerifier(key, blob, VERIFIER_TEXT);

// ---- local helpers for the sharing crypto below (kept private, as in the base) ----
const enc = new TextEncoder();
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
export function importPublicKeyB64(s: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", toBuf(fromB64(s)), { name: "ECDH", namedCurve: "P-256" }, true, []);
}

// ---- Shared-strand keys (DEK) + ECIES wrapping --------------------------
// A shared strand has its own AES key (DEK). To share it, wrap it to a member's
// public key via an ephemeral ECDH agreement (only they can unwrap). Matches the
// server-verified scheme in SHARING_PLAN.md. (generateDEK comes from the core.)
export type WrappedDEK = { ephemeralPub: string; wrappedDEK: WrappedKey };

export async function wrapDEKForRecipient(recipientPubB64: string, dek: CryptoKey): Promise<WrappedDEK> {
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
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuf(iv) },
    wrapKey,
    await crypto.subtle.exportKey("raw", dek)
  );
  return {
    ephemeralPub: await exportPublicKeyB64(eph.publicKey),
    wrappedDEK: { iv: b64(iv), data: b64(new Uint8Array(ct)) },
  };
}

export async function unwrapDEK(
  myPriv: CryptoKey,
  ephemeralPubB64: string,
  wrapped: WrappedKey
): Promise<CryptoKey> {
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
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// ---- Invite links (S6) --------------------------------------------------
// A link carries a random secret in its URL fragment. From it we derive two
// independent HKDF sub-keys: a wrapKey that encrypts the strand DEK (opaque to
// the server) and a joinProof the server checks only by hash. See SHARING_PLAN.
export function randomLinkSecret(): Uint8Array {
  return randomBytes(32);
}

export function toBase64(u8: Uint8Array): string {
  return b64(u8);
}

// URL-fragment-safe base64 for the link secret.
export function b64url(u8: Uint8Array): string {
  return b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export async function deriveInviteKeys(
  linkSecret: Uint8Array
): Promise<{ wrapKey: CryptoKey; joinProof: Uint8Array }> {
  const base = await crypto.subtle.importKey("raw", toBuf(linkSecret), "HKDF", false, ["deriveBits"]);
  const salt = new Uint8Array(0);
  const wrapBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBuf(salt), info: enc.encode("driftless-invite-wrap") },
    base,
    256
  );
  const wrapKey = await crypto.subtle.importKey("raw", wrapBits, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const proofBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBuf(salt), info: enc.encode("driftless-invite-proof") },
    base,
    256
  );
  return { wrapKey, joinProof: new Uint8Array(proofBits) };
}

export async function sha256B64(bytes: Uint8Array): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", toBuf(bytes))));
}

export async function linkWrapDEK(wrapKey: CryptoKey, dek: CryptoKey): Promise<CipherBlob> {
  const raw = await crypto.subtle.exportKey("raw", dek);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBuf(iv) }, wrapKey, raw);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ct)) };
}

export async function linkUnwrapDEK(wrapKey: CryptoKey, blob: CipherBlob): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuf(new Uint8Array(blob.iv)) },
    wrapKey,
    toBuf(new Uint8Array(blob.data))
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}
