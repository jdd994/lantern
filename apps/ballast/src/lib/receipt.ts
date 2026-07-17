// receipt.ts
// The seam where receipt reading plugs in. For most of this file's life the
// active reader was `noReader` and this seam did nothing, on purpose — the
// history of that decision is worth keeping:
//
//   - **Cloud OCR** (Google Vision, AWS Textract) is accurate and completely
//     unacceptable. It means uploading a photograph of your receipt — merchant,
//     line items, timestamp, often the last four digits of your card — to a third
//     party in the clear. That is a worse deal than the tier-3 aggregator rung,
//     because at least an aggregator is a regulated financial institution. This
//     is forbidden by invariant #6 and is not a trade-off we will revisit.
//
//   - **On-device OCR** keeps the data private, which is the part that matters.
//     We held off while the only option was a heavy engine with mediocre results,
//     and turned it on once the cost came down to something honest: the engine
//     (ocr.ts) is lazy-loaded only when you actually photograph a receipt, every
//     byte of it is served from our own origin, and the CSP needed no changes.
//     The photo never leaves the device. The receipt-zone badge still says
//     tier 0 because it is still true.
//
// A read is a *draft*, never a fact. Every field lands in an editable form and
// the user confirms, so a bad read costs the eight seconds of typing it tried to
// save — never a corrupted ledger.
//
// The one rule that must survive any future reader swap: **the image never
// leaves the device.** A `ReceiptReader` that makes a network call is not a
// valid implementation of this interface, and the CSP in public/_headers will
// stop it at the browser regardless of what the code says.

import type { Money } from "./money";

// A line item as read off the tape. No category here — the reader reports what
// the paper says; deciding what it *means* happens in the form, by the human.
export type ReceiptDraftItem = {
  label: string;
  amount: Money; // positive magnitude
};

// What a reader can offer. Everything is optional — a partial read is useful,
// and a reader that only manages to find the total has still saved you the
// fiddliest bit of typing.
export type ReceiptDraft = {
  amount?: Money; // positive magnitude; the form applies the sign
  merchant?: string;
  at?: number;
  items?: ReceiptDraftItem[];
};

export type ReceiptReader = {
  name: string;
  // Whether this reader can run here and now (WASM present, workers available…).
  available: () => Promise<boolean>;
  // Must be pure-local. See the note above.
  read: (image: Blob, currency: string) => Promise<ReceiptDraft>;
};

// The honest fallback: knows nothing, says so.
export const noReader: ReceiptReader = {
  name: "none",
  available: async () => false,
  read: async () => ({}),
};

let active: ReceiptReader = noReader;

// The swap point. main.tsx sets the Tesseract reader here at startup.
export function setReceiptReader(reader: ReceiptReader): void {
  active = reader;
}

export function activeReader(): ReceiptReader {
  return active;
}

// Called by the capture flow. Returns whatever the active reader can defend —
// possibly nothing, in which case the form simply opens blank and the user
// types, exactly as before this feature existed.
export async function readReceipt(image: Blob, currency: string): Promise<ReceiptDraft> {
  try {
    if (!(await active.available())) return {};
    return await active.read(image, currency);
  } catch {
    // A failed read must never block logging an expense. Fall back to the thing
    // that always works: the human types the number.
    return {};
  }
}
