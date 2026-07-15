// Thin adapter over @lantern/core biometric. Binds this app's WebAuthn display
// name and its fixed PRF salt. The salt MUST match existing enrollments — unlock
// re-uses the salt stored on each enrollment, so old credentials stay valid, and
// new enrollments are made with this exact value (unchanged from the live app).
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

const PRF_SALT = new Uint8Array([
  0x62, 0x61, 0x6c, 0x6c, 0x61, 0x73, 0x74, 0x2d, 0x70, 0x72, 0x66, 0x2d, 0x76, 0x31, 0x00, 0x00,
  0x3d, 0x91, 0x27, 0xb4, 0x6a, 0xf0, 0x18, 0x5c, 0xe3, 0x72, 0xa9, 0x46, 0x0b, 0xd8, 0x51, 0x2f,
]);

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Hearth", PRF_SALT);
