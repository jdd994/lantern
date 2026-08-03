// model.ts
// Pure, framework-free logic for the almanac. Operates on decrypted records
// held in memory after the vault is unlocked. No React, no IO here — easy to
// test and reason about. (Same contract as Manifest's model.ts and Grove's.)
//
// The soul, encoded as an absence: a Happening has no invitees, no
// maybe/declined states, no reminder, no recurrence rule. An event is lit;
// people who are coming say so; silence is a first-class answer that never
// renders as "pending". The one social record is the Mark — one small record
// per person per happening, saying only "I'm in". Nobody can write anyone's
// mark but their own, and marks render as names, never numbers.
//
// A Mark is its own record (not an array on the Happening) so two friends
// tapping "I'm in" in the same sync window never last-writer-wins each other
// away. Its happeningId — like a Happening's calendarId — lives inside the
// ciphertext, so the server never learns how records group.

// ---- Calendars -------------------------------------------------------------
// One per circle of friends. Shared via a strand (strandId == calendar id).
export type Calendar = {
  id: string;
  title: string;
  note?: string; // a line about the circle, if it wants one
  createdAt: number;
  updatedAt: number;
  author?: string; // whose hand last touched it (attribution, not score)
};

// ---- Happenings ------------------------------------------------------------
export type Happening = {
  id: string;
  calendarId: string; // which calendar it belongs to — inside the ciphertext
  title: string;
  startsAt: number; // epoch ms, local wall-clock of wherever you'll be
  endsAt?: number;
  allDay?: boolean;
  place?: string; // free text, never a map pin
  link?: string; // tickets, the venue page
  note?: string;
  createdAt: number;
  updatedAt: number;
  author?: string;
};

// ---- Marks -----------------------------------------------------------------
// "I'm in." One record per person per happening, authored only by its owner.
export type Mark = {
  id: string;
  happeningId: string; // inside the ciphertext, same as calendarId above
  who: string; // account email of the person who marked themselves in
  createdAt: number;
  updatedAt: number;
  author?: string;
};

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- Encrypted payloads ---------------------------------------------------
// What actually gets encrypted is a small versioned JSON document per record,
// so everything meaningful travels inside the ciphertext. Decoders are
// defensive: garbage in, empty-but-valid out — never a crash on old data.

export function encodeCalendar(c: Calendar): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = c;
  return JSON.stringify({ __almanac: 1, t: "calendar", ...body });
}

export function encodeHappening(h: Happening): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = h;
  return JSON.stringify({ __almanac: 1, t: "happening", ...body });
}

export function encodeMark(m: Mark): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = m;
  return JSON.stringify({ __almanac: 1, t: "mark", ...body });
}

type Shell = { id: string; createdAt: number; updatedAt: number };

