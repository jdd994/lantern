// SettingsSheet.tsx — vibe picker + a short, gentle "how it works", on the shared
// @lantern/ui primitives. Presets now; deeper customization is a planned feature.
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";

export const MOODS: ThemeOption[] = [
  { id: "canopy", name: "Canopy", desc: "Under the leaves", bg: "#10150E", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "understory", name: "Understory", desc: "Dimmer, deeper", bg: "#0B0F09", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "meadow", name: "Meadow", desc: "Open daylight", bg: "#EFEDDC", ink: "#26301D", accent: "#5A7C3F" },
];

export function SettingsSheet({
  mood,
  onMood,
  onClose,
}: {
  mood: string;
  onMood: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} ariaLabel="Settings">
      <h3>Settings</h3>

      <section className="set-section">
        <h4 className="set-head">Vibe</h4>
        <p className="hint">Pick the look that feels right. Saved on this device.</p>
        <ThemePicker options={MOODS} current={mood} onSelect={onMood} />
      </section>

      <section className="set-section">
        <h4 className="set-head">How Grove works</h4>
        <p>
          Your family's story is nobody's business but your family's. Every person, bond, and
          keepsake is encrypted on this device before it's stored — a breach of any server would
          yield nothing but noise, and we couldn't read it if we wanted to.
        </p>
        <p>
          Grove is not a records race. No hint leaves, no counts, no completeness meters — a
          scanned letter is a treasure your grandmother touched, never "1 source attached." People
          still living get minimal entries by default; they fill in their own story when they join.
        </p>
        <p className="hint">
          The trade: your passphrase never leaves this device, so there's no reset. Forget it and
          the tree can't be recovered by anyone, including us. Keep it somewhere safe.
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
