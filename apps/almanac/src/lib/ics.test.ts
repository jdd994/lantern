import { describe, expect, it } from "vitest";
import { parseICS, toICS } from "./ics";

const AUG21_1930 = new Date(2026, 7, 21, 19, 30).getTime();
const AUG21_2230 = new Date(2026, 7, 21, 22, 30).getTime();

describe("toICS", () => {
  it("writes a complete VCALENDAR with escaped text and stable UIDs", () => {
    const ics = toICS(
      [{
        id: "abc", title: "Show; with, chars", startsAt: AUG21_1930, endsAt: AUG21_2230,
        allDay: false, place: "First Ave", note: "line one\nline two",
      }],
      Date.UTC(2026, 7, 1)
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:abc@almanac");
    expect(ics).toContain("DTSTAMP:20260801T000000Z");
    expect(ics).toContain("DTSTART:20260821T193000");
    expect(ics).toContain("DTEND:20260821T223000");
    expect(ics).toContain("SUMMARY:Show\\; with\\, chars");
    expect(ics).toContain("DESCRIPTION:line one\\nline two");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("writes all-day events as VALUE=DATE with exclusive DTEND", () => {
    const ics = toICS(
      [{ id: "d", title: "Fair", startsAt: new Date(2026, 8, 3).getTime(), allDay: true }],
      0
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260903");
    expect(ics).toContain("DTEND;VALUE=DATE:20260904");
  });
});

describe("parseICS", () => {
  it("round-trips its own export", () => {
    const ics = toICS(
      [{ id: "abc", title: "Show", startsAt: AUG21_1930, endsAt: AUG21_2230, allDay: false, place: "First Ave" }],
      0
    );
    const got = parseICS(ics);
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toMatchObject({
      title: "Show", startsAt: AUG21_1930, endsAt: AUG21_2230, allDay: false, place: "First Ave",
    });
  });

  it("reads a Google-style export: UTC stamps, folded lines, CALNAME", () => {
    const utcStart = Date.UTC(2026, 7, 22, 0, 30); // == some local evening; exactness is what matters
    const ics = [
      "BEGIN:VCALENDAR",
      "X-WR-CALNAME:Chicago crew",
      "BEGIN:VEVENT",
      "UID:x1@google.com",
      "DTSTART:20260822T003000Z",
      // Folded per RFC 5545: CRLF + one space is removed on unfold, so the
      // second space here is real content.
      "SUMMARY:A show with a very long name that Google",
      "  folds onto a second line",
      "LOCATION:Thalia Hall\\, Chicago",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const got = parseICS(ics);
    expect(got.calendarName).toBe("Chicago crew");
    expect(got.events).toHaveLength(1);
    expect(got.events[0].title).toBe("A show with a very long name that Google folds onto a second line");
    expect(got.events[0].startsAt).toBe(utcStart);
    expect(got.events[0].place).toBe("Thalia Hall, Chicago");
  });

  it("reads Apple-style TZID local times as wall-clock and all-day DATE values", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/Chicago:20260821T193000",
      "SUMMARY:Show",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260903",
      "DTEND;VALUE=DATE:20260905",
      "SUMMARY:Two fair days",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const got = parseICS(ics);
    expect(got.events[0].startsAt).toBe(AUG21_1930); // wall-clock, this machine's zone
    expect(got.events[1].allDay).toBe(true);
    // exclusive DTEND pulled back to the last actual day
    expect(new Date(got.events[1].endsAt!).getDate()).toBe(4);
  });

  it("counts recurring and unreadable events honestly instead of dropping them", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART:20260821T193000",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Weekly thing",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:No date at all",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20260821T193000",
      "SUMMARY:Keeper",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const got = parseICS(ics);
    expect(got.events.map((e) => e.title)).toEqual(["Keeper"]);
    expect(got.skippedRecurring).toBe(1);
    expect(got.skippedUnreadable).toBe(1);
  });

  it("returns empty for junk without crashing", () => {
    const got = parseICS("not an ics file at all");
    expect(got.events).toEqual([]);
  });
});
