// voice-source.ts — on-device speech-to-text for the Describe tab. Tap to
// record, tap to stop; the words that come back feed straight into
// describeScene(), same as if you'd typed them. Nothing about your voice is
// ever recorded to disk or sent anywhere — the audio buffer lives in memory
// for exactly as long as transcription takes, then it's gone.
//
// The model (Xenova/whisper-tiny.en, fp16 — ~76MB) plus onnxruntime-web's own
// wasm runtime (~24MB) are vendored into public/voice/ at build time by
// scripts/voice-assets.mjs — see that file for why, and for why fp16 rather
// than a quantized dtype. ~100MB total, downloaded to the browser once, on
// first use, cached via the Cache API by transformers.js itself, and never
// touches a third party after that: allowRemoteModels is explicitly off below.
//
// Not yet confirmed working end-to-end — verified in a real browser is the
// next step (see the commit message). graphOptimizationLevel is disabled
// below as a defensive measure against an ONNX Runtime graph-fusion error
// hit during testing; harmless if unneeded (only affects inference speed,
// not correctness), worth revisiting once real-device testing narrows down
// whether it's actually load-bearing.
//
// The @huggingface/transformers import itself is dynamic, not top-level —
// it's a large library, and every byte of it must be a lazy, one-time cost
// paid only by someone who actually taps to speak, never part of the app's
// own bundle (same reasoning as Ballast's on-device OCR).
const MODEL_ID = "Xenova/whisper-tiny.en";

export type VoiceDownloadProgress = { file: string; loaded: number; total: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriberPromise: Promise<any> | null = null;

// The model loads once per page session and is reused after that — calling
// this again while already loaded resolves immediately from the cached promise.
function getTranscriber(onProgress?: (p: VoiceDownloadProgress) => void) {
  if (!transcriberPromise) {
    transcriberPromise = import("@huggingface/transformers").then(({ env, pipeline }) => {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = "/voice/";
      // onnxruntime-web's own WASM runtime defaults to cdn.jsdelivr.net if
      // this isn't set — vendored locally by voice-assets.mjs instead.
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/voice/ort/";
      return pipeline("automatic-speech-recognition", MODEL_ID, {
        // Not the "q8" default — see voice-assets.mjs's file-top note on why.
        dtype: "fp16",
        session_options: { graphOptimizationLevel: "disabled" },
        progress_callback: (data: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (data.status === "progress" && data.file && onProgress) {
            onProgress({ file: data.file, loaded: data.loaded ?? 0, total: data.total ?? 0 });
          }
        },
      });
    });
  }
  return transcriberPromise;
}

// Loads the model (if not already loaded) without recording — lets the UI
// show a real download-progress bar before the mic ever opens.
export function preloadVoiceModel(onProgress?: (p: VoiceDownloadProgress) => void): Promise<void> {
  return getTranscriber(onProgress).then(() => undefined);
}

export type VoiceRecorder = {
  stop(): Promise<string>;
  cancel(): void;
};

// Starts recording immediately; call stop() to end recording and transcribe,
// or cancel() to discard without transcribing. Records at 16kHz mono, which
// is what Whisper expects — resampling on the way in avoids an extra pass
// over the audio later.
export async function startRecording(): Promise<VoiceRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("The microphone needs a secure connection (https) to work here.", "SecurityError");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated in favor of AudioWorkletNode, but still
  // universally supported and far simpler here (no separate worklet module to
  // load) — fine for short tap-to-talk recordings.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  function teardown() {
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }

  return {
    async stop() {
      teardown();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const audio = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        audio.set(c, offset);
        offset += c.length;
      }
      if (total === 0) return "";
      const transcriber = await getTranscriber();
      const result = await transcriber(audio);
      const text = Array.isArray(result) ? result[0]?.text : result.text;
      return (text ?? "").trim();
    },
    cancel() {
      teardown();
    },
  };
}
