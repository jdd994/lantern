import { describe, expect, it } from "vitest";
import {
  allComing, decodeCalendar, decodeHappening, decodeMark, decodeProfile,
  displayName, effectiveEnd, encodeCalendar, encodeHappening, encodeMark,
  encodeProfile, formatStamp, fromMarkdown, groupByMonth, myMarks,
  shortName, splitAgenda, toMarkdown, whoIsIn,
  type Calendar, type Happening, type Mark, type Profile,
} from "./model";

const shell = { id: "x", createdAt: 1, updatedAt: 2 };

// Fixed local times, built with the Date ctor so tests hold in any timezone.
const AUG21_1930 = new Date(2026, 7, 21, 19, 30).getTime();
const AUG21_2359 = new Date(2026, 7, 21, 23, 59).getTime();
const AUG22_0001 = new Date(2026, 7, 22, 0, 1).getTime();
const SEP03_1200 = new Date(2026, 8, 3, 12, 0).getTime();

function hap(over: Partial<Happening>): Happening {
  return {
    id: "h1", calendarId: "c1", title: "Show at First Ave",
    startsAt: AUG21_1930, createdAt: 1, updatedAt: 1, ...over,
  };
}

function mark(over: Partial<Mark>): Mark {
  return { id: "m1", happeningId: "h1", who: "sam@example.com", createdAt: 1, updatedAt: 1, ...over };
}

describe("encode/decode", () => {
  it("round-trips a calendar and strips bookkeeping from the payload", () => {
    const c: Calendar = { id: "c1", title: "Chicago crew", note: "shows & shenanigans", createdAt: 1, updatedAt: 2 };
    const payload = encodeCalendar(c);
    expect(payload).not.toContain('"id"');
    expect(decodeCalendar(payload, shell)).toEqual({ ...shell, title: "Chicago crew", note: "shows & shenanigans", author: undefined });
  });

  it("round-trips a happening, calendarId inside the ciphertext", () => {
    const h = hap({ endsAt: AUG21_2359, place: "First Ave", link: "https://tickets.example", note: "doors 7" });
    const got = decodeHappening(encodeHappening(h), shell);
    expect(got.calendarId).toBe("c1");
    expect(got.title).toBe("Show at First Ave");
    expect(got.startsAt).toBe(AUG21_1930);
    expect(got.endsAt).toBe(AUG21_2359);
    expect(got.place).toBe("First Ave");
    expect(got.link).toBe("https://tickets.example");
  });

  it("round-trips a mark", () => {
    const got = decodeMark(encodeMark(mark({})), shell);
    expect(got.happeningId).toBe("h1");
    expect(got.who).toBe("sam@example.com");
  });

  it("is defensive: garbage in, empty-but-valid out", () => {
    expect(decodeCalendar("not json", shell).title).toBe("");
    expect(decodeHappening('{"__almanac":1,"t":"calendar"}', shell).title).toBe("");
    // an unreadable startsAt falls back to the shell's createdAt, never NaN
    expect(decodeHappening('{"__almanac":1,"t":"happening","startsAt":"noon"}', shell).startsAt).toBe(1);
  });
});

describe("effectiveEnd", () => {
  it("keeps tonight's show on the agenda until midnight", () => {
    const h = hap({});
    expect(effectiveEnd(h)).toBeGreaterThan(AUG21_2359);
    expect(effectiveEnd(h)).toBeLessThanOrEqual(AUG22_0001);
  });

  it("uses the last day of a multi-day happening", () => {
    const h = hap({ endsAt: SEP03_1200 });
    expect(effectiveEnd(h)).toBeGreaterThan(SEP03_1200);
  });
});

describe("splitAgenda", () => {
  it("splits coming (soonest first) from the wake (most recent first)", () => {
    const past1 = hap({ id: "p1", startsAt: new Date(2026, 5, 1).getTime() });
    const past2 = hap({ id: "p2", startsAt: new Date(2026, 6, 1).getTime() });
    const soon = hap({ id: "s", startsAt: AUG21_1930 });
    const later = hap({ id: "l", startsAt: SEP03_1200 });
    const otherCal = hap({ id: "o", calendarId: "c2" });
    const now = new Date(2026, 7, 10).getTime();
    const { coming, wake } = splitAgenda("c1", [later, past1, soon, past2, otherCal], now);
    expect(coming.map((h) => h.id)).toEqual(["s", "l"]);
    expect(wake.map((h) => h.id)).toEqual(["p2", "p1"]);
  });

  it("still counts tonight's earlier show as coming", () => {
    const tonight = hap({ startsAt: AUG21_1930 });
    const { coming, wake } = splitAgenda("c1", [tonight], AUG21_2359);
    expect(coming).toHaveLength(1);
    expect(wake).toHaveLength(0);
  });
});

