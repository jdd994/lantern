// Scenes.tsx — the heart of the MVP. A scene is a saved vibe: one tap sets every
// light back to how you liked it. Save the current room as a named scene, recall
// it later, or remove one you've outgrown.
import { useState } from "react";
import type { StoredScene } from "../lib/db";

export function Scenes({
  scenes,
  busy,
  canSave,
  onApply,
  onSave,
  onRemove,
}: {
  scenes: StoredScene[];
  busy: boolean;
  canSave: boolean;
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function save() {
    onSave(name);
    setName("");
    setNaming(false);
  }

  return (
    <section className="scenes-section">
      <div className="section-head">
        <h2>Scenes</h2>
        {canSave && !naming && (
          <button className="btn btn-ghost btn-sm" onClick={() => setNaming(true)}>
            Save current
          </button>
        )}
      </div>

      {naming && (
        <div className="scene-save">
          <input
            className="field-input"
            placeholder="Name this vibe — Evening, Focus, Wind-down…"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <div className="sheet-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}

      {scenes.length === 0 ? (
        <p className="hint">Set your lights how you like them, then save the moment as a scene.</p>
      ) : (
        <div className="scenes">
          {scenes.map((s) => (
            <div className="scene" key={s.id}>
              <button className="scene-btn" disabled={busy} onClick={() => onApply(s.id)}>
                {s.name}
              </button>
              <button
                className="scene-x"
                aria-label={`Remove ${s.name}`}
                title="Remove"
                onClick={() => onRemove(s.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
