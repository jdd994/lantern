// Thin adapter over @lantern/core biometric. Binds this app's WebAuthn display
// name and its fixed PRF salt. ⚠️ FROZEN parameter, same discipline as
// VERIFIER_TEXT: unlock re-uses the salt stored on each enrollment, so old
// credentials stay valid — but new enrollments are made with this exact value.
// Change it and every freshly-enrolled device derives a different secret.
// The first 16 bytes spell "almanac-prf-v1" (padded); the rest are fixed random.
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

const PRF_SALT = new Uint8Array([
  0x61, 0x6c, 0x6d, 0x61, 0x6e, 0x61, 0x63, 0x2d, 0x70, 0x72, 0x66, 0x2d, 0x76, 0x31, 0x00, 0x00,
  0x8e, 0x27, 0x4b, 0xd1, 0x39, 0xa6, 0x5c, 0x02, 0xe7, 0x91, 0x3f, 0x68, 0xb4, 0x1c, 0xd5, 0x7a,
]);

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Almanac", PRF_SALT);
