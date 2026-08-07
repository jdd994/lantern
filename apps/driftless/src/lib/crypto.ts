// Thin adapter over @lantern/core.
//
// Everything real lives in the shared core now: the base (envelope encryption,
// PBKDF2/AES-GCM, identity keys, verifier) and — since Hearth became the second
// app to need it — the sharing crypto (ECIES DEK wrapping + invite links). This
// file's only job is to bind Driftless's frozen constants and re-export, so the
// rest of the app imports exactly what it always did.
import {
  makeVerifier as coreMakeVerifier,
  checkVerifier as coreCheckVerifier,
  type CipherBlob,
} from "@lantern/core/crypto";
import { deriveInviteKeys as coreDeriveInviteKeys, type InviteLabels } from "@lantern/core/sharing";

export * from "@lantern/core/crypto";
// Social recovery's crypto needs no app-specific constant either — same
// reasoning as the sharing exports below.
export * from "@lantern/core/recovery";
// Same for QR device linking.
export * from "@lantern/core/pairing";
// The sharing crypto that needs no app-specific constant passes straight through.
export {
  importPublicKeyB64,
  wrapDEKForRecipient,
  unwrapDEK,
  randomLinkSecret,
  toBase64,
  b64url,
  fromB64url,
  sha256B64,
  linkWrapDEK,
  linkUnwrapDEK,
  type WrappedDEK,
} from "@lantern/core/sharing";

// ---- Driftless's frozen constants ---------------------------------------
// Both are inputs to key derivation and MUST NEVER CHANGE:
//  • VERIFIER_TEXT — change it and every existing vault stops verifying.
//  • INVITE_LABELS — HKDF `info` strings; change either and every invite link
//    already out in the world silently stops working.
// Guarded by crypto.sharing.test.ts, which pins golden vectors.

export const VERIFIER_TEXT = "driftless-ok";
export const makeVerifier = (key: CryptoKey): Promise<CipherBlob> => coreMakeVerifier(key, VERIFIER_TEXT);
export const checkVerifier = (key: CryptoKey, blob: CipherBlob): Promise<boolean> =>
  coreCheckVerifier(key, blob, VERIFIER_TEXT);

export const INVITE_LABELS: InviteLabels = {
  wrapInfo: "driftless-invite-wrap",
  proofInfo: "driftless-invite-proof",
};

/** Driftless's invite keys — the same signature the app has always called. */
export const deriveInviteKeys = (
  linkSecret: Uint8Array
): Promise<{ wrapKey: CryptoKey; joinProof: Uint8Array }> =>
  coreDeriveInviteKeys(linkSecret, INVITE_LABELS);
