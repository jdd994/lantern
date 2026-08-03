// NewCalendar.tsx — starting a calendar is one field, because the real work is
// the plans, not the paperwork.

import { useState } from "react";
import { Sheet } from "@lantern/ui";

export function NewCalendar({
  onCreate,
  onClose,
}: {
  onCreate: (title: string, note?: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate(title, note || undefined);
  }

  return (
    <Sheet onClose={onClose} ariaLabel="New calendar">
      <h3>New calendar</h3>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">Whose plans are these?</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Show crew"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="label">A note, if it helps (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="gigs, fairs, and whatever else we say yes to"
          />
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Open the book</button>
        </div>
      </form>
    </Sheet>
  );
}
