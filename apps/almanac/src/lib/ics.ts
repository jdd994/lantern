// ics.ts — the almanac's handshake with everyone else's calendar. Pure
// functions, no IO, generated and parsed entirely ON-DEVICE: nothing here
// talks to a server, so the interop costs nothing in privacy.
//
// Two directions:
//   toICS      — one happening (or a whole calendar) as an .ics file, so the
//                friends who live in Google/Apple/Proton Calendar can add a
//                plan with one tap. Zero trade-off — the file is made locally
//                and handed to the person, never to a service.
//   parseICS   — the way IN: port a shared Google or Apple calendar here.
//                Both export standard .ics; we read VEVENTs tolerantly and
//                report honestly what we couldn't carry (recurring events
//                aren't unrolled — clone is the only recurrence Almanac has).

export type IcsEvent = {
  title: string;
  startsAt: number;
  endsAt?: number;
  allDay?: boolean; // optional so a Happening satisfies this shape directly
  place?: string;
  note?: string;
  link?: string;
};

// ---- export ----------------------------------------------------------------

// RFC 5545 wants CRLF line endings and escaped text values.
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Local wall-clock ("floating") time: 20260821T193000. Deliberately no TZID
// and no UTC suffix — a show at 7:30 is at 7:30 wherever the phone that reads
// it thinks it is, which is right for plans made among friends in one place
// and avoids shipping a timezone database.
function stampLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function stampDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// DTSTAMP is the one property the RFC requires in UTC.
function stampUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

const DAY = 86_400_000;

function veventLines(ev: IcsEvent, uid: string, now: number): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stampUtc(now)}`];
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${stampDate(ev.startsAt)}`);
    // DTEND on an all-day VEVENT is exclusive — the morning after the last day.
    lines.push(`DTEND;VALUE=DATE:${stampDate((ev.endsAt ?? ev.startsAt) + DAY)}`);
  } else {
    lines.push(`DTSTART:${stampLocal(ev.startsAt)}`);
    if (ev.endsAt) lines.push(`DTEND:${stampLocal(ev.endsAt)}`);
  }
  lines.push(`SUMMARY:${esc(ev.title)}`);
  if (ev.place) lines.push(`LOCATION:${esc(ev.place)}`);
  if (ev.note) lines.push(`DESCRIPTION:${esc(ev.note)}`);
  if (ev.link) lines.push(`URL:${esc(ev.link)}`);
  lines.push("END:VEVENT");
  return lines;
}

// One or many events as a complete VCALENDAR. `uidSeed` keeps UIDs stable per
// happening so re-adding the same file updates rather than duplicates.
export function toICS(events: Array<IcsEvent & { id: string }>, now: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Almanac//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const ev of events) lines.push(...veventLines(ev, `${ev.id}@almanac`, now));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---- import ----------------------------------------------------------------

export type IcsImport = {
  events: IcsEvent[];
  // Honesty about what didn't make it: recurring events (we don't unroll
  // RRULEs) and anything unparsable. Never silently dropped.
  skippedRecurring: number;
  skippedUnreadable: number;
  calendarName?: string; // X-WR-CALNAME, when the file carries one
};

// Undo RFC 5545 line folding (a CRLF followed by a space or tab continues the
// previous line) and text escaping.
function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unesc(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// DTSTART comes in three shapes: 20260821 (date), 20260821T193000 (floating
// local), 20260821T193000Z (UTC instant). Google exports UTC; Apple often
// exports TZID-qualified local times. TZID params we can't resolve are read
// as local wall-clock — for plans in your own circle that's almost always
// the same thing, and honest enough.
function parseStamp(value: string, isUtc: boolean): { ms: number; dateOnly: boolean } | null {
  const dateOnly = /^\d{8}$/.test(value);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, da, hh, mm, ss, z] = m;
  const utc = isUtc || z === "Z";
  const ms = utc
    ? Date.UTC(Number(y), Number(mo) - 1, Number(da), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0))
    : new Date(Number(y), Number(mo) - 1, Number(da), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0)).getTime();
  return { ms, dateOnly };
}

export function parseICS(text: string): IcsImport {
  const out: IcsImport = { events: [], skippedRecurring: 0, skippedUnreadable: 0 };
  let inEvent = false;
  let cur: Record<string, { value: string; params: string }> = {};

  const finish = () => {
    const dtstart = cur["DTSTART"];
    const summary = cur["SUMMARY"];
    if (cur["RRULE"] || cur["RDATE"]) {
      out.skippedRecurring++;
      return;
    }
    if (!dtstart) {
      out.skippedUnreadable++;
      return;
    }
    const start = parseStamp(dtstart.value, /TZID=UTC/i.test(dtstart.params));
    if (!start) {
      out.skippedUnreadable++;
      return;
    }
    const allDay = start.dateOnly || /VALUE=DATE\b/i.test(dtstart.params);
    let endsAt: number | undefined;
    const dtend = cur["DTEND"];
    if (dtend) {
      const end = parseStamp(dtend.value, /TZID=UTC/i.test(dtend.params));
      if (end) {
        // All-day DTEND is exclusive; bring it back to the last actual day.
        endsAt = allDay ? end.ms - DAY : end.ms;
        if (endsAt <= start.ms) endsAt = undefined;
      }
    }
    out.events.push({
      title: unesc(summary?.value ?? "").trim() || "Untitled",
      startsAt: start.ms,
      endsAt,
      allDay,
      place: unesc(cur["LOCATION"]?.value ?? "").trim() || undefined,
      note: unesc(cur["DESCRIPTION"]?.value ?? "").trim() || undefined,
      link: cur["URL"]?.value.trim() || undefined,
    });
  };

  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT/i.test(line)) {
      inEvent = true;
      cur = {};
      continue;
    }
    if (/^END:VEVENT/i.test(line)) {
      if (inEvent) finish();
      inEvent = false;
      continue;
    }
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const [, name, params, value] = m;
    const key = name.toUpperCase();
    if (!inEvent) {
      if (key === "X-WR-CALNAME") out.calendarName = unesc(value).trim() || undefined;
      continue;
    }
    // First occurrence wins — good enough for the properties we read.
    if (!cur[key]) cur[key] = { value, params };
  }
  return out;
}
