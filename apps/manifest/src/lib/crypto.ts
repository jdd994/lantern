// Thin adapter over @lantern/core. Everything is the shared core crypto; this
// file only binds Manifest's own verifier token. That token MUST stay
// "manifest-ok" forever — changing it would break every existing vault's
// verifier.
import {
  makeVerifier as coreMakeVerifier,
  checkVerifier as coreCheckVerifier,
  type CipherBlob,
} from "@lantern/core/crypto";

export * from "@lantern/core/crypto";
// Social recovery's crypto needs no app-specific constant either.
export * from "@lantern/core/recovery";

// The per-app verifier token. Exported for @lantern/core/vault (setup / unlock /
// change-passphrase). MUST stay "manifest-ok" forever, or existing vaults break.
export const VERIFIER_TEXT = "manifest-ok";
export const makeVerifier = (key: CryptoKey): Promise<CipherBlob> => coreMakeVerifier(key, VERIFIER_TEXT);
export const checkVerifier = (key: CryptoKey, blob: CipherBlob): Promise<boolean> =>
  coreCheckVerifier(key, blob, VERIFIER_TEXT);
