// biometric.ts
// Optional, per-device quick unlock built on WebAuthn's PRF extension.
//
// A platform passkey (Face ID / Touch ID / fingerprint) can emit a stable secret
// after a biometric check. We use that secret to wrap a copy of the vault key on
// THIS device. The passphrase stays the durable root — this never replaces it,
// and a platform that can't do PRF simply falls back to typing it.
//
// The wrapped key never syncs. It is meaningless off this device.
//
// The PRF salt is passed in per app (each app binds its own fixed salt) and is
// stored on the enrollment, so UNLOCK re-uses the exact salt the credential was
// enrolled with — enrollments stay valid even if an app ever changes its salt.

import { wrapWithSecret, unwrapWithSecret, type CipherBlob } from "./crypto";

function rand(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export type Enrollment = {
  credentialId: number[];
  prfSalt: number[];
  wrapped: CipherBlob;
};

export async function biometricSupported(): Promise<boolean> {
  try {
    return (
      typeof window !== "undefined" &&
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

async function assertPrf(credentialId: number[], prfSalt: Uint8Array): Promise<ArrayBuffer | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: "public-key", id: new Uint8Array(credentialId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  } as unknown as CredentialRequestOptions)) as PublicKeyCredential | null;
  const ext = assertion?.getClientExtensionResults() as
    | { prf?: { results?: { first?: ArrayBuffer } } }
    | undefined;
  return ext?.prf?.results?.first;
}

// Create a platform passkey with PRF and wrap the vault key with its output.
// Returns null when the platform can't produce a PRF secret, in which case the
// caller keeps the passphrase-only flow.
export async function enrollBiometric(
  vaultKeyRaw: number[],
  appName: string,
  prfSalt: Uint8Array
): Promise<Enrollment | null> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: appName, id: location.hostname },
      user: { id: rand(16), name: appName.toLowerCase(), displayName: appName },
      challenge: rand(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "required",
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  } as unknown as CredentialCreationOptions)) as PublicKeyCredential | null;
  if (!cred) return null;

  const ext = cred.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  if (!ext.prf || ext.prf.enabled === false) return null; // no PRF here

  const credentialId = Array.from(new Uint8Array(cred.rawId));
  // Some platforms return the secret at create time; others need an assertion.
  const secret = ext.prf.results?.first ?? (await assertPrf(credentialId, prfSalt));
  if (!secret) return null;

  return {
    credentialId,
    prfSalt: Array.from(prfSalt),
    wrapped: await wrapWithSecret(secret, vaultKeyRaw),
  };
}

export async function unlockBiometric(enr: Enrollment): Promise<number[] | null> {
  // Re-use the salt this credential was enrolled with (not a module constant),
  // so an enrollment stays valid regardless of the app's current salt.
  const secret = await assertPrf(enr.credentialId, new Uint8Array(enr.prfSalt));
  if (!secret) return null;
  try {
    return await unwrapWithSecret(secret, enr.wrapped);
  } catch {
    return null;
  }
}
