// automations.ts — pure automation logic (no IO, unit-tested). An automation is
// "when <trigger>, do <action>". Triggers are a clock time or a sun event
// (sunrise/sunset ± offset). Evaluation is a pure function of (list, now, coords),
// so the scheduler in the hook stays a thin timer around it.
//
// Honest limitation baked into the design: firing only happens while something is
// running the scheduler (the app open, or later a Tauri background process). So we
// fire inside a short GRACE window after the trigger time rather than "catching up"
// hours later when you reopen the app — a light shouldn't lurch at a random moment.
import { sunTime } from "./sun";

export type Coords = { lat: number; lon: number };

export type Trigger =
  | { kind: "time"; minutes: number } // minutes since local midnight
  | { kind: "sun"; event: "sunrise" | "sunset"; offsetMin: number };

export type Action =
  | { kind: "scene"; sceneId: string }
  | { kind: "roomPower"; roomId: string; on: boolean }
  | { kind: "allOff" };

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  action: Action;
  lastRun?: string; // "YYYY-MM-DD" (local) — once-per-day dedupe
};

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The absolute Date this automation fires on the given local calendar day, or null
// (sun trigger with no coords, or a polar day with no sunrise/sunset).
export function fireTimeOn(a: Automation, day: Date, coords: Coords | null): Date | null {
  if (a.trigger.kind === "time") {
    const t = new Date(day);
    t.setHours(0, a.trigger.minutes, 0, 0);
    return t;
  }
  if (!coords) return null;
  const base = sunTime(day, coords.lat, coords.lon, a.trigger.event);
  return base ? new Date(base.getTime() + a.trigger.offsetMin * 60_000) : null;
}

// Automations due to fire right now: enabled, not already run today, and `now` sits
// within [fireTime, fireTime + grace].
export function dueAutomations(
  list: Automation[],
  now: Date,
  coords: Coords | null,
  graceMinutes = 5
): Automation[] {
  const today = ymd(now);
  const graceMs = graceMinutes * 60_000;
  return list.filter((a) => {
    if (!a.enabled || a.lastRun === today) return false;
    const fire = fireTimeOn(a, now, coords);
    if (!fire) return false;
    const delta = now.getTime() - fire.getTime();
    return delta >= 0 && delta <= graceMs;
  });
}

// The next time this automation will fire (today if still ahead, else tomorrow) —
// for display. null if it can't be computed (sun trigger without coords).
export function nextFire(a: Automation, now: Date, coords: Coords | null): Date | null {
  const todayFire = fireTimeOn(a, now, coords);
  if (todayFire && todayFire.getTime() > now.getTime()) return todayFire;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return fireTimeOn(a, tomorrow, coords);
}
