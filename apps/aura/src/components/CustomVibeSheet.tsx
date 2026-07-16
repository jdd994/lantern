// CustomVibeSheet.tsx — make your own vibe: a name, a color, a brightness. It joins
// the built-in six in the Vibe strip and applies to your lights just like they do.
// Calm and small on purpose — a swatch and a slider, not a color-theory lab.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import { hexToRgb } from "../lib/color";
import type { Color } from "../lib/connectors";

export function CustomVibeSheet({
  onCreate,
  onClose,
}: {
  onCreate: (label: string, rgb: Color, brightness: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#E7B75A");
  const [brightness, setBrightness] = useState(60);

  function save() {
    onCreate(name, hexToRgb(hex), brightness);
    onClose();
  }

  return (
    <Sheet onClose={onClose} ariaLabel="New vibe">
      <h3>New vibe</h3>

      <div className="vibe-preview">
        <span
          className="vibe-preview-dot"
          style={{ background: hex, opacity: 0.25 + (brightness / 100) * 0.75 }}
        />
        <span className="decision-vibe">{name.trim() || "My vibe"}</span>
      </div>

      <label className="field">
        <span className="label">Name</span>
        <input
          type="text"
          value={name}
          autoFocus
          placeholder="My vibe"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>

      <div className="field-row">
        <label className="field" style={{ flex: "none" }}>
          <span className="label">Color</span>
          <input className="swatch big" type="color" value={hex} onChange={(e) => setHex(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 2 }}>
          <span className="label">Brightness — {brightness}</span>
          <input
            className="dim wide"
            type="range"
            min={1}
            max={100}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save}>
          Save vibe
        </button>
      </div>
    </Sheet>
  );
}
