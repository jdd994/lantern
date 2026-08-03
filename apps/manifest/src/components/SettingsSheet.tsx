// SettingsSheet.tsx — vibe picker, a short gentle "how it works", and the
// portability drawer (your lists as plain Markdown, out AND back in — never
// hostage here), on the shared @lantern/ui primitives.
import { useRef, useState } from "react";
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";

export const MOODS: ThemeOption[] = [
  { id: "chartroom", name: "Chartroom", desc: "Lamplight over the charts", bg: "#0D131A", ink: "#E3E4DE", accent: "#D9AE62" },
  { id: "nightwatch", name: "Night watch", desc: "Dimmer, quieter", bg: "#080D13", ink: "#E3E4DE", accent: "#D9AE62" },
  { id: "daybreak", name: "Daybreak", desc: "Paper and morning light", bg: "#EDEAE0", ink: "#232B32", accent: "#8F6E33" },
];

export function SettingsSheet({
  mood,
  onMood,
  onExport,
  onImport,
  onInstallHelp,
  onClose,
}: {
  mood: string;
  onMood: (id: string) => void;
  onExport: () => string;
  onImport: (text: string) => { lists: number; items: number } | string;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function download() {
    const text = onExport();
    // data: URL, not blob: — the CSP-safe pattern shared with the siblings.
    const a = document.createElement("a");
    a.href = `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`;
    a.download = "manifest.md";
    a.click();
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setImportNote(null);
    try {
      const result = onImport(await file.text());
      if (typeof result === "string") setImportError(result);
      else {
        setImportNote(
          `Brought aboard ${result.lists} ${result.lists === 1 ? "list" : "lists"} and ` +
            `${result.items} ${result.items === 1 ? "item" : "items"}.`
        );
      }
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Settings">
      <h3>Settings</h3>

      <section className="set-section">
        <h4 className="set-head">Vibe</h4>
        <p className="hint">Pick the look that feels right. Saved on this device.</p>
        <ThemePicker options={MOODS} current={mood} onSelect={onMood} />
      </section>

      <section className="set-section">
        <h4 className="set-head">Your lists are portable</h4>
        <p className="hint">
          Every list as plain Markdown checklists — readable in any notes app, any editor,
          forever. What's checked and who's bringing what travels as ordinary text.
        </p>
        <div className="sheet-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
          <button className="btn" onClick={download}>Export .md</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import a .md</button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            style={{ display: "none" }}
            onChange={(e) => void importFile(e.target.files?.[0] ?? undefined)}
          />
        </div>
        {importNote ? <p className="hint">{importNote}</p> : null}
        {importError ? <div className="error">{importError}</div> : null}
        <p className="hint">Import adds fresh private lists — it never overwrites, and claims don't travel on paper.</p>
      </section>

      <section className="set-section">
        <h4 className="set-head">Keep Manifest close</h4>
        <p className="hint">
          Manifest can live on your home screen like any app — handy at the door with your hands
          full. <button type="button" className="linklike" onClick={onInstallHelp}>How to install, step by step</button>
        </p>
      </section>

      <section className="set-section">
        <h4 className="set-head">How Manifest works</h4>
        <p>
          What you're packing — and where you're going — is nobody's business but yours. Every
          list and every item is encrypted on this device before it's stored; a breach of any
          server would yield nothing but noise, and we couldn't read it if we wanted to.
        </p>
        <p>
          Manifest is a checklist, not a taskmaster. No due dates, no reminders, no streaks, no
          productivity score — the list waits quietly until you reach for it. On a shared list an
          item is <em>claimed</em>, never assigned: the list says needed, and someone says "I've
          got it."
        </p>
        <p className="hint">
          The trade: your passphrase never leaves this device, so there's no reset. Forget it and
          your lists can't be recovered by anyone, including us. Keep it somewhere safe.
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
