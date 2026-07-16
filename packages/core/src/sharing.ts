// sharing.ts — the crypto for sharing a collection with someone you love, without
// the server ever being able to read it. Extracted from Driftless (shared strands)
// when Hearth became the second app to need it; the scheme is unchanged.
//
// The model (full design in apps/driftless/SHARING_PLAN.md):
//  • Every person has an ECDH P-256 IDENTITY keypair. The public half is
//    published; the private half is wrapped by their vault key, so the server
//    never sees it.
//  • A shared collection has its own random AES-256 DEK. Its contents are
//    encrypted with THAT key — not any one person's vault key — so every member
//    can read them, and the server can't.
//  • Handing out the DEK is ECIES-style: an ephemeral ECDH agreement with the
//    recipient's public key wraps it, so only they can unwrap it.
//  • An INVITE LINK carries a random secret in its URL fragment (which browsers
//    never send to a server). From it we derive two independent HKDF sub-keys: a
//    wrapKey that encrypts the DEK (opaque to the server) and a joinProof the
//    server only ever stores the HASH of. So a server breach yields neither the
//    key nor a way to join.
//
// ⚠️ THE `info` STRINGS ARE FROZEN, PER APP. HKDF's `info` is an input: change it
// and every existing invite link for that app stops working, silently. Each app
// binds its own pair once and never touches them again — the same discipline as
// the vault's VERIFIER_TEXT and the biometric PRF salt. That's why they're
// parameters here rather than constants: the core must not guess them.
import { exportPublicKeyB64, type CipherBlob, type WrappedKey } from "./crypto";

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

// ---- Collection keys (DEK) + ECIES wrapping ------------------------------

/** A DEK wrapped to one recipient: only their private identity key unwraps it. */
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

// ---- Invite links --------------------------------------------------------

export function randomLinkSecret(): Uint8Array {
  return randomBytes(32);
}

export function toBase64(u8: Uint8Array): string {
  return b64(u8);
}

/** URL-fragment-safe base64 — the link secret lives in the fragment. */
export function b64url(u8: Uint8Array): string {
  return b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/**
 * The two HKDF labels an app binds ONCE, forever. See the warning at the top:
 * changing either silently breaks that app's existing invite links.
 */
export type InviteLabels = { wrapInfo: string; proofInfo: string };

export async function deriveInviteKeys(
  linkSecret: Uint8Array,
  labels: InviteLabels
): Promise<{ wrapKey: CryptoKey; joinProof: Uint8Array }> {
  const base = await crypto.subtle.importKey("raw", toBuf(linkSecret), "HKDF", false, ["deriveBits"]);
  const salt = new Uint8Array(0);
  const wrapBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBuf(salt), info: enc.encode(labels.wrapInfo) },
    base,
    256
  );
  const wrapKey = await crypto.subtle.importKey("raw", wrapBits, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const proofBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: toBuf(salt), info: enc.encode(labels.proofInfo) },
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
