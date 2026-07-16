// VibePicker.tsx — pick a vibe for one room (the whole-home strip lives on Home).
// Shows the built-in moods plus your custom ones; tap to set that room and close.
import { Sheet } from "@lantern/ui";
import { VIBES } from "@lantern/core";
import { rgbToHex } from "../lib/color";
import type { CustomVibe } from "../lib/db";

export function VibePicker({
  title,
  customVibes,
  onPick,
  onClose,
}: {
  title: string;
  customVibes: CustomVibe[];
  onPick: (vibeId: string) => void;
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
          <button key={v.id} className="vibe" title={v.description} onClick={() => pick(v.id)}>
            <span className="vibe-dot" style={{ background: v.accent }} />
            {v.label}
          </button>
        ))}
        {customVibes.map((v) => (
          <button key={v.id} className="vibe" onClick={() => pick(v.id)}>
            <span className="vibe-dot" style={{ background: rgbToHex(v.rgb) }} />
            {v.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
