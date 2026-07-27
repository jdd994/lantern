// AddKeepsake.tsx — evidence as treasure. A photo, a scanned letter, a
// certificate — plus what the family says about it. Everything here is
// optional except that something is said or shown: a keepsake with neither a
// scan nor a word isn't one yet.

import { useState } from "react";
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
      return setError("Add a photo or scan, or say something about it — a keepsake needs one or the other.");
    }
    const y = year.trim() ? Number(year.trim()) : undefined;
    if (year.trim() && !Number.isFinite(y)) return setError("The year didn't read as a number.");
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
    <Sheet onClose={onClose} ariaLabel="Add a keepsake">
      <h3>A keepsake of {displayName(person)}</h3>
      <p className="hint">
        A photo, a scanned letter, a document — kept as itself, encrypted like everything else.
      </p>
      <form onSubmit={submit}>
        {error ? <div className="error">{error}</div> : null}
        <label className="field">
          <span className="label">Photo or scan (JPEG, PNG, or PDF)</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? undefined)}
          />
        </label>
        <label className="field">
          <span className="label">What is it?</span>
          <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Letter home, 1944" />
        </label>
        <label className="field">
          <span className="label">What it says, typed out (so it can be read and remembered)</span>
          <textarea className="transcription" value={transcription} onChange={(e) => setTranscription(e.target.value)} placeholder="Dear June…" />
        </label>
        <div className="row">
          <label className="field">
            <span className="label">From (year, if known)</span>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="1944" />
          </label>
          <label className="field">
            <span className="label">How sure?</span>
            <select value={qualifier} onChange={(e) => setQualifier(e.target.value as typeof qualifier)}>
              <option value="">Exactly</option>
              <option value="about">About</option>
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Keep it</button>
        </div>
      </form>
    </Sheet>
  );
}
