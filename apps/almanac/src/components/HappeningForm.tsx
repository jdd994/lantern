// HappeningForm.tsx — putting a plan in the book, or amending one. A title and
// a date are the whole ask; time, place, link, and a note are there when they
// help. No invitees to pick, no availability to poll — the plan goes in, and
// whoever's coming says so themselves.

import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Happening } from "../lib/model";

export type HappeningDraft = {
  title: string;
  startsAt: number;
  endsAt?: number;
  allDay?: boolean;
  place?: string;
  link?: string;
  note?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HappeningForm({
  existing,
  onSave,
  onClose,
}: {
  existing?: Happening; // present when amending
  onSave: (draft: HappeningDraft) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(existing ? toDateInput(existing.startsAt) : "");
  const [time, setTime] = useState(existing && !existing.allDay ? toTimeInput(existing.startsAt) : "");
  const [place, setPlace] = useState(existing?.place ?? "");
  const [link, setLink] = useState(existing?.link ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return;
    if (!date) return setError("It needs a day — that's the almanac's whole trade.");
    const [y, mo, da] = date.split("-").map(Number);
    const allDay = !time;
    let startsAt: number;
    if (allDay) {
      startsAt = new Date(y, mo - 1, da).getTime();
    } else {
      const [hh, mm] = time.split(":").map(Number);
      startsAt = new Date(y, mo - 1, da, hh, mm).getTime();
    }
    onSave({
      title,
      startsAt,
      allDay: allDay || undefined,
      place: place || undefined,
      link: link || undefined,
      note: note || undefined,
    });
  }

  return (
    <Sheet onClose={onClose} ariaLabel={existing ? "Amend this plan" : "New plan"}>
      <h3>{existing ? "Amend the entry" : "Into the book"}</h3>
      <form onSubmit={submit}>
        {error ? <div className="error">{error}</div> : null}
        <label className="field">
          <span className="label">What's happening?</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Hozier at the Armory"
            autoFocus={!existing}
          />
        </label>
        <div className="row">
          <label className="field">
            <span className="label">Day</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Time (optional)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label">Where (optional)</span>
          <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="The Armory, Minneapolis" />
        </label>
        <label className="field">
          <span className="label">A link, if there is one (optional)</span>
          <input type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="tickets, the venue page…" inputMode="url" />
        </label>
        <label className="field">
          <span className="label">A note (optional)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="doors at 7, meet at the taproom first" />
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
            {existing ? "Save" : "Add it"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
