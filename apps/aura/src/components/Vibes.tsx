// Vibes.tsx — the shared vibe layer, made visible. The six built-in moods come from
// @lantern/core (the same words the other apps speak); your own custom vibes sit
// right beside them. Tapping one sets the whole space to that atmosphere.
import { VIBES } from "@lantern/core";
import { rgbToHex } from "../lib/color";
import type { CustomVibe } from "../lib/db";

export function Vibes({
  busy,
  customVibes,
  onApply,
  onAuto,
  onAddVibe,
  onRemoveVibe,
}: {
  busy: boolean;
  customVibes: CustomVibe[];
  onApply: (vibeId: string) => void;
  onAuto: () => void;
  onAddVibe: () => void;
  onRemoveVibe: (id: string) => void;
}) {
  return (
    <section className="section vibes-section">
      <div className="section-head">
        <h2>Vibe</h2>
        <button className="btn btn-ghost btn-sm" onClick={onAuto}>
          Auto…
        </button>
      </div>
      <div className="vibes">
        {VIBES.map((v) => (
          <button
            key={v.id}
            className="vibe"
            disabled={busy}
            title={v.description}
            onClick={() => onApply(v.id)}
          >
            <span className="vibe-dot" style={{ background: v.accent }} />
            {v.label}
          </button>
        ))}

        {customVibes.map((v) => (
          <span className="vibe-wrap" key={v.id}>
            <button className="vibe" disabled={busy} onClick={() => onApply(v.id)}>
              <span className="vibe-dot" style={{ background: rgbToHex(v.rgb) }} />
              {v.label}
            </button>
            <button
              className="scene-x"
              aria-label={`Remove ${v.label}`}
              title="Remove"
              onClick={() => onRemoveVibe(v.id)}
            >
              ×
            </button>
          </span>
        ))}

        <button className="vibe vibe-add" onClick={onAddVibe} title="Make your own vibe">
          + New
        </button>
      </div>
    </section>
  );
}
