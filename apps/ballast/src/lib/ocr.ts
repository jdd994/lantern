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
import { scaledJpeg } from "./media";

// How much of a receipt a draft actually captured. Used to decide whether a
// pass was good enough to stop, and which pass won. The total is worth the
// most — it's the number the whole feature exists to save typing.
function score(d: ReceiptDraft): number {
  return (d.amount ? 4 : 0) + Math.min(d.items?.length ?? 0, 5) + (d.merchant ? 1 : 0) + (d.at ? 1 : 0);
}
const GOOD_ENOUGH = 5; // total + at least one item — stop looking

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
      // MULTI-PASS, because real receipts fail in opposite directions and no
      // single configuration survives all of them (each pass earned its place
      // against a field photo):
      //   - Default (global) thresholding drowns in patterned backgrounds —
      //     Costco's blue border turned a whole receipt to noise. Sauvola
      //     (thresholding_method 2) binarises locally and read the same photo
      //     cleanly... while being no better, sometimes worse, on clean paper.
      //   - Full resolution resolves thin thermal strokes — but it also renders
      //     wood grain as crisp false detail; the same photo that failed at
      //     4000px read fine small. So the gentler variant is a fallback, not
      //     a downgrade.
      // Passes run until one is good enough (total + an item); the best draft
      // wins. Failing scans were already slow by feeling — a few extra seconds
      // to rescue one is the right trade.
      const half = await scaledJpeg(image, 2000).catch(() => null);
      const passes: Array<{ threshold: string; img: Blob }> = [
        { threshold: "0", img: image },
        { threshold: "2", img: image },
        ...(half && half !== image
          ? [
              { threshold: "0", img: half },
              { threshold: "2", img: half },
            ]
          : []),
      ];

      let best: ReceiptDraft = {};
      let bestScore = -1;
      for (const pass of passes) {
        // SINGLE_BLOCK, not SINGLE_COLUMN: column detection splits a receipt
        // into a labels column and a prices column read separately, which
        // orphans every amount from its item.
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
          thresholding_method: pass.threshold,
        });
        const { data } = await worker.recognize(pass.img);
        const draft: ReceiptDraft = { ...parseReceiptText(data.text, currency), rawText: data.text };
        const s = score(draft);
        if (s > bestScore) {
          best = draft;
          bestScore = s;
        }
        if (bestScore >= GOOD_ENOUGH) break;
      }
      return best;
    } finally {
      // The WASM instance holds tens of MB. A receipt is scanned occasionally,
      // not in a loop — free it rather than keeping it warm.
      await worker.terminate();
    }
  },
};
