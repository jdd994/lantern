// @lantern/core — headless local-first primitives shared by every app.
// No React, no app-specific policy. Crypto (envelope encryption, verifier,
// identity keys) and biometric quick-unlock. Apps bind their own constants
// (verifier text, app name) in thin adapters over these.
export * from "./crypto";
export * from "./biometric";
export * from "./sync";
export * from "./api";
export * from "./vault";
export * from "./sharing";
export * from "./sharing-api";
export * from "./recovery";
export * from "./recovery-api";
export * from "./pairing";
export * from "./pairing-api";
export * from "./vibe";
export * from "./connect";
