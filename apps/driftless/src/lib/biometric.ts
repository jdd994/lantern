// Thin adapter over @lantern/core biometric. Binds this app's WebAuthn display
// name and its fixed PRF salt. The salt MUST match existing enrollments — unlock
// re-uses the salt stored on each enrollment, so old credentials stay valid, and
// new enrollments are made with this exact value (unchanged from the live app).
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

const PRF_SALT = new Uint8Array([
  0x64, 0x72, 0x69, 0x66, 0x74, 0x6c, 0x65, 0x73, 0x73, 0x2d, 0x70, 0x72, 0x66, 0x2d, 0x76, 0x31,
  0x9a, 0x3c, 0x71, 0x05, 0xe8, 0x2b, 0x4d, 0x16, 0xa7, 0x5f, 0xc0, 0x38, 0x91, 0x6e, 0x2d, 0x44,
]);

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Driftless", PRF_SALT);
