// AmbientSheet.tsx — the vibe engine, made playable. Simulate what the room sounds
// like (or use your mic), nudge the time of day, and watch Aura decide a vibe and
// explain why. This is the testing layer for lib/ambient.ts: the same engine that
// will later run on a live mic under Tauri, driven here by sliders you control.
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@lantern/ui";
import { VIBES } from "@lantern/core";
import { decideVibe, type AmbientKind, type AmbientReading, type AmbientTone, type VibeDecision } from "../lib/ambient";
import { createMicSource } from "../lib/ambient-source";
import { describeScene } from "../lib/scene";
import { preloadVoiceModel, startRecording, type VoiceRecorder } from "../lib/voice-source";

const PRESETS: { label: string; reading: AmbientReading }[] = [
  { label: "Quiet night", reading: { kind: "quiet", level: 0.04, energy: 0.05, tone: "warm" } },
  { label: "Mellow music", reading: { kind: "music", level: 0.5, energy: 0.35, tone: "warm", musicStyle: "mellow" } },
  { label: "Birdsong", reading: { kind: "nature", level: 0.35, energy: 0.3, tone: "bright" } },
  { label: "Lively music", reading: { kind: "music", level: 0.82, energy: 0.85, tone: "bright" } },
  {
    label: "Energetic music",
    reading: { kind: "music", level: 0.55, energy: 0.5, tone: "bright", musicStyle: "energetic" },
  },
  { label: "Conversation", reading: { kind: "speech", level: 0.4, energy: 0.4, tone: "neutral" } },
];

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

// getUserMedia rejects with a *named* DOMException — the name says exactly what
// went wrong, so there's no reason to show everyone the same unhelpful sentence.
function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Microphone access was denied. Check this site's microphone permission in your browser (often a camera/lock icon in the address bar), and your OS's own microphone privacy setting for the browser — then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Couldn't reach the microphone — it may be in use by another app right now.";
    case "SecurityError":
      return e instanceof Error && e.message ? e.message : "The microphone isn't available in this context.";
    default:
      return "Couldn't access the microphone" + (name ? ` (${name}).` : ".");
  }
}

const VOICE_CONSENTED_KEY = "aura-voice-model-ready";

type VoiceState = "idle" | "confirm" | "downloading" | "recording" | "transcribing" | "error";

// Speak the moment instead of typing it — same describeScene() matcher either
// way, this is just a different way to get text into it. Tap to record, tap
// again to stop and transcribe; the model behind it downloads once (~65MB —
// speech model + the WASM engine that runs it), with plain consent first,
// then runs fully on-device from then on.
function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const modelReadyRef = useRef(false);

  useEffect(
    () => () => {
      recorderRef.current?.cancel();
    },
    []
  );

  function alreadyConsented() {
    try {
      return localStorage.getItem(VOICE_CONSENTED_KEY) === "1";
    } catch {
      return false;
    }
  }

  async function startRecordingNow() {
    setState("recording");
    setError(null);
    try {
      recorderRef.current = await startRecording();
    } catch (e) {
      setState("error");
      setError(micErrorMessage(e));
    }
  }

  async function downloadThenRecord() {
    setState("downloading");
    setError(null);
    setProgress(0);
    const loaded = new Map<string, number>();
    const total = new Map<string, number>();
    try {
      await preloadVoiceModel((p) => {
        loaded.set(p.file, p.loaded);
        total.set(p.file, p.total);
        const loadedSum = [...loaded.values()].reduce((a, b) => a + b, 0);
        const totalSum = [...total.values()].reduce((a, b) => a + b, 0);
        if (totalSum > 0) setProgress(Math.round((loadedSum / totalSum) * 100));
      });
      modelReadyRef.current = true;
      try {
        localStorage.setItem(VOICE_CONSENTED_KEY, "1");
      } catch {
        /* private mode — it'll just ask again next time */
      }
      await startRecordingNow();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't load the speech model — try again in a bit.");
    }
  }

  async function stopAndTranscribe() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setState("transcribing");
    try {
      const text = await recorder.stop();
      if (text) {
        onTranscript(text);
        setState("idle");
      } else {
        setState("error");
        setError("Didn't catch that — try again, a little closer to the mic.");
      }
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't transcribe that.");
    }
  }

  function tap() {
    if (state === "recording") {
      void stopAndTranscribe();
    } else if (state === "idle" || state === "error") {
      if (modelReadyRef.current || alreadyConsented()) void startRecordingNow();
      else setState("confirm");
    }
  }

  if (state === "confirm") {
    return (
      <div className="voice-confirm">
        <p className="hint">
          This downloads a small on-device speech model (about 65MB), once — after that it works fully
          offline, and nothing about your voice ever leaves this device.
        </p>
        <div className="io-row">
          <button className="btn btn-sm" onClick={downloadThenRecord}>
            Download &amp; start
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setState("idle")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-input">
      <button
        type="button"
        className={"voice-btn" + (state === "recording" ? " is-recording" : "")}
        onClick={tap}
        disabled={state === "downloading" || state === "transcribing"}
        aria-label={state === "recording" ? "Stop recording" : "Speak the moment"}
        title={state === "recording" ? "Stop recording" : "Tap to speak the moment"}
      >
        {state === "downloading" ? `${progress}%` : state === "transcribing" ? "…" : state === "recording" ? "■" : "●"}
      </button>
      {error && <p className="hint io-note">{error}</p>}
    </div>
  );
}

