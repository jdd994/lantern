// HelpSheet.tsx — a calm "what is all this?" reference, reachable any time from the
// header. Plain, second person, no jargon. Also where a note to the maker and
// the tip jar live — see NoteToMaker/Support below for why they're shaped the
// way they are.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import { sendFeedback } from "../lib/api";

const ITEMS: { title: string; body: string }[] = [
  { title: "Lights", body: "Tap a light to turn it on or off and drag to dim it. Color bulbs show a swatch; white bulbs show a warm-to-cool temperature slider." },
  { title: "Vibe", body: "The row at the top sets a mood across everything in one tap. Make your own with + New, or open Auto… to let the room and time of day choose." },
  { title: "Scenes", body: "Set your lights how you like them, then Save current. One tap later brings that whole look back — per room, or the whole home." },
  { title: "Rooms", body: "Group lights by where they are. Each room has its own vibe and All on / All off. A light lives in one room, or none." },
  { title: "Automations", body: "Have the lights change on their own — at a set time, or at sunrise / sunset. They run while Aura is open." },
];

// Tip / support options — same addresses as the other lantern apps (same
// maker, same jar). A card link (Ko-fi, PayPal underneath) leads since it's
// the welcoming front door for most people; crypto follows as the quiet
// zero-paperwork alternative. Just an outbound link + copyable addresses — no
// processor or widget in the app, no tracker, no CSP change.
const SUPPORT = {
  fiatUrl: "https://ko-fi.com/johnny65449",
  crypto: [
    { label: "Bitcoin", value: "bc1qvhzyyhjngwyc02p5ska0pk33tvn6dnq06vacgv" },
    { label: "Ethereum", value: "0x6857f91F7Fcd7B45a3ab3A51D2CdC47E23FE8c75" },
  ],
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the address is still visible to copy by hand
    }
  }
  return (
    <div className="support-row">
      <span className="support-label">{label}</span>
      <button className="support-addr" onClick={copy} title={`Copy ${label} address`}>
        <span className="support-addr-text">{value}</span>
        <span className="support-copy">{copied ? "copied ✓" : "copy"}</span>
      </button>
    </div>
  );
}

// A calm note to the maker — the only thing in Aura that ever leaves this
// device unprompted by you, and only when you choose to send it. Kept
// separate from every light/room/scene concept: this is a plain message about
// the app, not a feature of it.
function NoteToMaker() {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const m = message.trim();
    if (!m || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(m, contact.trim() || undefined);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that just now — try again in a bit.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="note-maker">
        <h3>Thank you</h3>
        <p className="hint">Got it. I read these when I can — no rush, no obligation. It means a lot.</p>
      </section>
    );
  }

  return (
    <section className="note-maker">
      <h3>Tell me what's clunky</h3>
      <p className="hint">
        Something confusing, missing, or just a thought? Send it my way — a plain note to me, kept
        separate from anything about your lights. I read these when I can, no rush.
      </p>
      <textarea
        className="note-input"
        rows={3}
        placeholder="What's on your mind about Aura?"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <input
        className="note-contact"
        placeholder="Email, if you'd like a reply (optional)"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
      />
      {error && <p className="note-error">{error}</p>}
      <button className="btn btn-sm note-send" disabled={!message.trim() || busy} onClick={send}>
        {busy ? "Sending…" : "Send"}
      </button>
    </section>
  );
}

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
          Aura runs entirely on this device and talks straight to each light brand. It has no account,
          and your keys, lights, and scenes never leave here. The one exception is a note you choose to
          send below — that's the only thing in Aura that ever reaches a server of ours.
        </p>
      </div>

      <NoteToMaker />

      <section className="support">
        <h3>Support Aura</h3>
        <p className="hint">
          Aura is free, and always will be — no ads, no tracking, nothing sold. If it's meaningful to
          you, a small tip helps keep it going.
        </p>
        <a className="support-card" href={SUPPORT.fiatUrl} target="_blank" rel="noopener noreferrer">
          Leave a tip with a card &nbsp;→
        </a>
        <div className="support-crypto">
          <span className="support-crypto-label">or, if you prefer crypto</span>
          {SUPPORT.crypto.map((c) => (
            <CopyRow key={c.label} label={c.label} value={c.value} />
          ))}
        </div>
        <p className="support-note-plain">
          And if it's not for you right now, that's completely fine — you get exactly the same app
          either way, nothing held back.
        </p>
      </section>

      <div className="kin">
        <span className="kin-label">Made in the same spirit</span>
        <a href="https://driftless.page" target="_blank" rel="noopener noreferrer">
          Driftless — a quiet place to catch your thoughts →
        </a>
      </div>
    </Sheet>
  );
}
