// voice-assets.mjs — vendor the on-device speech-to-text model from the
// Hugging Face Hub into public/voice/.
//
// Why this exists: transformers.js defaults to fetching model weights from
// huggingface.co at runtime — a third-party request the CSP would (rightly)
// block, and a privacy story we don't want to tell (same reasoning as
// Ballast's ocr-assets.mjs for on-device OCR). Instead every asset ships from
// OUR origin: this script downloads the files once at dev/build time — the
// only point where this repo's tooling talks to Hugging Face — so end users'
// browsers never do.
//
// Model: Xenova/whisper-tiny.en. Whisper is a Seq2Seq model
// (@huggingface/transformers/src/models/session_config.js), so only two ONNX
// graphs are needed: encoder_model + decoder_model_merged (the merged decoder
// folds the with/without-past-KV-cache variants into one graph).
//
// dtype is "fp16", not the wasm-device default "q8" ("_quantized" suffix) —
// found the hard way, across two different quantized formats: the "_quantized"
// (q8) file uses a block-quantized MatMulNBits format this onnxruntime-web
// version can't create a session from ("Missing required scale for node:
// ...DequantizeLinear"), and "_uint8" hits the identical error on the same
// tensor (the embedding table appears to be block-quantized regardless of the
// "main" dtype). fp16 sidesteps quantization entirely — larger (~16.5MB +
// ~59.6MB ≈ 76MB for the weights, vs ~41MB quantized) but the only variant
// that gets past model-loading in testing so far. Still hits a separate,
// unconfirmed graph-optimization error after that — see voice-source.ts.
// Plus onnxruntime-web's own wasm runtime, vendored separately below.
//
// public/voice/ is gitignored and rebuilt by predev/prebuild. Lazy-loaded by
// voice-source.ts only when someone taps to record on the Describe tab, and
// excluded from the PWA precache (see vite.config.ts) so installing Aura
// never forces the download.
//
// Separately, onnxruntime-web (the WASM engine transformers.js runs models
// on) needs its own runtime binary — and defaults to fetching THAT from
// cdn.jsdelivr.net if wasmPaths isn't pointed elsewhere (voice-source.ts
// points it at /voice/ort/, vendored below). Found by watching real network
// requests: the browser build resolves to the "simd-threaded.asyncify"
// variant specifically — that's the one vendored, not the other three
// (jsep/jspi/plain) it never actually requests. Unlike the model weights,
// these ship inside the onnxruntime-web npm package already, so this is a
// plain copy, not a fetch.
import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, ".."));
const MODEL_ID = "Xenova/whisper-tiny.en";
const out = join(here, "..", "public", "voice", MODEL_ID);
const ortOut = join(here, "..", "public", "voice", "ort");

const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "normalizer.json",
  "vocab.json",
  "merges.txt",
  "added_tokens.json",
  "onnx/encoder_model_fp16.onnx",
  "onnx/decoder_model_merged_fp16.onnx",
];

async function alreadyVendored(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

let downloaded = 0;
let skipped = 0;
for (const file of FILES) {
  const dest = join(out, file);
  if (await alreadyVendored(dest)) {
    skipped++;
    continue;
  }
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`voice-assets: failed to fetch ${url} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  downloaded++;
  console.log(`voice-assets: fetched ${file} (${(bytes.byteLength / 1_000_000).toFixed(1)} MB)`);
}

console.log(`voice-assets: ${downloaded} file(s) fetched, ${skipped} already present in public/voice/`);

const ortDist = dirname(require.resolve("onnxruntime-web"));
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
let ortCopied = 0;
for (const file of ORT_FILES) {
  const dest = join(ortOut, file);
  if (await alreadyVendored(dest)) continue;
  await mkdir(ortOut, { recursive: true });
  await copyFile(join(ortDist, file), dest);
  ortCopied++;
}
console.log(`voice-assets: ${ortCopied} onnxruntime-web runtime file(s) copied into public/voice/ort/`);
