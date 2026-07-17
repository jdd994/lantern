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
// Accuracy shape: thermal receipts are the hard case (curl, glare, faded ink),
// so we upscale small images and flatten them to high-contrast grayscale before
// recognition — cheap, and it measurably helps. Whatever comes out goes through
// the pure parser (receiptparse.ts), which extracts only what it can defend.

import type { ReceiptDraft, ReceiptReader } from "./receipt";
import { parseReceiptText } from "./receiptparse";

// Small print needs pixels. compressImage stores receipts at up to 2000px, but a
// cropped or older photo may be smaller; below this width Tesseract starts
// missing characters.
const MIN_OCR_WIDTH = 1400;

// Grayscale + gentle contrast stretch. Tesseract binarises internally (Otsu), so
// we don't threshold here — we just give it a cleaner signal to threshold.
async function preprocess(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image);
  const scale = Math.max(1, MIN_OCR_WIDTH / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    // No 2d context is vanishingly rare; feed the original image via a bare
    // canvas-less path by throwing — readReceipt treats any throw as "no read".
    bitmap.close?.();
    throw new Error("no 2d context");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;

  // Luminance histogram, then stretch the 2nd..98th percentile to full range —
  // lifts faded thermal print without letting a glare spot blow out the scale.
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    hist[y | 0]++;
  }
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);

  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    const v = Math.max(0, Math.min(255, ((y - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export const tesseractReader: ReceiptReader = {
  name: "tesseract",

  available: async () =>
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof createImageBitmap === "function",

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
      const canvas = await preprocess(image);
      const { data } = await worker.recognize(canvas);
      return parseReceiptText(data.text, currency);
    } finally {
      // The WASM instance holds tens of MB. A receipt is scanned occasionally,
      // not in a loop — free it rather than keeping it warm.
      await worker.terminate();
    }
  },
};
