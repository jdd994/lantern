// Scenes.tsx — the heart of the MVP. A scene is a saved vibe: one tap sets every
// light back to how you liked it. Save the current lights as a named scene, recall
// it later, or remove one you've outgrown. Two forms:
//   • full  — a top-level "Whole home" section (its own heading).
//   • compact — embedded inside a room block (the room name is already the heading).
import { useState } from "react";
import type { StoredScene } from "../lib/db";

export function Scenes({
  scenes,
  busy,
  canSave,
  onApply,
  onSave,
  onRemove,
  title = "Scenes",
  compact = false,
}: {
  scenes: StoredScene[];
  busy: boolean;
  canSave: boolean;
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onRemove: (id: string) => void;
  title?: string;
  compact?: boolean;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function save() {
    onSave(name);
    setName("");
    setNaming(false);
  }

  const saveButton =
    canSave && !naming ? (
      <button className="btn btn-ghost btn-sm" onClick={() => setNaming(true)}>
        Save current
      </button>
    ) : null;

  // Compact form renders nothing at all until there's something to show.
  if (compact && scenes.length === 0 && !canSave) return null;

  return (
    <section className={compact ? "room-scenes" : "scenes-section"}>
      {compact ? (
        <div className="room-scenes-head">
          <span className="micro-label">Scenes</span>
          {saveButton}
        </div>
      ) : (
        <div className="section-head">
          <h2>{title}</h2>
          {saveButton}
        </div>
      )}

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
        compact ? null : (
          <p className="hint">Set your lights how you like them, then save the moment as a scene.</p>
        )
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
