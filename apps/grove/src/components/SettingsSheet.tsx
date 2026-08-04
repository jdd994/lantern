// SettingsSheet.tsx — vibe picker, a short gentle "how it works", and the
// portability drawer (GEDCOM in and out — history is never hostage here), on
// the shared @lantern/ui primitives.
import { useRef, useState } from "react";
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";

export const MOODS: ThemeOption[] = [
  { id: "canopy", name: "Canopy", desc: "Under the leaves", bg: "#10150E", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "understory", name: "Understory", desc: "Dimmer, deeper", bg: "#0B0F09", ink: "#E4E8D8", accent: "#96BE72" },
  { id: "meadow", name: "Meadow", desc: "Open daylight", bg: "#EFEDDC", ink: "#26301D", accent: "#5A7C3F" },
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
  onExport: (privatizeLiving: boolean) => string;
  onImport: (text: string) => Promise<{ people: number; unions: number; keepsakes: number } | string>;
  onInstallHelp: () => void;
  onClose: () => void;
}) {
  const [privatize, setPrivatize] = useState(true);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
        setImportNote(
          `Welcomed ${result.people === 1 ? "1 person" : `${result.people} people`}, ` +
            `${result.unions === 1 ? "1 family" : `${result.unions} families`}, and ` +
            `${result.keepsakes === 1 ? "1 keepsake" : `${result.keepsakes} keepsakes`} into the grove.`
        );
      }
    } finally {
      setImporting(false);
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
        <h4 className="set-head">Your family's history is portable</h4>
        <p className="hint">
          GEDCOM is genealogy's common tongue — the format Ancestry and every desktop tool
          speaks. Names, dates, bonds, and the words of your keepsakes travel; the scans
          themselves stay safe in Grove.
        </p>
        <label className="check">
          <input type="checkbox" checked={privatize} onChange={(e) => setPrivatize(e.target.checked)} />
          <span>Keep living people private in the export</span>
        </label>
        {!privatize ? (
          <p className="hint">
            Everything about the living will be in the file, in plain text. Only turn this off
            for a copy that stays inside the family.
          </p>
        ) : null}
        <div className="sheet-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
          <button className="btn" onClick={download}>Export .ged</button>
          <button className="btn btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? "Reading…" : "Import a .ged"}
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
        <p className="hint">Import adds to the grove — it never overwrites, and it won't try to merge duplicates.</p>
      </section>

      <section className="set-section">
        <h4 className="set-head">Keep Grove close</h4>
        <p className="hint">
          Grove can live on your home screen like any app — helpful to know when you're getting a
          relative set up. <button type="button" className="linklike" onClick={onInstallHelp}>How to install, step by step</button>
        </p>
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
          The trade: your passphrase never leaves this device, so there's no reset by email —
          that button would mean someone else could read the tree. Two ways back in live in
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
