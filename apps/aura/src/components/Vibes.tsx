// Vibes.tsx — the shared vibe layer, made visible. These moods come from
// @lantern/core (not Aura), so they're the same words Driftless and the others
// speak; tapping one sets the whole space to that atmosphere. Today you set the
// vibe here by hand; the same entry point is where a vibe arriving from another app
// will land once Aura joins the sync layer.
import { VIBES } from "@lantern/core";

export function Vibes({ busy, onApply }: { busy: boolean; onApply: (vibeId: string) => void }) {
  return (
    <section className="section vibes-section">
      <div className="section-head">
        <h2>Vibe</h2>
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
      </div>
    </section>
  );
}
