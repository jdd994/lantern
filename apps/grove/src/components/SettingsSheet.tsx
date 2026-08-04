// SettingsSheet.tsx — vibe picker, language, a short gentle "how it works",
// and the portability drawer (GEDCOM in and out — history is never hostage
// here), on the shared @lantern/ui primitives.
//
// i18n pilot note: user-facing copy goes through Lingui macros (<Trans>, t,
// plural). Mood ids are stable data keys and never translated; their names
// and descriptions are display copy, so they're built inside the component
// where the active language can reach them.
import { useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import type { LocaleOption } from "../lib/i18n";

// Stable ids + palette tokens. Display names live in moodOptions() below.
export const MOODS = [
  { id: "canopy", bg: "#10150E", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "understory", bg: "#0B0F09", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "meadow", bg: "#EFEDDC", ink: "#26301D", accent: "#5A7C3F" },
];

export function SettingsSheet({
  mood,
  onMood,
  locale,
  locales,
  onLocale,
  onExport,
  onImport,
  onInstallHelp,
  onClose,
}: {
  mood: string;
  onMood: (id: string) => void;
  locale: string;
  locales: LocaleOption[];
  onLocale: (id: string) => void;
  onExport: (privatizeLiving: boolean) => string;
  onImport: (text: string) => Promise<{ people: number; unions: number; keepsakes: number } | string>;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [privatize, setPrivatize] = useState(true);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const moodOptions: ThemeOption[] = [
    { ...MOODS[0], name: t`Canopy`, desc: t`Under the leaves` },
    { ...MOODS[1], name: t`Understory`, desc: t`Dimmer, deeper` },
    { ...MOODS[2], name: t`Meadow`, desc: t`Open daylight` },
  ];

  function download() {
    const text = onExport(privatize);
    // data: URL, not blob: — the same CSP-safe pattern as the keepsake scans.
    const a = document.createElement("a");
    a.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(text)}`;
    a.download = "grove.ged";
    a.click();
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setImportNote(null);
    setImporting(true);
    try {
      const result = await onImport(await file.text());
      if (typeof result === "string") setImportError(result);
      else {
        const people = plural(result.people, { one: "1 person", other: "# people" });
        const unions = plural(result.unions, { one: "1 family", other: "# families" });
        const keepsakes = plural(result.keepsakes, { one: "1 keepsake", other: "# keepsakes" });
        setImportNote(t`Welcomed ${people}, ${unions}, and ${keepsakes} into the grove.`);
      }
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel={t`Settings`}>
      <h3><Trans>Settings</Trans></h3>

      <section className="set-section">
        <h4 className="set-head"><Trans>Vibe</Trans></h4>
        <p className="hint"><Trans>Pick the look that feels right. Saved on this device.</Trans></p>
        <ThemePicker options={moodOptions} current={mood} onSelect={onMood} />
      </section>

      <section className="set-section">
        <h4 className="set-head"><Trans>Language</Trans></h4>
        <p className="hint">
          <Trans>
            Saved on this device. A language is downloaded only when you choose it — your
            device never holds one you don't use.
          </Trans>
        </p>
        <label className="field">
          <select value={locale} onChange={(e) => onLocale(e.target.value)} aria-label={t`Language`}>
            {locales.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="set-section">
        <h4 className="set-head"><Trans>Your family's history is portable</Trans></h4>
        <p className="hint">
          <Trans>
            GEDCOM is genealogy's common tongue — the format Ancestry and every desktop tool
            speaks. Names, dates, bonds, and the words of your keepsakes travel; the scans
            themselves stay safe in Grove.
          </Trans>
        </p>
        <label className="check">
          <input type="checkbox" checked={privatize} onChange={(e) => setPrivatize(e.target.checked)} />
          <span><Trans>Keep living people private in the export</Trans></span>
        </label>
        {!privatize ? (
          <p className="hint">
            <Trans>
              Everything about the living will be in the file, in plain text. Only turn this off
              for a copy that stays inside the family.
            </Trans>
          </p>
        ) : null}
        <div className="sheet-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
          <button className="btn" onClick={download}><Trans>Export .ged</Trans></button>
          <button className="btn btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? t`Reading…` : t`Import a .ged`}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".ged,text/plain"
            style={{ display: "none" }}
            onChange={(e) => void importFile(e.target.files?.[0] ?? undefined)}
          />
        </div>
        {importNote ? <p className="hint">{importNote}</p> : null}
        {importError ? <div className="error">{importError}</div> : null}
        <p className="hint"><Trans>Import adds to the grove — it never overwrites, and it won't try to merge duplicates.</Trans></p>
      </section>

      <section className="set-section">
        <h4 className="set-head"><Trans>Keep Grove close</Trans></h4>
        <p className="hint">
          <Trans>
            Grove can live on your home screen like any app — helpful to know when you're getting a
            relative set up. <button type="button" className="linklike" onClick={onInstallHelp}>How to install, step by step</button>
          </Trans>
        </p>
      </section>

      <section className="set-section">
        <h4 className="set-head"><Trans>How Grove works</Trans></h4>
        <p>
          <Trans>
            Your family's story is nobody's business but your family's. Every person, bond, and
            keepsake is encrypted on this device before it's stored — a breach of any server would
            yield nothing but noise, and we couldn't read it if we wanted to.
          </Trans>
        </p>
        <p>
          <Trans>
            Grove is not a records race. No hint leaves, no counts, no completeness meters — a
            scanned letter is a treasure your grandmother touched, never "1 source attached." People
            still living get minimal entries by default; they fill in their own story when they join.
          </Trans>
        </p>
        <p className="hint">
          <Trans>
            The trade: your passphrase never leaves this device, so there's no reset by email —
            that button would mean someone else could read the tree. Two ways back in live in
            Sync: a printed recovery kit (a one-page code for a fire safe), or Guardians — a
            few people you trust, jointly. Keep the passphrase somewhere safe as well.
          </Trans>
        </p>
      </section>

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}><Trans>Close</Trans></button>
      </div>
    </Sheet>
  );
}
