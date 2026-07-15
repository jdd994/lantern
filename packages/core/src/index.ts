// @lantern/core — headless local-first primitives shared by every app.
// No React, no app-specific policy. Crypto (envelope encryption, verifier,
// identity keys) and biometric quick-unlock. Apps bind their own constants
// (verifier text, app name) in thin adapters over these.
export * from "./crypto";
export * from "./biometric";
export * from "./sync";
export * from "./api";
export * from "./vault";
