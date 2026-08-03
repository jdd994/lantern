// SettingsSheet.tsx — vibe picker, a short gentle "how it works", and the
// portability drawer, on the shared @lantern/ui primitives. Two doors in:
// our own Markdown, and .ics from Google/Apple/Proton — so a circle can walk
// out of a shared Google calendar and keep every plan.
import { useRef, useState } from "react";
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import { shortName } from "../lib/model";
import type { IcsImport } from "../lib/ics";

export const MOODS: ThemeOption[] = [
  { id: "broadsheet", name: "Broadsheet", desc: "Paper and printer's ink", bg: "#F4EFE2", ink: "#2B2620", accent: "#A3402F" },
  { id: "lamplight", name: "Lamplight", desc: "The book by a warm lamp", bg: "#171310", ink: "#E8E2D6", accent: "#D08B4C" },
  { id: "moonrise", name: "Moonrise", desc: "Dimmer, bluer, later", bg: "#0E1218", ink: "#DEE2E6", accent: "#8FA8C7" },
];

export function SettingsSheet({
  mood,
  onMood,
  account,
  myName,
  onSetName,
  onExport,
  onImport,
  onImportICS,
  onInstallHelp,
  onClose,
}: {
  mood: string;
  onMood: (id: string) => void;
  account: string | null;
  myName: string; // the raw chosen name ("" when none yet)
  onSetName: (name: string) => void;
  onExport: () => string;
  onImport: (text: string) => { calendars: number; happenings: number } | string;
  onImportICS: (text: string) => { calendarId: string; added: number; skipped: IcsImport } | string;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [name, setName] = useState(myName);
  const [nameSaved, setNameSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    onSetName(name);
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1800);
  }

  function download() {
    const text = onExport();
    // data: URL, not blob: — the CSP-safe pattern shared with the siblings.
    const a = document.createElement("a");
    a.href = `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`;
    a.download = "almanac.md";
    a.click();
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setImportNote(null);
    try {
      const text = await file.text();
      const isIcs = /\.ics$/i.test(file.name) || /^BEGIN:VCALENDAR/m.test(text);
      if (isIcs) {
        const result = onImportICS(text);
        if (typeof result === "string") setImportError(result);
        else {
          const bits = [`Brought in ${result.added} ${result.added === 1 ? "plan" : "plans"}.`];
          if (result.skipped.skippedRecurring) {
            bits.push(
              `${result.skipped.skippedRecurring} repeating ${result.skipped.skippedRecurring === 1 ? "event" : "events"} stayed behind — Almanac doesn't do recurrence.`
            );
          }
          if (result.skipped.skippedUnreadable) {
            bits.push(`${result.skipped.skippedUnreadable} couldn't be read.`);
          }
          setImportNote(bits.join(" "));
        }
      } else {
        const result = onImport(text);
        if (typeof result === "string") setImportError(result);
        else {
          setImportNote(
            `Brought in ${result.calendars} ${result.calendars === 1 ? "calendar" : "calendars"} and ` +
              `${result.happenings} ${result.happenings === 1 ? "plan" : "plans"}.`
          );
        }
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

      {account ? (
        <section className="set-section">
          <h4 className="set-head">How you're signed</h4>
          <p className="hint">
            The name your circle sees next to "I'm in" — instead of{" "}
            <strong>{shortName(account)}</strong> from your address. It travels encrypted with
            your plans; leave it empty to stay {shortName(account)}.
          </p>
          <form onSubmit={saveName}>
            <div className="row">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Johnny"
                maxLength={40}
                aria-label="Your display name"
              />
              <button type="submit" className="btn" disabled={name.trim() === myName.trim()}>
                {nameSaved ? "Saved" : "Save"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="set-section">
        <h4 className="set-head">Your plans are portable</h4>
        <p className="hint">
          Every calendar as plain Markdown — readable in any notes app, forever. And the way in
          works from anywhere: import a .md, or a <strong>.ics export from Google or Apple
          Calendar</strong> — the whole shared calendar your circle is leaving behind. Read
          entirely on this device; nothing is uploaded.
        </p>
        <div className="sheet-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
          <button className="btn" onClick={download}>Export .md</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import .md or .ics</button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.ics,text/markdown,text/plain,text/calendar"
            style={{ display: "none" }}
            onChange={(e) => void importFile(e.target.files?.[0] ?? undefined)}
          />
        </div>
        {importNote ? <p className="hint">{importNote}</p> : null}
        {importError ? <div className="error">{importError}</div> : null}
        <p className="hint">Import adds fresh private calendars — it never overwrites, and nobody's "I'm in" travels on paper.</p>
      </section>

      <section className="set-section">
        <h4 className="set-head">Keep Almanac close</h4>
        <p className="hint">
          Almanac can live on your home screen like any app — one tap on the way out the door.{" "}
          <button type="button" className="linklike" onClick={onInstallHelp}>How to install, step by step</button>
        </p>
      </section>

      <section className="set-section">
        <h4 className="set-head">How Almanac works</h4>
        <p>
          Where you'll be on Friday night is nobody's business but the people going with you. Every
          calendar and every plan is encrypted on this device before it's stored; a breach of any
          server would yield nothing but noise, and we couldn't read it if we wanted to.
        </p>
        <p>
          Almanac is a book, not an assistant. No reminders, no notifications, no maybes — a plan
          goes in, whoever's coming says <em>"I'm in"</em>, and silence is a fine answer. Past
          plans settle into the wake: the book remembers where you've been, quietly.
        </p>
        <p>
          Friends on Google or Apple aren't left out: any plan — or the whole calendar — downloads
          as a .ics file their calendar opens, made on this device and handed straight to them.
        </p>
        <p className="hint">
          The trade: your passphrase never leaves this device, so there's no reset by email —
          that button would mean someone else could read your plans. If you forget it, Guardians
          (in Sync) are the way back in: a few people you trust, jointly. Keep it somewhere
          safe as well.
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
