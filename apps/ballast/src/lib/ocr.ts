// ocr.ts
// The Tesseract reader — on-device OCR for receipt photos.
//
// Privacy shape, because for a receipt photo it is the whole point:
//
//   - The engine runs entirely in this browser, in a Web Worker, in WASM. The
//     photo is handed to that worker and nowhere else. No network request
//     carries image data, and the CSP (connect-src allowlist) would block one
//     that tried.
//   - Every asset — worker JS, WASM core, English model — is served from OUR
//     origin out of /ocr/ (vendored from node_modules by scripts/ocr-assets.mjs).
//     Tesseract.js defaults to a CDN; we never touch it. `workerBlobURL: false`
//     keeps the worker loading from 'self', so worker-src in the CSP stays
//     absolute too.
//   - Nothing loads until the user actually photographs a receipt. The app
//     bundle is unchanged; the ~7MB engine is a lazy, cached, one-time cost paid
//     only by people who use the feature.
//
// Accuracy shape: the photo goes to the engine AS THE CAMERA TOOK IT (after
// compressImage's downscale). There was a grayscale + contrast-stretch
// preprocessing pass here once, written on intuition — then a real receipt on
// a real countertop read measurably WORSE through it than raw (garbled items,
// mangled merchant; same engine, same photo). Leptonica's own tiled
// binarisation inside Tesseract is simply better at this than our histogram
// math was. Same lesson as Driftless's HEIC converter: when the cleverness
// stops earning its keep, delete it. Don't reintroduce preprocessing without
// an A/B on real field photos (see the field fixture in receiptparse.test.ts).
// Whatever the engine reads goes through the pure parser (receiptparse.ts),
// which extracts only what it can defend.

import type { ReceiptDraft, ReceiptReader } from "./receipt";
import { parseReceiptText } from "./receiptparse";

export const tesseractReader: ReceiptReader = {
  name: "tesseract",

  available: async () =>
    typeof WebAssembly === "object" && typeof Worker === "function",

  read: async (image: Blob, currency: string): Promise<ReceiptDraft> => {
    // Dynamic import: the engine's JS enters memory only on first use.
    const { createWorker, OEM, PSM } = await import("tesseract.js");

    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
      // Load the worker script from our origin directly instead of wrapping it
      // in a blob: URL — keeps worker-src 'self' in the CSP literally true.
      workerBlobURL: false,
    });

    try {
      // SINGLE_BLOCK, not SINGLE_COLUMN: column detection splits a receipt into
      // a labels column and a prices column read separately, which orphans every
      // amount from its item. One uniform block keeps each row a line.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      const { data } = await worker.recognize(image);
      return { ...parseReceiptText(data.text, currency), rawText: data.text };
    } finally {
      // The WASM instance holds tens of MB. A receipt is scanned occasionally,
      // not in a loop — free it rather than keeping it warm.
      await worker.terminate();
    }
  },
};
