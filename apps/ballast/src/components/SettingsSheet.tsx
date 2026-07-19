// SettingsSheet.tsx — the vibe picker + a short "how it works" (the in-app help),
// built on the shared @lantern/ui primitives. Presets now; deeper per-user
// customization is a planned shared feature.
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";

export const MOODS: ThemeOption[] = [
  { id: "deep", name: "Deep", desc: "Green-black, still", bg: "#0F1512", ink: "#E2E7E2", accent: "#C9A961" },
  { id: "midnight", name: "Midnight", desc: "Cooler, deeper", bg: "#0B1016", ink: "#E2E7E2", accent: "#C9A961" },
  { id: "shoreline", name: "Shoreline", desc: "Warm daylight", bg: "#ECE6D8", ink: "#22281F", accent: "#9A7B2E" },
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
        <p className="hint">Pick the look that feels right — calm at any hour. Saved on this device.</p>
        <ThemePicker options={MOODS} current={mood} onSelect={onMood} />
      </section>

      <section className="set-section">
        <h4 className="set-head">How Ballast works</h4>
        <p>
          Everything you put here — balances, accounts, goals — is encrypted on this device before
          it's stored anywhere. Not "in transit": encrypted so that we couldn't read it if we
          wanted to, and a breach of our servers would yield nothing but noise.
        </p>
        <p>
          Every account you connect wears a badge saying exactly who learns what, and it keeps
          wearing it. No ads, no affiliate links, no product recommendations, no analytics — nobody
          buys a look at your money, because nobody <em>can</em>.
        </p>
        <p className="hint">
          The trade: your passphrase never leaves this device, so there's no reset. Forget it and
          nobody — not us, not anyone — can get your data back. Keep it somewhere safe — or set up
          Guardians (in Sync) so a few people you trust can jointly help you back in.
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
