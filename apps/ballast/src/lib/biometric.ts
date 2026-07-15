// Thin adapter over @lantern/core biometric. Binds Ballast's WebAuthn display
// name; the mechanism (PRF-wrapped vault key) is the shared core.
import { enrollBiometric as coreEnroll } from "@lantern/core/biometric";
export { biometricSupported, unlockBiometric, type Enrollment } from "@lantern/core/biometric";

export const enrollBiometric = (vaultKeyRaw: number[]) => coreEnroll(vaultKeyRaw, "Ballast");