export function decodeCalendar(decrypted: string, shell: Shell): Calendar {
  const o = parseAlmanac(decrypted, "calendar");
  return {
    ...shell,
    title: typeof o.title === "string" ? o.title : "",
    note: typeof o.note === "string" ? o.note : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

export function decodeHappening(decrypted: string, shell: Shell): Happening {
  const o = parseAlmanac(decrypted, "happening");
  return {
    ...shell,
    calendarId: typeof o.calendarId === "string" ? o.calendarId : "",
    title: typeof o.title === "string" ? o.title : "",
    startsAt: typeof o.startsAt === "number" && Number.isFinite(o.startsAt) ? o.startsAt : shell.createdAt,
    endsAt: typeof o.endsAt === "number" && Number.isFinite(o.endsAt) ? o.endsAt : undefined,
    allDay: o.allDay === true || undefined,
    place: typeof o.place === "string" ? o.place : undefined,
    link: typeof o.link === "string" ? o.link : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

export function decodeMark(decrypted: string, shell: Shell): Mark {
  const o = parseAlmanac(decrypted, "mark");
  return {
    ...shell,
    happeningId: typeof o.happeningId === "string" ? o.happeningId : "",
    who: typeof o.who === "string" ? o.who : "",
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

function parseAlmanac(decrypted: string, t: string): Record<string, unknown> {
  try {
    const o = JSON.parse(decrypted);
    if (o && o.__almanac === 1 && o.t === t) return o as Record<string, unknown>;
  } catch {
    // fall through
  }
  return {};
}

// ---- Time ------------------------------------------------------------------

// When a happening stops being "coming up": the end of its (last) day, local
// time. A 7:30 show is still tonight's plan at 11pm — it slips into the wake
// at midnight, not the moment the doors open.
export function effectiveEnd(h: Happening): number {
  const last = h.endsAt ?? h.startsAt;
  const d = new Date(last);
  d.setHours(24, 0, 0, 0); // start of the next local day
  return d.getTime();
}

// ---- Agenda & wake ---------------------------------------------------------

// A calendar's happenings, split at `now`: what's coming (soonest first) and
// the wake — what you've been to, most recent first. The wake is memory, not
// deletion: the almanac keeps past and future in one binding.
export function splitAgenda(
  calendarId: string,
  happenings: Happening[],
  now: number
): { coming: Happening[]; wake: Happening[] } {
  const mine = happenings.filter((h) => h.calendarId === calendarId);
  const coming = mine
    .filter((h) => effectiveEnd(h) > now)
    .sort((a, b) => a.startsAt - b.startsAt || a.createdAt - b.createdAt);
  const wake = mine
    .filter((h) => effectiveEnd(h) <= now)
    .sort((a, b) => b.startsAt - a.startsAt || b.createdAt - a.createdAt);
  return { coming, wake };
}

// Everything coming, across all calendars — the front page of the book.
export function allComing(happenings: Happening[], now: number): Happening[] {
  return happenings
    .filter((h) => effectiveEnd(h) > now)
    .sort((a, b) => a.startsAt - b.startsAt || a.createdAt - b.createdAt);
}

// Group an already-sorted run of happenings under month headings
// ("August 2026"). Presentation grouping only — order is preserved.
export function groupByMonth(run: Happening[]): Array<{ label: string; items: Happening[] }> {
  const out: Array<{ label: string; items: Happening[] }> = [];
  for (const h of run) {
    const d = new Date(h.startsAt);
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(h);
    else out.push({ label, items: [h] });
  }
  return out;
}

// "Sat, Aug 21" / "Sat, Aug 21 · 7:30 PM" — the line under a title.
export function formatWhen(h: Happening): string {
  const d = new Date(h.startsAt);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (h.allDay) return day;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

// ---- Marks -----------------------------------------------------------------

// Who's in, by name (email), in the order they volunteered. One entry per
// person even if a person's mark exists twice (two devices, one tap each) —
// dedup lives here so the write path can stay append-simple.
export function whoIsIn(happeningId: string, marks: Mark[]): string[] {
  const seen = new Map<string, number>();
  for (const m of marks) {
    if (m.happeningId !== happeningId || !m.who) continue;
    const prev = seen.get(m.who);
    if (prev === undefined || m.createdAt < prev) seen.set(m.who, m.createdAt);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([who]) => who);
}

// Every mark record a person holds on a happening — the tombstone set for
// "actually, I can't make it".
export function myMarks(happeningId: string, who: string, marks: Mark[]): Mark[] {
  return marks.filter((m) => m.happeningId === happeningId && m.who === who);
}

// ---- Portability -----------------------------------------------------------
// Every calendar as plain Markdown — readable anywhere, forever. Your plans
// are never hostage here. Marks don't travel on paper: "I'm in" is said to
// the circle, never carried in on a file (same discipline as Manifest's
// claims).

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// 2026-08-21 or 2026-08-21 19:30 — local wall-clock, the almanac's own idiom.
export function formatStamp(h: Happening): string {
  const d = new Date(h.startsAt);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return h.allDay ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toMarkdown(calendars: Calendar[], happenings: Happening[]): string {
  const parts: string[] = [];
  for (const c of [...calendars].sort((a, b) => b.updatedAt - a.updatedAt)) {
    parts.push(`## ${c.title || "Untitled calendar"}`);
    if (c.note) parts.push(c.note);
    const all = happenings
      .filter((h) => h.calendarId === c.id)
      .sort((a, b) => a.startsAt - b.startsAt);
    if (all.length === 0) parts.push("_(empty)_");
    for (const h of all) {
      const bits = [`- ${formatStamp(h)} — ${h.title}`];
      if (h.place) bits.push(`@ ${h.place}`);
      if (h.note) bits.push(`(${h.note})`);
      parts.push(bits.join(" "));
    }
    parts.push("");
  }
  return parts.join("\n");
}

// The way back in: Markdown → drafts ready to persist. Tolerant of hand-written
// files — `## Title` starts a calendar, `- YYYY-MM-DD[ HH:MM] — Title` lines
// are happenings (`@ place` and `(note)` optional), the first plain line under
// a heading becomes the calendar's note.
export type ImportedCalendar = {
  title: string;
  note?: string;
  happenings: Array<{ title: string; startsAt: number; allDay: boolean; place?: string; note?: string }>;
};

export function fromMarkdown(text: string): ImportedCalendar[] {
  const out: ImportedCalendar[] = [];
  let current: ImportedCalendar | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), happenings: [] };
      out.push(current);
      continue;
    }
    if (!current || !line || line === "_(empty)_") continue;
    const item = /^[-*]\s+(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?\s+—\s+(.*)$/.exec(line);
    if (item) {
      const [, y, mo, da, hh, mm, rest] = item;
      const allDay = hh === undefined;
      const startsAt = new Date(
        Number(y), Number(mo) - 1, Number(da),
        allDay ? 0 : Number(hh), allDay ? 0 : Number(mm)
      ).getTime();
      let title = rest.trim();
      let note: string | undefined;
      let place: string | undefined;
      const noteM = /\s+\(([^)]*)\)\s*$/.exec(title);
      if (noteM) {
        note = noteM[1].trim() || undefined;
        title = title.slice(0, noteM.index).trim();
      }
      const placeM = /\s+@\s+(.+)$/.exec(title);
      if (placeM) {
        place = placeM[1].trim() || undefined;
        title = title.slice(0, placeM.index).trim();
      }
      if (title) current.happenings.push({ title, startsAt, allDay, place, note });
    } else if (!current.note && current.happenings.length === 0) {
      current.note = line;
    }
  }
  return out.filter((c) => c.title || c.happenings.length);
}
