// VibePicker.tsx — set a vibe, for one room or the whole home. The single place
// vibes are picked from now (a "Vibe" button opens this, same as every other
// sheet in the app) — including making, editing, and removing your own, since
// those are just as much "picking a vibe" as tapping a built-in one.
import { Sheet } from "@lantern/ui";
import { VIBES } from "@lantern/core";
import { rgbToHex } from "../lib/color";
import type { CustomVibe } from "../lib/db";

export function VibePicker({
  title,
  busy,
  customVibes,
  onPick,
  onAddVibe,
  onEditVibe,
  onRemoveVibe,
  onClose,
}: {
  title: string;
  busy: boolean;
  customVibes: CustomVibe[];
  onPick: (vibeId: string) => void;
  onAddVibe: () => void;
  onEditVibe: (v: CustomVibe) => void;
  onRemoveVibe: (id: string) => void;
  onClose: () => void;
}) {
  const pick = (id: string) => {
    onPick(id);
    onClose();
  };
  return (
    <Sheet onClose={onClose} ariaLabel={`Set the vibe for ${title}`}>
      <h3>Set {title}&rsquo;s vibe</h3>
      <div className="vibes">
        {VIBES.map((v) => (
          <button key={v.id} className="vibe" disabled={busy} title={v.description} onClick={() => pick(v.id)}>
            <span className="vibe-dot" style={{ background: v.accent }} />
            {v.label}
          </button>
        ))}
        {customVibes.map((v) => (
          <span className="vibe-wrap" key={v.id}>
            <button className="vibe" disabled={busy} onClick={() => pick(v.id)}>
              <span className="vibe-dot" style={{ background: rgbToHex(v.rgb) }} />
              {v.label}
            </button>
            <span className="chip-tools">
              <button className="chip-tool" aria-label={`Edit ${v.label}`} title="Edit" onClick={() => onEditVibe(v)}>
                ✎
              </button>
              <button className="chip-tool" aria-label={`Remove ${v.label}`} title="Remove" onClick={() => onRemoveVibe(v.id)}>
                ×
              </button>
            </span>
          </span>
        ))}
        <button className="vibe vibe-add" onClick={onAddVibe} title="Make your own vibe">
          + New
        </button>
      </div>
    </Sheet>
  );
}
