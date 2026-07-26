import { describe, expect, it } from "vitest";
import { VIBES } from "@lantern/core";
import { daypart, decideVibe, type AmbientReading } from "./ambient";

const reading = (over: Partial<AmbientReading> = {}): AmbientReading => ({
  level: 0.4,
  energy: 0.3,
  tone: "warm",
  ...over,
});

describe("daypart", () => {
  it("maps hours to parts of the day", () => {
    expect(daypart(2)).toBe("late");
    expect(daypart(6)).toBe("morning");
    expect(daypart(13)).toBe("day");
    expect(daypart(19)).toBe("evening");
    expect(daypart(22)).toBe("night");
  });
});

describe("decideVibe", () => {
  it("quiet at night → candlelight", () => {
    expect(decideVibe(reading({ level: 0.03, kind: "quiet" }), { hour: 22 }).vibeId).toBe("candlelight");
  });

  it("lively music in the evening → sunset", () => {
    const d = decideVibe(reading({ kind: "music", level: 0.8, energy: 0.85 }), { hour: 19 });
    expect(d.vibeId).toBe("sunset");
  });

  it("birdsong in the morning → daylight", () => {
    expect(decideVibe(reading({ kind: "nature", level: 0.35, energy: 0.3, tone: "bright" }), { hour: 7 }).vibeId).toBe(
      "daylight"
    );
  });

  it("same lively music reads calmer late at night than in the evening (the calm cap)", () => {
    const late = decideVibe(reading({ kind: "music", level: 0.8, energy: 0.85 }), { hour: 23 });
    const evening = decideVibe(reading({ kind: "music", level: 0.8, energy: 0.85 }), { hour: 19 });
    expect(late.vibeId).toBe("calm"); // capped, not daylight
    expect(evening.vibeId).toBe("sunset");
  });

  it("mellow music reads calmer than the same loudness/energy with no style read", () => {
    const plain = decideVibe(reading({ kind: "music", level: 0.5, energy: 0.5 }), { hour: 19 });
    const mellow = decideVibe(reading({ kind: "music", level: 0.5, energy: 0.5, musicStyle: "mellow" }), {
      hour: 19,
    });
    expect(plain.vibeId).toBe("sunset");
    expect(mellow.vibeId).toBe("calm");
    expect(mellow.reason).toContain("Mellow music");
  });

  it("energetic music reads livelier than the same loudness/energy with no style read", () => {
    const plain = decideVibe(reading({ kind: "music", level: 0.3, energy: 0.3 }), { hour: 19 });
    const energetic = decideVibe(reading({ kind: "music", level: 0.3, energy: 0.3, musicStyle: "energetic" }), {
      hour: 19,
    });
    expect(plain.vibeId).toBe("calm");
    expect(energetic.vibeId).toBe("sunset");
    expect(energetic.reason).toContain("Energetic music");
  });

  it("a null musicStyle (can't tell yet) behaves exactly like no style at all", () => {
    const noStyle = decideVibe(reading({ kind: "music", level: 0.5, energy: 0.5 }), { hour: 13 });
    const nullStyle = decideVibe(reading({ kind: "music", level: 0.5, energy: 0.5, musicStyle: null }), {
      hour: 13,
    });
    expect(nullStyle).toEqual(noStyle);
  });

  it("always returns a real vibe id and a bounded confidence, with a reason", () => {
    for (const hour of [2, 7, 13, 19, 22]) {
      for (const kind of ["music", "nature", "speech", "quiet", undefined] as const) {
        const d = decideVibe(reading({ kind, level: 0.5, energy: 0.5 }), { hour });
        expect(VIBES.some((v) => v.id === d.vibeId)).toBe(true);
        expect(d.confidence).toBeGreaterThan(0);
        expect(d.confidence).toBeLessThanOrEqual(1);
        expect(d.reason).toContain("→");
      }
    }
  });
});