export function AmbientSheet({
  title = "Home",
  onApplyVibe,
  onClose,
}: {
  // "Home" applies to every light; any other value scopes both the applied
  // vibe and the copy to that one room — see App.tsx's per-room "Auto…".
  title?: string;
  // brightnessScale (optional, default 1): a multiplier on the vibe's own
  // base brightness — how mic-mode "tracking" nudges brightness within a
  // vibe over a show's arc, below, without that counting as a new vibe pick.
  onApplyVibe: (vibeId: string, brightnessScale?: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"simulate" | "mic" | "describe">("simulate");
  const [sim, setSim] = useState<AmbientReading>(PRESETS[1].reading);
  const [micReading, setMicReading] = useState<AmbientReading>({ level: 0, energy: 0, tone: "neutral" });
  const [micError, setMicError] = useState<string | null>(null);
  const [describeText, setDescribeText] = useState("");
  const [useNow, setUseNow] = useState(true);
  const [overrideHour, setOverrideHour] = useState(new Date().getHours());
  const [auto, setAuto] = useState(false);

  const reading = mode === "mic" ? micReading : sim;
  const hour = useNow ? new Date().getHours() : overrideHour;
  const decision: VibeDecision | null = mode === "describe" ? describeScene(describeText) : decideVibe(reading, { hour });
  const vibe = decision ? VIBES.find((v) => v.id === decision.vibeId) : undefined;

  // Rolling history of live mic readings, for the tracking effect below —
  // keeps roughly the last 12s (250ms samples), well past any single loud
  // moment, so a night's actual arc drives the light rather than one cheer.
  const READING_HISTORY_MAX = 48;
  const readingHistory = useRef<AmbientReading[]>([]);

  // Microphone lifecycle — start when the mic tab is active, always stop on leave.
  useEffect(() => {
    if (mode !== "mic") return;
    const source = createMicSource();
    let live = true;
    setMicError(null);
    readingHistory.current = [];
    source
      .start((r) => {
        if (!live) return;
        setMicReading(r);
        readingHistory.current.push(r);
        if (readingHistory.current.length > READING_HISTORY_MAX) readingHistory.current.shift();
      })
      .catch((e) => setMicError(micErrorMessage(e)));
    return () => {
      live = false;
      source.stop();
    };
  }, [mode]);

  // Apply automatically, simulate/describe: push the chosen vibe whenever it
  // changes (not every reading) — unchanged from before. Mic mode gets its
  // own tracking effect below instead, since "every reading" there is noisy
  // 250ms samples, not a deliberate slider move or typed description.
  const lastApplied = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "mic") return;
    if (!auto || !decision) {
      lastApplied.current = null;
      return;
    }
    if (decision.vibeId !== lastApplied.current) {
      lastApplied.current = decision.vibeId;
      onApplyVibe(decision.vibeId);
    }
  }, [mode, auto, decision?.vibeId, onApplyVibe]);

  // Track the room, mic mode: re-evaluate every few seconds from a smoothed
  // reading (averaged/majority-voted over the rolling history above) rather
  // than the raw instantaneous sample — a long set's actual quiet-to-peak
  // arc should move the room, not a single loud drum hit. Nudges brightness
  // within whatever vibe is picked (restrained range, see brightnessScale)
  // so a show's build is something the room's lights genuinely track without
  // turning into a visualizer — see ambient.ts's restraint rule.
  useEffect(() => {
    if (mode !== "mic" || !auto) return;
    const TRACK_INTERVAL_MS = 5000;
    const MIN_SAMPLES = 8; // ~2s — long enough for a first read

    function evaluate() {
      const history = readingHistory.current;
      if (history.length < MIN_SAMPLES) return;

      const avg = (f: (r: AmbientReading) => number) => history.reduce((sum, r) => sum + f(r), 0) / history.length;
      const majority = <T,>(f: (r: AmbientReading) => T | undefined): T | undefined => {
        const counts = new Map<T, number>();
        for (const r of history) {
          const v = f(r);
          if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        let best: T | undefined;
        let bestCount = 0;
        for (const [v, c] of counts) {
          if (c > bestCount) {
            best = v;
            bestCount = c;
          }
        }
        return best;
      };

      const smoothed: AmbientReading = {
        level: avg((r) => r.level),
        energy: avg((r) => r.energy),
        tone: majority((r) => r.tone) ?? "neutral",
        kind: majority((r) => r.kind),
        musicStyle: majority((r) => r.musicStyle),
      };

      const smoothedDecision = decideVibe(smoothed, { hour });
      // Restrained: ±15% of the vibe's own brightness, not a strobe — the
      // room breathes with the set's intensity, it doesn't flash with it.
      const intensity = Math.max(0, Math.min(1, (smoothed.level + smoothed.energy) / 2));
      const brightnessScale = 0.85 + 0.3 * intensity;
      onApplyVibe(smoothedDecision.vibeId, brightnessScale);
    }

    evaluate(); // first read as soon as there's enough history, not a 5s wait
    const id = setInterval(evaluate, TRACK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mode, auto, hour, onApplyVibe]);

  const setSimField = <K extends keyof AmbientReading>(k: K, v: AmbientReading[K]) =>
    setSim((s) => ({ ...s, [k]: v }));

  const scoped = title !== "Home";

  return (
    <Sheet onClose={onClose} ariaLabel={scoped ? `Read the room for ${title}` : "Read the room"}>
      <h3>{scoped ? `Read the room for ${title}` : "Read the room"}</h3>
      <p className="hint">
        {scoped
          ? `Aura can sense what's around you and set ${title}'s vibe from it — only these lights change, dialed in by the time of day.`
          : "Aura can sense the room and set the vibe — dialed in by the time of day."}{" "}
        Simulate what it hears (or try your mic), or just describe the moment, and watch it decide.
      </p>

      <div className="seg">
        <button type="button" className="seg-btn" aria-pressed={mode === "simulate"} onClick={() => setMode("simulate")}>
          Simulate
        </button>
        <button type="button" className="seg-btn" aria-pressed={mode === "mic"} onClick={() => setMode("mic")}>
          Microphone
        </button>
        <button type="button" className="seg-btn" aria-pressed={mode === "describe"} onClick={() => setMode("describe")}>
          Describe
        </button>
      </div>

      {mode === "simulate" ? (
        <div className="set-section">
          <div className="vibes" style={{ marginBottom: 16 }}>
            {PRESETS.map((p) => (
              <button key={p.label} className="vibe" onClick={() => setSim(p.reading)}>
                {p.label}
              </button>
            ))}
          </div>

          <label className="field">
            <span className="label">Loudness — {Math.round(reading.level * 100)}</span>
            <input
              className="dim wide"
              type="range"
              min={0}
              max={100}
              value={Math.round(sim.level * 100)}
              onChange={(e) => setSimField("level", Number(e.target.value) / 100)}
            />
          </label>
          <label className="field">
            <span className="label">Liveliness — {Math.round(reading.energy * 100)}</span>
            <input
              className="dim wide"
              type="range"
              min={0}
              max={100}
              value={Math.round(sim.energy * 100)}
              onChange={(e) => setSimField("energy", Number(e.target.value) / 100)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="label">Kind</span>
              <select
                value={sim.kind ?? ""}
                onChange={(e) => setSimField("kind", (e.target.value || undefined) as AmbientKind | undefined)}
              >
                <option value="music">Music</option>
                <option value="nature">Nature</option>
                <option value="speech">Voices</option>
                <option value="quiet">Quiet</option>
                <option value="">Unknown</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Tone</span>
              <select value={sim.tone} onChange={(e) => setSimField("tone", e.target.value as AmbientTone)}>
                <option value="warm">Warm</option>
                <option value="neutral">Neutral</option>
                <option value="bright">Bright</option>
              </select>
            </label>
          </div>
          {sim.kind === "music" && (
            <label className="field">
              <span className="label">Style</span>
              <select
                value={sim.musicStyle ?? ""}
                onChange={(e) =>
                  setSimField("musicStyle", (e.target.value || null) as AmbientReading["musicStyle"])
                }
              >
                <option value="">Can't tell</option>
                <option value="energetic">Energetic</option>
                <option value="mellow">Mellow</option>
              </select>
            </label>
          )}
        </div>
      ) : mode === "mic" ? (
        <div className="set-section">
          <p className="hint">
            Connected to a Bluetooth speaker? Opening the mic can briefly switch it to your phone's own
            speaker — your phone's Bluetooth profile change, not something Aura controls. It should switch
            back once you leave this tab.
          </p>
          {micError ? (
            <div className="error">{micError}</div>
          ) : (
            <>
              <div className="meter">
                <span className="micro-label">Loudness</span>
                <div className="meter-bar">
                  <span style={{ width: `${Math.round(reading.level * 100)}%` }} />
                </div>
              </div>
              <div className="meter">
                <span className="micro-label">Liveliness</span>
                <div className="meter-bar">
                  <span style={{ width: `${Math.round(reading.energy * 100)}%` }} />
                </div>
              </div>
              {reading.kind === "music" && (
                <p className="hint">
                  Sounds like music —{" "}
                  {reading.musicStyle === "energetic"
                    ? "energetic."
                    : reading.musicStyle === "mellow"
                      ? "mellow."
                      : "still listening for its energy…"}
                </p>
              )}
              <p className="hint">Listening on this device only — nothing is recorded or sent anywhere.</p>
            </>
          )}
        </div>
      ) : (
        <div className="set-section">
          <label className="field">
            <span className="label">What's the moment?</span>
            <div className="describe-row">
              <input
                type="text"
                value={describeText}
                onChange={(e) => setDescribeText(e.target.value)}
                placeholder="cozy movie night, getting ready for bed, yoga outside…"
                autoFocus
              />
              <VoiceInput onTranscript={setDescribeText} />
            </div>
          </label>
          <p className="hint">Matched right here on this device — nothing you type or say is sent anywhere.</p>
        </div>
      )}

      {mode !== "describe" && (
      <div className="set-section">
        <span className="label">Time of day</span>
        <div className="seg">
          <button type="button" className="seg-btn" aria-pressed={useNow} onClick={() => setUseNow(true)}>
            Now ({hourLabel(new Date().getHours())})
          </button>
          <button type="button" className="seg-btn" aria-pressed={!useNow} onClick={() => setUseNow(false)}>
            Try a time
          </button>
        </div>
        {!useNow && (
          <label className="field" style={{ marginTop: 12 }}>
            <span className="label">{hourLabel(overrideHour)}</span>
            <input
              className="dim wide"
              type="range"
              min={0}
              max={23}
              value={overrideHour}
              onChange={(e) => setOverrideHour(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      )}

      {decision ? (
        <div className="decision" style={{ borderColor: vibe?.accent }}>
          <span className="decision-dot" style={{ background: vibe?.accent }} />
          <div className="decision-body">
            <span className="decision-vibe">{vibe?.label ?? decision.vibeId}</span>
            <span className="decision-reason">{decision.reason}</span>
            <div className="conf">
              <span style={{ width: `${Math.round(decision.confidence * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : (
        mode === "describe" && (
          <p className="hint">
            {describeText.trim()
              ? "Couldn't tell from that — try different words, or pick a vibe below."
              : "Describe the moment, and Aura will suggest a vibe."}
          </p>
        )
      )}

      {decision && (
        <div className="sheet-actions">
          <label className="auto-toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Apply automatically
          </label>
          <button className="btn btn-primary" onClick={() => onApplyVibe(decision.vibeId)}>
            Apply now
          </button>
        </div>
      )}

      <p className="hint auto-foot">
        On-device only. Hands-free listening and telling music from nature come with the desktop app;
        here you can simulate the room and tune how it decides.
      </p>
    </Sheet>
  );
}
