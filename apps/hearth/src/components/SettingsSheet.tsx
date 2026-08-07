// SettingsSheet.tsx — vibe picker + a short, gentle "how it works", on the shared
// @lantern/ui primitives. Presets now; deeper customization is a planned feature.
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import type { DistanceUnit } from "../lib/run";

export const MOODS: ThemeOption[] = [
  { id: "ember", name: "Ember", desc: "Warm firelight", bg: "#1A130D", ink: "#EDE3D2", accent: "#E08A4A" },
  { id: "hearthlight", name: "Hearthlight", desc: "Dimmer, cozier", bg: "#140E09", ink: "#EDE3D2", accent: "#E08A4A" },
  { id: "cream", name: "Cream", desc: "Warm daylight", bg: "#F0E7D6", ink: "#2A2015", accent: "#C0662A" },
];

export function SettingsSheet({
  mood,
  onMood,
  unit,
  onUnit,
  onInstallHelp,
  onClose,
}: {
  mood: string;
  onMood: (id: string) => void;
  unit: DistanceUnit;
  onUnit: (u: DistanceUnit) => void;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} ariaLabel="Settings">
      <h3>Settings</h3>

      <section className="set-section">
        <h4 className="set-head">Vibe</h4>
        <p className="hint">Pick the look that feels right — warm at any hour. Saved on this device.</p>
        <ThemePicker options={MOODS} current={mood} onSelect={onMood} />
      </section>

      <section className="set-section">
        <h4 className="set-head">Distance</h4>
        <p className="hint">How runs are shown. Stored honestly in metres either way.</p>
        <div className="choices">
          {(["km", "mi"] as DistanceUnit[]).map((u) => (
            <button key={u} type="button" className="choice" aria-pressed={unit === u} onClick={() => onUnit(u)}>
              {u === "km" ? "Kilometres" : "Miles"}
            </button>
          ))}
        </div>
      </section>

      <section className="set-section">
        <h4 className="set-head">Keep Hearth close</h4>
        <p className="hint">
          Hearth can live on your home screen like any app.{" "}
          <button type="button" className="linklike" onClick={onInstallHelp}>How to install, step by step</button>
        </p>
      </section>

      <section className="set-section">
        <h4 className="set-head">How Hearth works</h4>
        <p>
          What you eat and how you're doing is nobody's business but yours. Everything you log is
          encrypted on this device before it's stored — a breach of our servers would yield nothing
          but noise, and we couldn't read it if we wanted to.
        </p>
        <p>
          Hearth is not a diet app. No "bad" foods, no shame, no streaks to break, no bodies to
          measure you against — just your own picture, shown kindly. No ads, no analytics, nobody
          watching what you eat.
        </p>
        <p className="hint">
          The trade: your passphrase never leaves this device, so there's no reset by email —
          that button would mean someone else could read your data. Two ways back in live in
          Sync: a printed recovery kit (a one-page code for a fire safe), or Guardians — a
          few people you trust, jointly. Keep the passphrase somewhere safe as well.
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
