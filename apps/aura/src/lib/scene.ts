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
// a bare "yoga" or "bed" that could belong to more than one vibe. Deliberately
// generous lists (real phrasing varies a lot more than a first pass expects) —
// grow this by adding phrases people actually type, not by getting clever
// about matching.
const ASSOCIATIONS: Record<string, string[]> = {
  candlelight: [
    "candlelight", "candle", "candles", "flame", "flicker", "flickering",
    "fireplace", "by the fire", "fire crackling", "wax", "lantern light",
    "glow of a candle", "moody light", "dim and flickering", "single flame",
  ],
  calm: [
    "calm", "relax", "relaxing", "unwind", "unwinding", "peaceful",
    "peace and quiet", "soft light", "gentle", "chill evening", "quiet evening",
    "lounging", "resting", "cozy", "mellow", "taking it easy", "low-key",
    "laid back", "settle in", "settling in", "just breathe",
  ],
  sunset: [
    "sunset", "golden hour", "dusk", "warm evening", "amber glow",
    "summer evening", "evening on the porch", "evening on the patio",
    "watching the sunset", "sky turning orange", "evening light", "orange sky",
    "warm dusk",
  ],
  focus: [
    "focus", "work", "working", "study", "studying", "productive", "concentrate",
    "concentrating", "deep work", "at my desk", "homework", "getting things done",
    "need to focus", "buckle down", "crunch time", "writing", "coding",
    "on a deadline",
  ],
  daylight: [
    "daylight", "bright", "energize", "energizing", "fresh start",
    "clear and bright", "sunny day", "midday", "full sun", "broad daylight",
    "wide awake",
  ],
  morning: [
    "morning", "waking up", "wake up", "sunny morning", "early morning",
    "start the day", "crisp morning", "first thing in the morning",
    "morning coffee", "rise and shine", "breakfast time",
  ],
  reading: [
    "reading", "read a book", "book club", "curled up with a book",
    "quiet reading", "novel", "page-turner", "settling in with a book",
    "reading nook", "bedtime story",
  ],
  "wind-down": [
    "wind down", "winding down", "evening routine", "getting sleepy",
    "settling down for the night", "relaxing before bed", "easing into the evening",
    "slowing down", "end of the day", "unwinding before bed",
  ],
  romantic: [
    "romantic", "date night", "intimate dinner", "anniversary", "candlelit dinner",
    "just the two of us", "valentine's", "romance", "love is in the air",
    "cozy date",
  ],
  dinner: [
    "dinner", "dinner party", "having people for dinner", "dinner table",
    "family dinner", "sit-down dinner", "eating together", "meal with friends",
    "hosting dinner",
  ],
  gathering: [
    "gathering", "having people over", "hosting", "party", "friends over",
    "get-together", "guests coming over", "company's coming", "small gathering",
    "house full of people",
  ],
  night: [
    "sleep", "sleeping", "bedtime", "lights out", "going to sleep",
    "middle of the night", "no blue light", "getting ready for bed", "insomnia",
    "can't sleep", "tucking in", "nightlight", "red light before bed",
  ],
  yoga: [
    "yoga", "meditate", "meditation", "stretch", "stretching", "breathing",
    "mindfulness", "practice", "namaste", "asana", "savasana", "on the mat",
    "morning stretch", "deep breaths",
  ],
  "night-yoga": [
    "night yoga", "evening yoga", "yoga after dark", "yoga at night",
    "moonlight yoga", "yoga under the stars", "late night yoga",
    "evening stretch", "yoga outside at dusk",
  ],
  "movie-night": [
    "movie night", "watching a movie", "movie", "film night", "screen time",
    "tv night", "popcorn and a movie", "streaming something", "cinema at home",
    "binge watching",
  ],
  storm: [
    "storm", "stormy", "thunderstorm", "rolling in", "bad weather", "lightning",
    "thunder", "dark clouds", "weather turning", "wind picking up",
  ],
  "rainy-day": [
    "rainy day", "raining", "rain", "overcast", "grey day", "gray day",
    "cloudy", "drizzle", "drizzling", "rain outside", "sound of rain", "puddles",
  ],
};

// Word-boundary matches, not raw substrings — "cat" shouldn't match inside
// "cathedral". Precompiled once at module load, not per keystroke.
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED: Record<string, { phrase: string; re: RegExp }[]> = Object.fromEntries(
  Object.entries(ASSOCIATIONS).map(([vibeId, phrases]) => [
    vibeId,
    phrases.map((phrase) => ({ phrase, re: new RegExp(`\\b${escapeRegExp(phrase)}\\b`) })),
  ])
);

function score(text: string, compiled: { phrase: string; re: RegExp }[]): number {
  let total = 0;
  for (const { phrase, re } of compiled) if (re.test(text)) total += phrase.split(" ").length;
  return total;
}

// "Yoga" plus any after-dark cue reads as night-yoga even without the exact
// compound phrase ("yoga outside after dark" has a word between "yoga" and
// "after dark" that a plain substring match misses). These cue words aren't in
// night-yoga's own list because several belong to other vibes too ("night" is
// also in the Night vibe's own phrases) — this only fires alongside an actual
// yoga mention, so it never cross-contaminates an unrelated "night" sentence.
const NIGHT_CUES = ["dark", "night", "evening", "moonlight", "late", "dusk"].map(
  (w) => new RegExp(`\\b${w}\\b`)
);

// Returns null when nothing in the description resembles a known vibe — an
// honest "couldn't tell", never a guess dressed up as a decision.
export function describeScene(description: string): VibeDecision | null {
  const text = description.trim().toLowerCase();
  if (!text) return null;

  const scores: Record<string, number> = {};
  for (const [vibeId, compiled] of Object.entries(COMPILED)) {
    const s = score(text, compiled);
    if (s > 0) scores[vibeId] = s;
  }
  if (scores.yoga && NIGHT_CUES.some((re) => re.test(text))) {
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
