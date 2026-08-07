// RhythmSheet.tsx — the day rhythm: the home following the sun, said in one sheet.
// A toggle, a few named shapes (not a settings panel of numbers), today's sun
// times, and a plain card saying what the lights are doing right now. The rhythm's
// promises are stated here in words, not buried as behavior: it never turns a
// light on, and it never paints over a color you chose.
import { useEffect, useState } from "react";
import { Sheet } from "@lantern/ui";
import {
  RHYTHM_PRESETS,
  rhythmAnchors,
  rhythmPresetById,
  rhythmTarget,
  type RhythmAnchors,
  type RhythmTarget,
} from "../lib/rhythm";
import type { Coords } from "../lib/automations";
import type { RhythmSettings } from "../hooks/useAura";
import { isTauri } from "../lib/platform";

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// A rough swatch for a white point — for the "now" dot only, not color science.
function kelvinSwatch(kelvin: number): string {
  const f = Math.max(0, Math.min(1, (kelvin - 2000) / 4500));
  const warm = { r: 255, g: 177, b: 70 }; // ~2000K-ish
  const cool = { r: 207, g: 224, b: 255 }; // ~6500K-ish
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(warm.r, cool.r)}, ${mix(warm.g, cool.g)}, ${mix(warm.b, cool.b)})`;
}

function nowLine(t: RhythmTarget, a: RhythmAnchors): { title: string; detail: string } {
  const bright = t.brightness !== null ? ` · ${t.brightness}% bright` : "";
  const k = `${t.kelvin}K${bright}`;
  if (t.phase === "dawn") return { title: "Dawn", detail: `Coming up toward daylight — ${k}.` };
  if (t.phase === "dusk")
    return {
      title: "Dusk",
      detail: `Sinking toward embers — ${k}, settled by ${fmtTime(a.dusk)}.`,
    };
  if (t.phase === "day") {
    if (t.level > 0.85) return { title: "Midday", detail: `Cool and clear — ${k}.` };
    return new Date().getTime() < a.noon.getTime()
      ? { title: "Morning", detail: `Brightening toward midday — ${k}.` }
      : { title: "Evening", detail: `Warming down toward sunset at ${fmtTime(a.sunset)} — ${k}.` };
  }
  return {
    title: "Night",
    detail: t.ember ? `Low and ember-warm — no blue until morning.` : `Settled at ${k} until morning.`,
  };
}

export function RhythmSheet({
  rhythm,
  coords,
  onRequestLocation,
  onSet,
  onClose,
}: {
  rhythm: RhythmSettings;
  coords: Coords | null;
  onRequestLocation: () => Promise<Coords | null>;
  onSet: (next: RhythmSettings) => void;
  onClose: () => void;
}) {
  const [locating, setLocating] = useState(false);
  // Re-read the curve every minute so the "now" card stays honest while open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const preset = rhythmPresetById(rhythm.presetId) ?? RHYTHM_PRESETS[0];
  const anchors = rhythmAnchors(now, coords, preset);
  const target = rhythmTarget(now, coords, preset);
  const line = nowLine(target, anchors);
  const dotColor = target.ember
    ? `rgb(${target.ember.r}, ${target.ember.g}, ${target.ember.b})`
    : kelvinSwatch(target.kelvin);

  async function useLocation() {
    setLocating(true);
    await onRequestLocation();
    setLocating(false);
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Day rhythm">
      <h3>Day rhythm</h3>

      <div className="set-section">
        <div className="adaptive-row">
          <div>
            <span className="label">Follow the day</span>
            <p className="hint">
              Lights that are on drift with the sun — cool and bright through midday, warm as it
              goes, ember-red after dusk on bulbs that can show it.
            </p>
          </div>
          <button
            className="toggle"
            role="switch"
            aria-checked={rhythm.enabled}
            aria-label="Follow the day"
            onClick={() => onSet({ ...rhythm, enabled: !rhythm.enabled })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      <div className="set-section">
        <span className="label">The day's shape</span>
        <div className="vibes">
          {RHYTHM_PRESETS.map((p) => (
            <button
              key={p.id}
              className="vibe"
              aria-pressed={p.id === preset.id}
              onClick={() => onSet({ ...rhythm, presetId: p.id })}
            >
              <span className="vibe-dot" style={{ background: p.accent, color: p.accent }} />
              {p.label}
            </button>
          ))}
        </div>
        <p className="hint rhythm-desc">{preset.description}</p>
      </div>

      {rhythm.enabled && (
        <div className="decision" role="status">
          <span className="decision-dot" style={{ background: dotColor }} />
          <div className="decision-body">
            <span className="decision-vibe">{line.title}</span>
            <span className="decision-reason">{line.detail}</span>
          </div>
        </div>
      )}

      <div className="set-section rhythm-sun">
        {coords ? (
          <p className="hint">
            {anchors.clockOnly
              ? "No sunrise or sunset here today (polar season) — the rhythm follows the clock instead."
              : `Today: sunrise ${fmtTime(anchors.sunrise)} · sunset ${fmtTime(anchors.sunset)} · dark by ${fmtTime(anchors.dusk)}.`}
          </p>
        ) : (
          <div className="loc-note">
            <p className="hint">
              With your location, the rhythm rides the real sun through the seasons. Without it, it
              follows the clock — that works too.
            </p>
            <button className="btn btn-sm" onClick={useLocation} disabled={locating}>
              {locating ? "Locating…" : "Use my location"}
            </button>
          </div>
        )}
      </div>

      <p className="hint auto-foot">
        The rhythm only shapes lights that are already on — it never switches one on, and a color
        you set yourself is left alone until that light goes off and on again.{" "}
        {isTauri()
          ? "It keeps breathing from the tray even with this window closed."
          : "Like automations, it runs while Aura is open; the desktop app keeps it going from the tray."}
      </p>
    </Sheet>
  );
}
