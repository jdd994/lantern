// NewList.tsx — starting a list is one field, because the real work is
// remembering things at 11pm, not filling in forms.

import { useState } from "react";
import { Sheet } from "@lantern/ui";

export function NewList({
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
    <Sheet onClose={onClose} ariaLabel="New list">
      <h3>New list</h3>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">What's it for?</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="North Shore, late August"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="label">A note, if it helps (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="cabin has pots & pans, bring everything else"
          />
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Start the list</button>
        </div>
      </form>
    </Sheet>
  );
}
