// Thin adapter over @lantern/core. Everything is the shared core crypto; this
// file only binds Ballast's own verifier token. That token MUST stay "ballast-ok"
// forever — changing it would break every existing vault's verifier.
import {
  makeVerifier as coreMakeVerifier,
  checkVerifier as coreCheckVerifier,
  type CipherBlob,
} from "@lantern/core/crypto";

export * from "@lantern/core/crypto";

const VERIFIER_TEXT = "ballast-ok";
export const makeVerifier = (key: CryptoKey): Promise<CipherBlob> => coreMakeVerifier(key, VERIFIER_TEXT);
export const checkVerifier = (key: CryptoKey, blob: CipherBlob): Promise<boolean> =>
  coreCheckVerifier(key, blob, VERIFIER_TEXT);
