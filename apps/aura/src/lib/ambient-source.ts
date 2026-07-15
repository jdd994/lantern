// ambient-source.ts — where ambient readings come from. The engine (ambient.ts)
// doesn't care about the source; this is the seam between "simulated" and "real."
//
// createMicSource is a real, on-device microphone source built on the Web Audio API.
// PRIVACY: audio is never recorded, uploaded, or persisted — we read the live
// analyser (loudness, liveliness, spectral tone) and discard every buffer. It stays
// on this device, always. Music-vs-nature classification needs a real model (a
// Tauri-era add-on), so `kind` is left undefined; the engine still works from
// level/energy/tone. Marked experimental — verify with a real mic.
import type { AmbientReading, AmbientTone } from "./ambient";

export type AmbientSource = {
  id: string;
  label: string;
  start(onReading: (r: AmbientReading) => void): Promise<void>;
  stop(): void;
};

export function createMicSource(): AmbientSource {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    id: "mic",
    label: "Microphone (experimental)",
    async start(onReading) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new AudioContext();
      // Browsers often hand back a suspended context; without this the analyser
      // reads all zeros. start() is called from a user gesture, so resume is allowed.
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const time = new Uint8Array(analyser.fftSize);
      const freq = new Uint8Array(analyser.frequencyBinCount);
      let prev = new Uint8Array(analyser.frequencyBinCount);

      const sample = () => {
        analyser.getByteTimeDomainData(time);
        analyser.getByteFrequencyData(freq);

        // Loudness — RMS of the waveform around the 128 midpoint.
        let sumSq = 0;
        for (let i = 0; i < time.length; i++) {
          const v = (time[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / time.length);

        // Liveliness — positive spectral flux vs the previous frame.
        let flux = 0;
        for (let i = 0; i < freq.length; i++) {
          const d = freq[i] - prev[i];
          if (d > 0) flux += d;
        }
        flux /= freq.length * 255;
        prev = freq.slice();

        // Tone — spectral centroid (where the energy sits, low→warm, high→bright).
        let num = 0;
        let den = 0;
        for (let i = 0; i < freq.length; i++) {
          num += i * freq[i];
          den += freq[i];
        }
        const centroid = den ? num / den / freq.length : 0;
        const tone: AmbientTone = centroid > 0.35 ? "bright" : centroid < 0.18 ? "warm" : "neutral";

        onReading({
          level: Math.min(1, rms * 3), // scale up typically quiet mic input
          energy: Math.min(1, flux * 6),
          tone,
        });
      };

      timer = setInterval(sample, 250);
      sample();
    },
    stop() {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      ctx = null;
      stream = null;
    },
  };
}
