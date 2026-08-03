// kit.ts — the paper recovery kit: a printed page in a fire safe instead of a
// password-reset email. For the solo vault (a Ballast with no circle), and as
// belt-and-suspenders anywhere.
//
// Shape: a random 130-bit recovery code (Crockford base32, grouped for human
// hands) derives a wrapping key; the vault's DEK is wrapped under it. The blob
// rides with the vault envelope — locally, and to the sync server when an
// account is connected — so the code works even on a replacement device after
// sign-in. The server holds only the opaque blob: brute-forcing a 130-bit code
// is not a thing, and the code itself lives on paper, never on a wire.
//
// The honesty that must ride on the printed page: anyone holding the code can
// open the vault. It is the deed to the house — a safe or a bank box, not a
// sticky note.

import type { CipherBlob } from "./crypto";
import { linkUnwrapDEK, linkWrapDEK } from "./sharing";

export type RecoveryKitBlob = {
  salt: number[]; // KDF salt — non-secret
  wrapped: CipherBlob; // the DEK, wrapped under the code-derived key
  createdAt: number;
};

// Crockford base32: no I, L, O, U — nothing a tired reader mistypes.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 26 chars × 5 bits = 130 bits of randomness, printed as 6 groups + 2:
// "K7Q2-9XMF-3T8B-J6RD-P4VW-XN2H-5C"
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(17)); // 136 bits, use 130
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    if (out.length >= 26) break;
  }
  return formatRecoveryCode(out);
}

export function formatRecoveryCode(raw: string): string {
  const clean = normalizeRecoveryCode(raw);
  return clean.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

// Reading a code back off paper is forgiving: case, spacing, dashes, and the
// classic o/0, i/l/1 confusions all resolve to the same code.
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

async function deriveKitKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeRecoveryCode(code)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  // The code is 130 random bits — the KDF is belt over suspenders, kept cheap.
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 100_000 },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Mint a kit for an unlocked vault: a fresh code + the DEK wrapped under it. */
export async function makeRecoveryKit(dek: CryptoKey): Promise<{ code: string; kit: RecoveryKitBlob }> {
  const code = generateRecoveryCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapped = await linkWrapDEK(await deriveKitKey(code, salt), dek);
  return { code, kit: { salt: Array.from(salt), wrapped, createdAt: Date.now() } };
}

/** Open a kit with the code off the paper. Returns the DEK, or null if the
 *  code doesn't fit this kit. Callers still verify against the vault verifier. */
export async function openRecoveryKit(code: string, kit: RecoveryKitBlob): Promise<CryptoKey | null> {
  try {
    const key = await deriveKitKey(code, new Uint8Array(kit.salt));
    return await linkUnwrapDEK(key, kit.wrapped);
  } catch {
    return null;
  }
}
