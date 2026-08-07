// AddKeepsake.tsx — evidence as treasure. A photo, a scanned letter, a
// certificate — plus what the family says about it. Everything here is
// optional except that something is said or shown: a keepsake with neither a
// scan nor a word isn't one yet.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Sheet } from "@lantern/ui";
import { displayName, yearWhen, type Person, type When } from "../lib/model";
import type { KeepsakeDraft } from "../hooks/useGrove";

export function AddKeepsake({
  person,
  onAdd,
  onClose,
}: {
  person: Person;
  onAdd: (draft: KeepsakeDraft, file?: File) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [file, setFile] = useState<File | undefined>(undefined);
  const [caption, setCaption] = useState("");
  const [transcription, setTranscription] = useState("");
  const [year, setYear] = useState("");
  const [qualifier, setQualifier] = useState<"" | NonNullable<When["qualifier"]>>("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file && !caption.trim() && !transcription.trim()) {
      return setError(t`Add a photo or scan, or say something about it — a keepsake needs one or the other.`);
    }
    const y = year.trim() ? Number(year.trim()) : undefined;
    if (year.trim() && !Number.isFinite(y)) return setError(t`The year didn't read as a number.`);
    onAdd(
      {
        about: [person.id],
        caption: caption.trim() || undefined,
        transcription: transcription.trim() || undefined,
        when: yearWhen(y, qualifier || undefined),
      },
      file
    );
    onClose();
  }

  return (
    <Sheet onClose={onClose} ariaLabel={t`Add a keepsake`}>
      <h3><Trans>A keepsake of {displayName(person)}</Trans></h3>
      <p className="hint">
        <Trans>A photo, a scanned letter, a document — kept as itself, encrypted like everything else.</Trans>
      </p>
      <form onSubmit={submit}>
        {error ? <div className="error">{error}</div> : null}
        <label className="field">
          <span className="label"><Trans>Photo or scan (JPEG, PNG, or PDF)</Trans></span>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? undefined)}
          />
        </label>
        <label className="field">
          <span className="label"><Trans>What is it?</Trans></span>
          <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t`Letter home, 1944`} />
        </label>
        <label className="field">
          <span className="label"><Trans>What it says, typed out (so it can be read and remembered)</Trans></span>
          <textarea className="transcription" value={transcription} onChange={(e) => setTranscription(e.target.value)} placeholder={t`Dear June…`} />
        </label>
        <div className="row">
          <label className="field">
            <span className="label"><Trans>From (year, if known)</Trans></span>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder={t`1944`} />
          </label>
          <label className="field">
            <span className="label"><Trans>How sure?</Trans></span>
            <select value={qualifier} onChange={(e) => setQualifier(e.target.value as typeof qualifier)}>
              <option value="">{t`Exactly`}</option>
              <option value="about">{t`About`}</option>
              <option value="before">{t`Before`}</option>
              <option value="after">{t`After`}</option>
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}><Trans>Cancel</Trans></button>
          <button type="submit" className="btn btn-primary"><Trans>Keep it</Trans></button>
        </div>
      </form>
    </Sheet>
  );
}
