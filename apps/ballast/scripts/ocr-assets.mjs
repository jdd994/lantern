// ocr-assets.mjs
// Vendor the on-device OCR engine from node_modules into public/ocr/.
//
// Why this exists: tesseract.js defaults to fetching its worker, WASM core and
// language model from a CDN at runtime. That is three third-party requests the
// CSP would (rightly) block, and a privacy story we don't want to tell. Instead
// every asset ships from OUR origin: this script copies them out of the pinned
// npm packages at dev/build time, so the binaries never live in git and never
// come from anyone else at runtime.
//
// public/ocr/ is gitignored and rebuilt by `predev`/`prebuild`. ~7MB total —
// lazy-loaded by ocr.ts only when a receipt is actually photographed, and
// excluded from the PWA precache (see vite.config.ts) so installing Ballast
// never forces the download.

import { createRequire } from "node:module";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, ".."));
const out = join(here, "..", "public", "ocr");

const tesseract = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const eng = dirname(require.resolve("@tesseract.js-data/eng/package.json"));

// Only the LSTM cores: ocr.ts runs OEM.LSTM_ONLY, and the worker picks ONE of
// these three at runtime based on the device's SIMD support.
const files = [
  [join(tesseract, "dist", "worker.min.js"), join(out, "worker.min.js")],
  [join(core, "tesseract-core-lstm.wasm.js"), join(out, "core", "tesseract-core-lstm.wasm.js")],
  [join(core, "tesseract-core-simd-lstm.wasm.js"), join(out, "core", "tesseract-core-simd-lstm.wasm.js")],
  [join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"), join(out, "core", "tesseract-core-relaxedsimd-lstm.wasm.js")],
  // best_int: the integer-quantised "best" model — the accuracy/size point that
  // makes on-device OCR worth having at all.
  [join(eng, "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz")],
];

for (const [src, dst] of files) {
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}
console.log(`ocr-assets: vendored ${files.length} files into public/ocr/`);
