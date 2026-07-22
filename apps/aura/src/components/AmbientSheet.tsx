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

const PRESETS: { label: string; reading: AmbientReading }[] = [
  { label: "Quiet night", reading: { kind: "quiet", level: 0.04, energy: 0.05, tone: "warm" } },
  { label: "Mellow music", reading: { kind: "music", level: 0.5, energy: 0.35, tone: "warm" } },
  { label: "Birdsong", reading: { kind: "nature", level: 0.35, energy: 0.3, tone: "bright" } },
  { label: "Lively music", reading: { kind: "music", level: 0.82, energy: 0.85, tone: "bright" } },
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

export function AmbientSheet({
  onApplyVibe,
  onClose,
}: {
  onApplyVibe: (vibeId: string) => void;
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

  // Microphone lifecycle — start when the mic tab is active, always stop on leave.
  useEffect(() => {
    if (mode !== "mic") return;
    const source = createMicSource();
    let live = true;
    setMicError(null);
    source.start((r) => live && setMicReading(r)).catch((e) => setMicError(micErrorMessage(e)));
    return () => {
      live = false;
      source.stop();
    };
  }, [mode]);

  // Apply automatically: push the chosen vibe whenever it changes (not every reading).
  const lastApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!auto || !decision) {
      lastApplied.current = null;
      return;
    }
    if (decision.vibeId !== lastApplied.current) {
      lastApplied.current = decision.vibeId;
      onApplyVibe(decision.vibeId);
    }
  }, [auto, decision?.vibeId, onApplyVibe]);

  const setSimField = <K extends keyof AmbientReading>(k: K, v: AmbientReading[K]) =>
    setSim((s) => ({ ...s, [k]: v }));

  return (
    <Sheet onClose={onClose} ariaLabel="Ambient vibe">
      <h3>Read the room</h3>
      <p className="hint">
        Aura can sense the room and set the vibe — dialed in by the time of day. Simulate what it hears
        (or try your mic), or just describe the moment, and watch it decide.
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
        </div>
      ) : mode === "mic" ? (
        <div className="set-section">
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
              <p className="hint">Listening on this device only — nothing is recorded or sent anywhere.</p>
            </>
          )}
        </div>
      ) : (
        <div className="set-section">
          <label className="field">
            <span className="label">What's the moment?</span>
            <input
              type="text"
              value={describeText}
              onChange={(e) => setDescribeText(e.target.value)}
              placeholder="cozy movie night, getting ready for bed, yoga outside…"
              autoFocus
            />
          </label>
          <p className="hint">Matched right here on this device — nothing you type is sent anywhere.</p>
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
