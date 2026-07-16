// HelpSheet.tsx — a calm "what is all this?" reference, reachable any time from the
// header. Plain, second person, no jargon.
import { Sheet } from "@lantern/ui";

const ITEMS: { title: string; body: string }[] = [
  { title: "Lights", body: "Tap a light to turn it on or off and drag to dim it. Color bulbs show a swatch; white bulbs show a warm-to-cool temperature slider." },
  { title: "Vibe", body: "The row at the top sets a mood across everything in one tap. Make your own with + New, or open Auto… to let the room and time of day choose." },
  { title: "Scenes", body: "Set your lights how you like them, then Save current. One tap later brings that whole look back — per room, or the whole home." },
  { title: "Rooms", body: "Group lights by where they are. Each room has its own vibe and All on / All off. A light lives in one room, or none." },
  { title: "Automations", body: "Have the lights change on their own — at a set time, or at sunrise / sunset. They run while Aura is open." },
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} ariaLabel="How Aura works">
      <h3>How Aura works</h3>
      {ITEMS.map((it) => (
        <div className="set-section" key={it.title}>
          <span className="label">{it.title}</span>
          <p className="hint">{it.body}</p>
        </div>
      ))}
      <div className="set-section">
        <span className="label">Your privacy</span>
        <p className="hint">
          Aura runs entirely on this device and talks straight to each light brand. It has no account
          and no server of its own — your keys, lights, and scenes never leave here.
        </p>
      </div>
    </Sheet>
  );
}
