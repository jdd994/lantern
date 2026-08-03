// Home.tsx — the front page of the book: everything coming, soonest first,
// under month headings, across every calendar you keep. Below it, the
// calendars themselves. Recency and dates do the ordering — never counts,
// never a "busy score", and an empty month is a month at peace, not a gap
// to fill.

import { allComing, formatWhen, groupByMonth, whoIsIn, type Calendar, type Happening, type Mark } from "../lib/model";
import type { SharedCalendar } from "../hooks/useAlmanac";

function shortName(email: string): string {
  return email.split("@")[0] || email;
}

export function Home({
  calendars,
  happenings,
  marks,
  shared,
  now,
  onOpen,
  onOpenHappening,
  onNew,
}: {
  calendars: Calendar[];
  happenings: Happening[];
  marks: Mark[];
  shared: Record<string, SharedCalendar>;
  now: number;
  onOpen: (id: string) => void;
  onOpenHappening: (calendarId: string) => void;
  onNew: () => void;
}) {
  if (calendars.length === 0) {
    return (
      <div className="empty">
        <p>
          Nothing in the almanac yet. Start a calendar for your circle — the shows you're going
          to, the gatherings ahead — and invite the people going with you.
        </p>
        <button className="btn btn-primary" onClick={onNew}>Start a calendar</button>
      </div>
    );
  }

  const calTitle = new Map(calendars.map((c) => [c.id, c.title || "Untitled calendar"]));
  const coming = allComing(happenings, now).filter((h) => calTitle.has(h.calendarId));
  const months = groupByMonth(coming);
  const sorted = [...calendars].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Coming up</h2>
        </div>
        {coming.length === 0 ? (
          <p className="hint">Nothing on the horizon. The almanac waits — add something when a plan takes shape.</p>
        ) : (
          months.map((m) => (
            <div key={m.label}>
              <h3 className="month-head">{m.label}</h3>
              {m.items.map((h) => {
                const who = whoIsIn(h.id, marks);
                return (
                  <button type="button" key={h.id} className="hap-row" onClick={() => onOpenHappening(h.calendarId)}>
                    <span className="hap-when">{formatWhen(h)}</span>
                    <span className="hap-main">
                      <span className="hap-title">{h.title || "Untitled"}</span>
                      <span className="hap-meta">
                        {calendars.length > 1 ? <span className="hap-cal">{calTitle.get(h.calendarId)}</span> : null}
                        {who.length ? <span className="hap-who">{who.map(shortName).join(", ")}</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Calendars</h2>
          <button className="btn btn-sm" onClick={onNew}>New calendar</button>
        </div>
        {sorted.map((c) => (
          <button type="button" key={c.id} className="cal-row" onClick={() => onOpen(c.id)}>
            <span className="cal-title">{c.title || "Untitled calendar"}</span>
            {shared[c.id] ? <span className="badge">shared</span> : null}
          </button>
        ))}
      </section>
    </>
  );
}
