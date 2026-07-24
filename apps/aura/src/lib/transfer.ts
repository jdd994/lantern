// transfer.ts — the wire format for moving a setup between devices via a QR
// code. Deliberately a thin envelope, not a new payload shape: the JSON inside
// is exactly what exportSetup()/importSetup() already speak, so a QR scan, a
// pasted-text import, and a file import all land in the same parser. No
// server, no relay — the whole payload lives in the code itself.
const QR_PREFIX = "aura-setup:v1:";

export function encodeTransferQr(setupJson: string): string {
  return QR_PREFIX + setupJson;
}

// Strips the envelope if present; a bare setup JSON (e.g. pasted from "Copy as
// text") passes through unchanged, since importSetup validates the contents
// either way.
export function decodeTransferQr(text: string): string {
  return text.startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
}

export function isTransferQr(text: string): boolean {
  return text.startsWith(QR_PREFIX);
}
