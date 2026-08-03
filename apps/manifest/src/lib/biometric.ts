// Thin adapter over @lantern/core biometric. Binds this app's WebAuthn display
// name and its fixed PRF salt. ⚠️ FROZEN parameter, same discipline as
// VERIFIER_TEXT: unlock re-uses the salt stored on each enrollment, so old
// credentials stay valid — but new enrollments are made with this exact value.
// Change it and every freshly-enrolled device derives a different secret.
// The first 16 bytes spell "manifest-prf-v1" (padded); the rest are fixed random.
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

const PRF_SALT = new Uint8Array([
  0x6d, 0x61, 0x6e, 0x69, 0x66, 0x65, 0x73, 0x74, 0x2d, 0x70, 0x72, 0x66, 0x2d, 0x76, 0x31, 0x00,
  0x4a, 0x1d, 0x8c, 0xe3, 0x5b, 0x92, 0x07, 0xf4, 0xc6, 0x2e, 0xb8, 0x51, 0x9d, 0x0a, 0x77, 0xe9,
]);

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Manifest", PRF_SALT);
