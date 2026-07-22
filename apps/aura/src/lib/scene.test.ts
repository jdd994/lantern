import { describe, expect, it } from "vitest";
import { describeScene } from "./scene";

describe("describeScene", () => {
  it("returns null for an empty or blank description — an honest 'couldn't tell'", () => {
    expect(describeScene("")).toBeNull();
    expect(describeScene("   ")).toBeNull();
  });

  it("returns null when nothing recognizable is in the text", () => {
    expect(describeScene("purple elephants dancing on the moon")).toBeNull();
  });

  it("matches a clear single-word cue", () => {
    expect(describeScene("yoga")?.vibeId).toBe("yoga");
    expect(describeScene("I need to focus")?.vibeId).toBe("focus");
  });

  it("prefers night-yoga over plain yoga when night cues are present", () => {
    expect(describeScene("doing yoga after dark")?.vibeId).toBe("night-yoga");
    expect(describeScene("night yoga in the backyard")?.vibeId).toBe("night-yoga");
    // A word between "yoga" and the night cue still resolves to night-yoga —
    // real phrasing doesn't always line up into one of the exact listed phrases.
    expect(describeScene("doing yoga outside after dark")?.vibeId).toBe("night-yoga");
  });

  it("doesn't let a bare 'night' elsewhere in the sentence pull an unrelated vibe toward night-yoga", () => {
    // No "yoga" mention at all — the co-occurrence rule must not fire.
    expect(describeScene("middle of the night, can't sleep")?.vibeId).toBe("night");
  });

  it("keeps plain yoga plain when there's no night cue", () => {
    expect(describeScene("time for my yoga practice")?.vibeId).toBe("yoga");
  });

  it("maps bedtime phrasing to night, not wind-down", () => {
    expect(describeScene("getting ready for bed")?.vibeId).toBe("night");
  });

  it("is case-insensitive and tolerant of surrounding text", () => {
    expect(describeScene("CANDLELIGHT dinner for two")?.vibeId).toBe("candlelight");
  });

  it("gives a higher confidence to a longer, more specific phrase match", () => {
    const specific = describeScene("getting ready for bed");
    const generic = describeScene("sleeping");
    expect(specific?.confidence ?? 0).toBeGreaterThan(generic?.confidence ?? 0);
  });

  it("names the matched vibe by its real label in the reason", () => {
    expect(describeScene("morning energy")?.reason).toContain("Daylight");
  });
});