describe("allComing / groupByMonth", () => {
  it("orders the front page across calendars and groups by month", () => {
    const a = hap({ id: "a", startsAt: AUG21_1930 });
    const b = hap({ id: "b", calendarId: "c2", startsAt: SEP03_1200 });
    const now = new Date(2026, 7, 1).getTime();
    const run = allComing([b, a], now);
    expect(run.map((h) => h.id)).toEqual(["a", "b"]);
    const groups = groupByMonth(run);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toMatch(/August/);
    expect(groups[1].label).toMatch(/September/);
  });
});

describe("whoIsIn / myMarks", () => {
  it("lists names in volunteering order, deduped, never a count", () => {
    const marks = [
      mark({ id: "m2", who: "ada@example.com", createdAt: 5 }),
      mark({ id: "m1", who: "sam@example.com", createdAt: 2 }),
      // sam again from a second device — one entry, earliest tap wins
      mark({ id: "m3", who: "sam@example.com", createdAt: 9 }),
      mark({ id: "m4", happeningId: "other", who: "zoe@example.com" }),
    ];
    expect(whoIsIn("h1", marks)).toEqual(["sam@example.com", "ada@example.com"]);
    expect(myMarks("h1", "sam@example.com", marks).map((m) => m.id)).toEqual(["m1", "m3"]);
  });
});

describe("profiles & names", () => {
  const prof = (over: Partial<Profile>): Profile => ({
    id: "p1", who: "sam@example.com", name: "Sam", createdAt: 1, updatedAt: 1, ...over,
  });

  it("round-trips a profile", () => {
    const got = decodeProfile(encodeProfile(prof({})), shell);
    expect(got.who).toBe("sam@example.com");
    expect(got.name).toBe("Sam");
  });

  it("displayName prefers the freshest chosen name, falls back to the email stem", () => {
    const profiles = [
      prof({ id: "a", name: "Sam", updatedAt: 5 }),
      prof({ id: "b", name: "Sammy", updatedAt: 9 }), // second device, newer
      prof({ id: "c", who: "zoe@example.com", name: "  " }), // blank never counts
    ];
    expect(displayName("sam@example.com", profiles)).toBe("Sammy");
    expect(displayName("zoe@example.com", profiles)).toBe("zoe");
    expect(displayName("ada@example.com", [])).toBe("ada");
    expect(shortName("ada@example.com")).toBe("ada");
  });

  it("a cleared name falls back rather than showing empty", () => {
    expect(displayName("sam@example.com", [prof({ name: "" })])).toBe("sam");
  });
});

describe("markdown portability", () => {
  it("round-trips its own export", () => {
    const cals: Calendar[] = [{ id: "c1", title: "Chicago crew", note: "the plan", createdAt: 1, updatedAt: 1 }];
    const haps = [
      hap({ id: "a", place: "First Ave", note: "doors 7" }),
      hap({ id: "b", title: "State fair", startsAt: SEP03_1200, allDay: true }),
    ];
    const md = toMarkdown(cals, haps);
    const parsed = fromMarkdown(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Chicago crew");
    expect(parsed[0].note).toBe("the plan");
    expect(parsed[0].happenings).toHaveLength(2);
    const [first, second] = parsed[0].happenings;
    expect(first.title).toBe("Show at First Ave");
    expect(first.startsAt).toBe(AUG21_1930);
    expect(first.allDay).toBe(false);
    expect(first.place).toBe("First Ave");
    expect(first.note).toBe("doors 7");
    expect(second.title).toBe("State fair");
    expect(second.allDay).toBe(true);
    expect(new Date(second.startsAt).getDate()).toBe(3);
  });

  it("formatStamp writes local wall-clock, date-only when all day", () => {
    expect(formatStamp(hap({}))).toBe("2026-08-21 19:30");
    expect(formatStamp(hap({ allDay: true }))).toBe("2026-08-21");
  });

  it("reads hand-written files tolerantly and skips prose", () => {
    const parsed = fromMarkdown(
      "# Fall\n\nloose plans\n- 2026-10-31 — Halloween thing @ Emma's\nnot an event line\n\n## Empty one\n_(empty)_\n"
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].happenings).toEqual([
      { title: "Halloween thing", startsAt: new Date(2026, 9, 31).getTime(), allDay: true, place: "Emma's", note: undefined },
    ]);
    expect(parsed[1].happenings).toEqual([]);
  });

  it("returns nothing for prose without headings or events", () => {
    expect(fromMarkdown("just words\nmore words")).toEqual([]);
  });
});
