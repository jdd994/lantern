// ambient.ts — the vibe engine's brain: fuse an ambient reading with the time of
// day into a chosen vibe, and say *why*. Pure and IO-free (unit-tested), so the same
// function serves a simulated reading (the testing layer) and, later, a real mic.
//
// Design principles the user asked for:
//  • Fuse multiple signals, weighted — the same music reads "calm" at 3pm and
//    "wind-down" at 11pm. Time of day sets the frame; the room's sound dials it in.
//  • Legible, never a black box — every decision carries a plain-language reason.
//  • The family's calm soul caps the result: a lively room late at night nudges
//    warmer, it doesn't blast daylight.
import { vibeById } from "@lantern/core";

export type AmbientKind = "music" | "nature" | "speech" | "quiet";
export type AmbientTone = "warm" | "neutral" | "bright"; // spectral character

export type AmbientReading = {
  level: number; // 0..1 loudness
  energy: number; // 0..1 liveliness / how dynamic
  tone: AmbientTone;
  kind?: AmbientKind; // optional classification (the sim provides it; a mic may not)
};

export type AmbientContext = { hour: number }; // 0..23 local hour

export type Daypart = "late" | "morning" | "day" | "evening" | "night";
export type VibeDecision = { vibeId: string; reason: string; confidence: number };

// Warm/dim → bright/lively. Shifting along this ladder is how the reading "dials in"
// the daypart's base vibe. Ids match @lantern/core VIBES.
const LADDER = ["candlelight", "wind-down", "calm", "sunset", "focus", "daylight"] as const;

export function daypart(hour: number): Daypart {
  if (hour >= 23 || hour < 5) return "late";
  if (hour < 8) return "morning";
  if (hour < 17) return "day";
  if (hour < 21) return "evening";
  return "night";
}

// Each daypart: where on the ladder it starts, how far up it may go (the calm cap),
// and how to say it.
const BASE: Record<Daypart, { idx: number; ceiling: number; time: string }> = {
  late: { idx: 0, ceiling: 2, time: "late at night" },
  morning: { idx: 2, ceiling: 5, time: "in the morning" },
  day: { idx: 5, ceiling: 5, time: "during the day" },
  evening: { idx: 2, ceiling: 3, time: "in the evening" },
  night: { idx: 1, ceiling: 2, time: "at night" },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (i: number, hi: number) => Math.max(0, Math.min(hi, i));

export function decideVibe(r: AmbientReading, ctx: AmbientContext): VibeDecision {
  const dp = daypart(ctx.hour);
  const b = BASE[dp];
  let idx = b.idx;

  const quiet = r.level < 0.12;
  const lively = r.energy >= 0.6 || (r.kind === "music" && r.level >= 0.45);

  // Describe what we heard (drives the reason string).
  let heard = "a calm room";
  if (quiet) heard = "a quiet room";
  else if (r.kind === "nature") heard = "nature sounds";
  else if (r.kind === "music") heard = lively ? "lively music" : "soft music";
  else if (r.kind === "speech") heard = "voices";
  else if (lively) heard = "a lively room";

  // Fuse: nudge along the ladder.
  if (quiet) idx -= 1;
  else if (lively) idx += 2;
  else if (r.energy >= 0.4) idx += 1;
  if (r.tone === "bright") idx += 1;
  // Birdsong by day/morning wants real daylight, whatever the loudness.
  if (r.kind === "nature" && (dp === "morning" || dp === "day")) idx = 5;

  idx = clamp(idx, b.ceiling);
  const vibeId = LADDER[idx];
  const label = vibeById(vibeId)?.label ?? vibeId;

  let confidence = 0.55;
  if (r.kind) confidence += 0.15;
  if (quiet || lively) confidence += 0.15;
  confidence = Math.min(0.95, confidence);

  return { vibeId, reason: `${cap(heard)} ${b.time} → ${label}`, confidence };
}
