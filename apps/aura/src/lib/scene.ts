// scene.ts — turn a typed description ("getting ready for bed", "cozy movie
// night", "doing yoga outside after dark") into a vibe. A small, local, scored
// word-association matcher: no network, no account, works offline, and returns
// the same VibeDecision shape ambient.ts already renders — so the UI needed no
// new rendering path, only a new way to produce one.
//
// THE SEAM: this is deliberately the one function anything smarter would
// replace. An on-device AI model (a browser's own built-in model, or a small
// bundled one) could understand phrasing this word list never anticipated —
// "a quiet library on a rainy afternoon" — without any network call and
// without this file's callers changing at all: same input (a description),
// same output (a VibeDecision or null). Not built because nothing on-device
// is both broadly available and good enough yet (see the chat that led here);
// when that changes, it plugs in right here.
import { vibeById } from "@lantern/core";
import type { VibeDecision } from "./ambient";

// Longer, more specific phrases carry more signal than a lone generic word —
// scored by word count, so "night yoga" or "getting ready for bed" outweighs
// a bare "yoga" or "bed" that could belong to more than one vibe.
const ASSOCIATIONS: Record<string, string[]> = {
  candlelight: [
    "candlelight", "candle", "candles", "flame", "flicker", "romantic",
    "date night", "intimate dinner", "fireplace", "by the fire", "moody light",
  ],
  calm: [
    "calm", "relax", "relaxing", "unwind", "peaceful", "soft light", "gentle",
    "chill evening", "quiet evening", "lounging", "resting", "cozy",
  ],
  sunset: [
    "sunset", "golden hour", "dusk", "warm evening", "amber glow",
    "summer evening", "evening on the porch", "evening on the patio",
  ],
  focus: [
    "focus", "work", "working", "study", "studying", "productive", "concentrate",
    "deep work", "at my desk", "homework", "getting things done",
  ],
  daylight: [
    "daylight", "bright", "morning", "waking up", "wake up", "energize",
    "energizing", "fresh start", "sunny morning", "clear and bright",
  ],
  "wind-down": [
    "wind down", "winding down", "evening routine", "getting sleepy",
    "settling down for the night", "relaxing before bed", "easing into the evening",
  ],
  night: [
    "sleep", "sleeping", "bedtime", "lights out", "going to sleep",
    "middle of the night", "no blue light", "getting ready for bed",
  ],
  yoga: [
    "yoga", "meditate", "meditation", "stretch", "stretching", "breathing",
    "mindfulness", "practice", "namaste", "asana",
  ],
  "night-yoga": [
    "night yoga", "evening yoga", "yoga after dark", "yoga at night",
    "moonlight yoga", "yoga under the stars", "late night yoga",
  ],
};

function score(text: string, phrases: string[]): number {
  let total = 0;
  for (const phrase of phrases) if (text.includes(phrase)) total += phrase.split(" ").length;
  return total;
}

// "Yoga" plus any after-dark cue reads as night-yoga even without the exact
// compound phrase ("yoga outside after dark" has a word between "yoga" and
// "after dark" that a plain substring match misses). These cue words aren't in
// night-yoga's own list because several belong to other vibes too ("night" is
// also in the Night vibe's own phrases) — this only fires alongside an actual
// yoga mention, so it never cross-contaminates an unrelated "night" sentence.
const NIGHT_CUES = ["dark", "night", "evening", "moonlight", "late", "dusk"];

// Returns null when nothing in the description resembles a known vibe — an
// honest "couldn't tell", never a guess dressed up as a decision.
export function describeScene(description: string): VibeDecision | null {
  const text = description.trim().toLowerCase();
  if (!text) return null;

  const scores: Record<string, number> = {};
  for (const [vibeId, phrases] of Object.entries(ASSOCIATIONS)) {
    const s = score(text, phrases);
    if (s > 0) scores[vibeId] = s;
  }
  if (scores.yoga && NIGHT_CUES.some((w) => text.includes(w))) {
    scores["night-yoga"] = (scores["night-yoga"] ?? 0) + scores.yoga + 1;
  }

  let best: { vibeId: string; score: number } | null = null;
  for (const [vibeId, s] of Object.entries(scores)) {
    if (!best || s > best.score) best = { vibeId, score: s };
  }
  if (!best) return null;

  const label = vibeById(best.vibeId)?.label ?? best.vibeId;
  return {
    vibeId: best.vibeId,
    reason: `"${description.trim()}" sounds like ${label} to me.`,
    confidence: Math.min(1, 0.5 + best.score * 0.15),
  };
}
