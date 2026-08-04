// time.test.ts — pins the en-locale renderings (the test runner's locale).
// The point of these helpers is that OTHER locales come out right too, via
// Intl — that part is the platform's promise, not ours to re-test.

import { describe, it, expect } from "vitest";
import { relativeLabel, namedDay } from "./time";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("relativeLabel", () => {
  const now = new Date(2026, 6, 15, 12, 0, 0).getTime();

  it("says now, minutes, hours, days — words from Intl", () => {
    expect(relativeLabel(now - 5_000, { now })).toBe("now");
    expect(relativeLabel(now - 5 * MIN, { now })).toBe("5 minutes ago");
    expect(relativeLabel(now - 1 * MIN, { now })).toBe("1 minute ago");
    expect(relativeLabel(now - 3 * HOUR, { now })).toBe("3 hours ago");
    expect(relativeLabel(now - 2 * DAY, { now })).toBe("2 days ago");
  });

  it("falls back to a short date past maxDays", () => {
    const label = relativeLabel(now - 40 * DAY, { now });
    expect(label).toMatch(/Jun/);
    const tight = relativeLabel(now - 2 * DAY, { now, maxDays: 1 });
    expect(tight).toMatch(/Jul/);
  });

  it("never says 'in …' for clock skew", () => {
    expect(relativeLabel(now + 5 * MIN, { now })).toBe("now");
  });
});

describe("namedDay", () => {
  const now = new Date(2026, 6, 15, 12, 0, 0).getTime();

  it("names today and yesterday, capitalized, and nothing else", () => {
    expect(namedDay(now - 1 * HOUR, now)).toBe("Today");
    // Early morning still counts as today; last night is yesterday.
    expect(namedDay(new Date(2026, 6, 15, 0, 30).getTime(), now)).toBe("Today");
    expect(namedDay(new Date(2026, 6, 14, 23, 30).getTime(), now)).toBe("Yesterday");
    expect(namedDay(new Date(2026, 6, 13, 23, 30).getTime(), now)).toBe(null);
  });
});
