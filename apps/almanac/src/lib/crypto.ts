// Thin adapter over @lantern/core. Everything is the shared core crypto; this
// file only binds Almanac's own verifier token. That token MUST stay
// "almanac-ok" forever — changing it would break every existing vault's
// verifier.
import {
  makeVerifier as coreMakeVerifier,
  checkVerifier as coreCheckVerifier,
  type CipherBlob,
} from "@lantern/core/crypto";
import { deriveInviteKeys as coreDeriveInviteKeys, type InviteLabels } from "@lantern/core/sharing";

export * from "@lantern/core/crypto";
// Social recovery's crypto needs no app-specific constant either.
export * from "@lantern/core/recovery";
// The sharing crypto that needs no app-specific constant passes straight through.
export {
  randomLinkSecret,
  toBase64,
  b64url,
  fromB64url,
  sha256B64,
  linkWrapDEK,
  linkUnwrapDEK,
} from "@lantern/core/sharing";

// The per-app verifier token. Exported for @lantern/core/vault (setup / unlock /
// change-passphrase). MUST stay "almanac-ok" forever, or existing vaults break.
export const VERIFIER_TEXT = "almanac-ok";

// HKDF `info` strings for invite links. ⚠️ FROZEN forever, same discipline as
// VERIFIER_TEXT: change either and every invite link already out in the world
// silently stops working.
export const INVITE_LABELS: InviteLabels = {
  wrapInfo: "almanac-invite-wrap",
  proofInfo: "almanac-invite-proof",
};

/** Almanac's invite keys — the shared HKDF bound to this app's labels. */
export const deriveInviteKeys = (
  linkSecret: Uint8Array
): Promise<{ wrapKey: CryptoKey; joinProof: Uint8Array }> =>
  coreDeriveInviteKeys(linkSecret, INVITE_LABELS);
export const makeVerifier = (key: CryptoKey): Promise<CipherBlob> => coreMakeVerifier(key, VERIFIER_TEXT);
export const checkVerifier = (key: CryptoKey, blob: CipherBlob): Promise<boolean> =>
  coreCheckVerifier(key, blob, VERIFIER_TEXT);
