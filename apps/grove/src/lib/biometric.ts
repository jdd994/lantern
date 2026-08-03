// Thin adapter over @lantern/core biometric. Binds this app's WebAuthn display
// name and its fixed PRF salt. ⚠️ FROZEN parameter, same discipline as
// VERIFIER_TEXT: unlock re-uses the salt stored on each enrollment, so old
// credentials stay valid — but new enrollments are made with this exact value.
// Change it and every freshly-enrolled device derives a different secret.
// The first 16 bytes spell "grove-prf-v1" (padded); the rest are fixed random.
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

const PRF_SALT = new Uint8Array([
  0x67, 0x72, 0x6f, 0x76, 0x65, 0x2d, 0x70, 0x72, 0x66, 0x2d, 0x76, 0x31, 0x00, 0x00, 0x00, 0x00,
  0x97, 0x64, 0x60, 0x7f, 0xb4, 0x3f, 0xcb, 0xb2, 0x69, 0x8b, 0x3d, 0x82, 0xd3, 0x6e, 0xfb, 0xdb,
]);

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Grove", PRF_SALT);
