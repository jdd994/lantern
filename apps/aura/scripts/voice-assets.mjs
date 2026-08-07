// voice-assets.mjs — vendor the on-device speech-to-text model + its ONNX
// Runtime WASM binary, and upload them to Aura's own R2 bucket.
//
// Why this exists: transformers.js defaults to fetching model weights from
// huggingface.co, and onnxruntime-web defaults to fetching its own WASM
// runtime from cdn.jsdelivr.net — two third-party requests the CSP would
// (rightly) block, and a privacy story we don't want to tell (same reasoning
// as Ballast's ocr-assets.mjs for on-device OCR). Every asset ships from
// infrastructure we control instead: this script downloads/uploads once — the
// only point where this repo's tooling talks to Hugging Face or writes to R2
// — so end users' browsers only ever talk to our own bucket.
//
// Why R2, not Cloudflare Pages (same origin as the rest of Aura): Pages caps
// individual files at 25MiB. Every viable ONNX decoder variant for this
// model is at or above that (uint8/int8/q8 ≈30.7MB, fp16 ≈56.8MB, q4/bnb4
// ≈86MB) — a hard deploy blocker, not a preference. R2 has no such limit.
// voice-source.ts points transformers.js's localModelPath and
// onnxruntime-web's wasmPaths at the bucket's public URL directly, with CORS
// scoped to auravibe.app (see the `wrangler r2 bucket cors set` step below —
// run once, not part of this script).
//
// dtype is "uint8", not the wasm-device default "q8" ("_quantized" suffix) —
// the "_quantized" file uses a block-quantized MatMulNBits format that failed
// to create an ONNX Runtime session in testing ("Missing required scale for
// node: ...DequantizeLinear"), and uint8 hits the same wall in size (~30.7MB,
// same ballpark as q8) but is the smallest variant that isn't fp16-or-bigger.
// session_options in voice-source.ts disables graph optimization as a
// defensive mitigation for a related class of ONNX Runtime error — harmless
// if unneeded, only affects inference speed, not correctness.
//
// Whisper is a Seq2Seq model (@huggingface/transformers/src/models/
// session_config.js), so only two ONNX graphs are needed: encoder_model +
// decoder_model_merged (the merged decoder folds the with/without-past-
// KV-cache variants into one graph).
//
// Run manually when the model needs (re-)vendoring or the bucket needs
// (re-)populating — not part of predev/prebuild. Nothing here changes on a
// normal Aura deploy, and this script needs both Hugging Face and Cloudflare
// R2 credentials, neither of which a routine build should depend on.
//
//   node scripts/voice-assets.mjs           # fetch/vendor into .voice-cache/
//   node scripts/voice-assets.mjs --upload  # + push every file to R2
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile, stat, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, ".."));
const MODEL_ID = "Xenova/whisper-tiny.en";
const cacheRoot = join(here, "..", ".voice-cache");
const out = join(cacheRoot, MODEL_ID);
const ortOut = join(cacheRoot, "ort");
const R2_BUCKET = "aura-voice-assets";

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
  "onnx/encoder_model_uint8.onnx",
  "onnx/decoder_model_merged_uint8.onnx",
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
console.log(`voice-assets: ${downloaded} file(s) fetched, ${skipped} already present in .voice-cache/`);

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
console.log(`voice-assets: ${ortCopied} onnxruntime-web runtime file(s) copied into .voice-cache/ort/`);

if (process.argv.includes("--upload")) {
  const CONTENT_TYPES = { ".json": "application/json", ".txt": "text/plain", ".mjs": "text/javascript", ".wasm": "application/wasm" };
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) files.push(...(await walk(full)));
      else files.push(full);
    }
    return files;
  }
  const allFiles = await walk(cacheRoot);
  for (const file of allFiles) {
    const key = relative(cacheRoot, file).split("\\").join("/"); // posix keys on any OS
    const ext = "." + file.split(".").pop();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    console.log(`voice-assets: uploading ${key} (${contentType})...`);
    execFileSync(
      "npx",
      ["wrangler", "r2", "object", "put", `${R2_BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"],
      { stdio: "inherit" }
    );
  }
  console.log(`voice-assets: ${allFiles.length} file(s) uploaded to R2 bucket "${R2_BUCKET}".`);
}
