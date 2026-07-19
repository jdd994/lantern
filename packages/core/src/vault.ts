// vault.ts — the vault lifecycle crypto, as pure functions.
//
// This is the delicate heart the three apps were each doing inline in their
// setup / unlock / change-passphrase paths: create a vault, open one (migrating a
// legacy vault to the envelope model on the way), and re-wrap the data key under
// a new passphrase. No React, no storage, no state — just crypto in and secrets
// out — so it's exhaustively unit-testable and identical everywhere.
//
// The DEK (data key) encrypts all app data and NEVER changes across a passphrase
// change; the passphrase only derives a KEK that wraps it. `verifierText` is the
// per-app token bound to each app's vault (e.g. "ballast-ok") — it MUST stay
// stable for an app forever, or existing vaults stop verifying.

import {
  deriveKeyFromSalt,
  generateDEK,
  wrapVaultKey,
  unwrapVaultKey,
  makeVerifier,
  checkVerifier,
  newSalt,
  exportKeyRaw,
  generateIdentityKeypair,
  exportPublicKeyB64,
  wrapPrivateKey,
  PBKDF2_ITERATIONS,
  type CipherBlob,
  type WrappedKey,
} from "./crypto";

// The persisted (non-secret-at-rest) fields a fresh vault produces.
export type VaultSecrets = {
  salt: number[];
  verifier: CipherBlob;
  wrappedDEK: CipherBlob;
  iterations: number;
  identityPublic: string;
  identityPrivate: WrappedKey;
};

// Just the fields open/rewrap read from an existing vault.
export type StoredVault = {
  salt: number[];
  verifier: CipherBlob;
  iterations?: number;
  wrappedDEK?: CipherBlob | null;
};

// Legacy vaults (created before the envelope model) omit iterations; that era
// used this work factor. New vaults always store their own.
const LEGACY_ITERATIONS = 250_000;

// Create a fresh vault: a random DEK, wrapped under a KEK from the passphrase,
// plus an identity keypair (public plaintext, private wrapped by the DEK). Returns
// the DEK to hold in memory and the secrets to persist.
export async function createVault(
  passphrase: string,
  verifierText: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ dek: CryptoKey; secrets: VaultSecrets }> {
  const salt = newSalt();
  const kek = await deriveKeyFromSalt(passphrase, salt, iterations);
  const dek = await generateDEK();
  const kp = await generateIdentityKeypair();
  return {
    dek,
    secrets: {
      salt,
      verifier: await makeVerifier(dek, verifierText),
      wrappedDEK: await wrapVaultKey(kek, dek),
      iterations,
      identityPublic: await exportPublicKeyB64(kp.publicKey),
      identityPrivate: await wrapPrivateKey(dek, kp.privateKey),
    },
  };
}

// Unlock: derive the DEK from the passphrase. Returns null on a wrong passphrase.
// For a legacy vault (no wrappedDEK) the derived key IS the data key, so we
// migrate in place — `migratedWrappedDEK` is returned for the caller to persist
// (nothing is re-encrypted; the DEK is unchanged).
export type OpenResult = { dek: CryptoKey; migratedWrappedDEK?: CipherBlob };

export async function openVault(
  passphrase: string,
  vault: StoredVault,
  verifierText: string
): Promise<OpenResult | null> {
  const kek = await deriveKeyFromSalt(passphrase, vault.salt, vault.iterations ?? LEGACY_ITERATIONS);

  if (vault.wrappedDEK) {
    let dek: CryptoKey;
    try {
      dek = await unwrapVaultKey(kek, vault.wrappedDEK);
    } catch {
      return null; // wrong passphrase — GCM auth failed
    }
    if (!(await checkVerifier(dek, vault.verifier, verifierText))) return null;
    return { dek };
  }

  // Legacy vault: verify, then migrate (the derived key becomes the DEK).
  if (!(await checkVerifier(kek, vault.verifier, verifierText))) return null;
  const dek = kek;
  return { dek, migratedWrappedDEK: await wrapVaultKey(kek, dek) };
}

// Validate a raw DEK (e.g. from a biometric unwrap) against the vault verifier.
export function verifyDEK(dek: CryptoKey, verifier: CipherBlob, verifierText: string): Promise<boolean> {
  return checkVerifier(dek, verifier, verifierText);
}

// Change the passphrase: confirm the current one, then re-wrap the SAME DEK under
// a fresh salt + the new passphrase. No data is re-encrypted. Returns the vault
// fields to persist, or null if the current passphrase is wrong.
export async function rewrapVault(
  dek: CryptoKey,
  current: string,
  next: string,
  vault: StoredVault,
  verifierText: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ salt: number[]; verifier: CipherBlob; wrappedDEK: CipherBlob; iterations: number } | null> {
  const curKek = await deriveKeyFromSalt(current, vault.salt, vault.iterations ?? LEGACY_ITERATIONS);
  let ok = false;
  try {
    if (vault.wrappedDEK) {
      const a = await exportKeyRaw(await unwrapVaultKey(curKek, vault.wrappedDEK));
      const b = await exportKeyRaw(dek);
      ok = a.length === b.length && a.every((x, i) => x === b[i]);
    } else {
      ok = await checkVerifier(curKek, vault.verifier, verifierText);
    }
  } catch {
    ok = false;
  }
  if (!ok) return null;

  const salt = newSalt();
  const kek = await deriveKeyFromSalt(next, salt, iterations);
  return {
    salt,
    verifier: await makeVerifier(dek, verifierText),
    wrappedDEK: await wrapVaultKey(kek, dek),
    iterations,
  };
}

// Set a brand-new passphrase from an already-known DEK — no current-passphrase
// check, unlike rewrapVault. This is what social recovery calls once it has
// reconstructed the DEK via the guardian circle (see @lantern/core/recovery)
// instead of via a passphrase; there is no "current passphrase" to confirm.
export async function setPassphraseFromDEK(
  dek: CryptoKey,
  next: string,
  verifierText: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ salt: number[]; verifier: CipherBlob; wrappedDEK: CipherBlob; iterations: number }> {
  const salt = newSalt();
  const kek = await deriveKeyFromSalt(next, salt, iterations);
  return {
    salt,
    verifier: await makeVerifier(dek, verifierText),
    wrappedDEK: await wrapVaultKey(kek, dek),
    iterations,
  };
}
