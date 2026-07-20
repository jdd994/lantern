// pairing.ts — link a new device by scanning a QR code shown on it, without
// typing a passphrase or an account password anywhere.
//
// Model: the new (unset-up) device generates a THROWAWAY ECDH keypair — same
// pattern as social recovery's per-attempt session key (see @lantern/core/
// recovery) — and shows its public half + a random pairing id as a QR code.
// An already-unlocked, already-signed-in device scans it, then ECIES-wraps a
// handoff payload (its live auth token, the vault's envelope metadata, and
// the DEK itself) to that public key. The server only ever relays that
// ciphertext, keyed by the pairing id; it never sees the token, the DEK, or
// the vault's contents. The new device decrypts with its throwaway private
// key, installs the vault locally, and is unlocked immediately.
//
// Honest tradeoff, stated once: this hands over the DEK itself (not a
// passphrase-wrapped copy), so linking is as strong as "this device was
// already unlocked and someone deliberately scanned a QR on it" — no typing,
// no re-proving the passphrase. That's a deliberate choice (see the pairing
// feature's design conversation) — it mirrors how Signal/WhatsApp device
// linking works, and is a materially different trust bar than recovery's
// Shamir-split, delay-gated flow, which exists for the "I have no unlocked
// device at all" case. The short server-side TTL (~5 minutes, enforced in
// @lantern/server/pairing) and the fact that a payload only every reaches
// someone who physically saw the QR are the whole defense here.

import {
  generateIdentityKeypair,
  exportPublicKeyB64,
  exportPrivateKeyB64,
  importPrivateKeyB64,
  type CipherBlob,
} from "./crypto";
import { wrapBytesForRecipient, unwrapBytesForRecipient, type WrappedBytes } from "./recovery";

const enc = new TextEncoder();
const dec = new TextDecoder();

// The new device's throwaway keypair for one pairing attempt. Kept in memory
// (or, if the flow needs to survive a reload, wherever the app already keeps
// its equally-throwaway RecoverySession) — never the account's real identity
// key, which is itself vault-locked and useless before the vault exists.
export type PairingSession = {
  id: string; // random, unguessable — the only handle the server has for this attempt
  publicKeyB64: string;
  privateKeyPkcs8B64: string;
};

export async function startPairingSession(): Promise<PairingSession> {
  const kp = await generateIdentityKeypair();
  return {
    id: crypto.randomUUID(),
    publicKeyB64: await exportPublicKeyB64(kp.publicKey),
    privateKeyPkcs8B64: await exportPrivateKeyB64(kp.privateKey),
  };
}

// Everything the new device needs to install the vault and be unlocked, with
// no passphrase and no separate sign-in. `dekRaw` is the live DEK's raw
// bytes (see crypto.ts's exportKeyRaw/importKeyRaw) — the one part of this
// payload that has no equivalent in the account-recovery flow.
export type PairingPayload = {
  token: string;
  userId: string;
  accountEmail: string;
  vault: {
    salt: number[];
    verifier: CipherBlob;
    iterations: number;
    wrappedDEK: CipherBlob;
  };
  dekRaw: number[];
};

/** Existing device, after scanning the QR: wrap the handoff to the new device's public key. */
export async function wrapPairingPayload(
  newDevicePubB64: string,
  payload: PairingPayload
): Promise<WrappedBytes> {
  return wrapBytesForRecipient(newDevicePubB64, enc.encode(JSON.stringify(payload)));
}

/** New device, once the server reports the payload delivered: unwrap it with the throwaway private key. */
export async function unwrapPairingPayload(
  sessionPrivB64: string,
  wrapped: WrappedBytes
): Promise<PairingPayload> {
  const priv = await importPrivateKeyB64(sessionPrivB64);
  const bytes = await unwrapBytesForRecipient(priv, wrapped.ephemeralPub, wrapped.wrapped);
  return JSON.parse(dec.decode(bytes)) as PairingPayload;
}

// ---- QR wire format --------------------------------------------------------
// Deliberately plain text, not a URL: this is scanned camera-to-camera between
// two instances of the same app, never opened as a link. `v1` so the format
// can change later without breaking an in-flight pairing across an app update.

const QR_PREFIX = "driftless-pair:v1:";

export function encodePairingQr(session: Pick<PairingSession, "id" | "publicKeyB64">): string {
  return `${QR_PREFIX}${session.id}:${session.publicKeyB64}`;
}

export function decodePairingQr(text: string): { id: string; publicKeyB64: string } | null {
  if (!text.startsWith(QR_PREFIX)) return null;
  const rest = text.slice(QR_PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  const id = rest.slice(0, i);
  const publicKeyB64 = rest.slice(i + 1);
  if (!id || !publicKeyB64) return null;
  return { id, publicKeyB64 };
}
