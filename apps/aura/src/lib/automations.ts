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
  | { kind: "sun"; event: "sunrise" | "sunset"; offsetMin: number }
  // Event-driven: fires the moment a sensor sees motion (not time-scheduled, so it
  // never appears in dueAutomations — the sensor poller drives it via sensorDue).
  | { kind: "sensor"; sensorId: string };

export type Action =
  | { kind: "scene"; sceneId: string }
  | { kind: "roomPower"; roomId: string; on: boolean }
  | { kind: "allOff" }
  // Gently ramp brightness to a target over some minutes (wake-up = fade up;
  // wind-down = fade to 0, which turns the lights off at the end). roomId omitted
  // means every light.
  | { kind: "fade"; roomId?: string; toBrightness: number; minutes: number };

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions?: Action[]; // one trigger can do several things
  action?: Action; // legacy single action (pre-multi); read via actionsOf
  days?: number[]; // weekdays it may fire on (0=Sun..6=Sat); empty/undefined = every day
  lastRun?: string; // "YYYY-MM-DD" (local) — once-per-day dedupe for timed triggers
  lastFiredAt?: number; // epoch ms — cooldown for sensor (event) triggers
};

// The actions to run, tolerant of the legacy single-action shape.
export function actionsOf(a: Automation): Action[] {
  return a.actions && a.actions.length ? a.actions : a.action ? [a.action] : [];
}

const allowedToday = (a: Automation, now: Date) => !a.days?.length || a.days.includes(now.getDay());

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
  if (a.trigger.kind !== "sun") return null; // sensor triggers aren't time-scheduled
  if (!coords) return null;
  const base = sunTime(day, coords.lat, coords.lon, a.trigger.event);
  return base ? new Date(base.getTime() + a.trigger.offsetMin * 60_000) : null;
}

// Automations to fire when `sensorId` sees motion: enabled, watching that sensor,
// allowed today, and past their cooldown (motion repeats — a daily dedupe would be
// wrong, so sensor triggers use a short cooldown instead).
export function sensorDue(
  list: Automation[],
  sensorId: string,
  now: Date,
  cooldownSec = 60
): Automation[] {
  return list.filter(
    (a) =>
      a.enabled &&
      a.trigger.kind === "sensor" &&
      a.trigger.sensorId === sensorId &&
      allowedToday(a, now) &&
      (!a.lastFiredAt || now.getTime() - a.lastFiredAt >= cooldownSec * 1000)
  );
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
    if (!allowedToday(a, now)) return false;
    const fire = fireTimeOn(a, now, coords);
    if (!fire) return false;
    const delta = now.getTime() - fire.getTime();
    return delta >= 0 && delta <= graceMs;
  });
}

// The next time this automation will fire — for display. Scans forward up to a week
// to honor the weekday filter. null if it can't be computed (sun trigger, no coords).
export function nextFire(a: Automation, now: Date, coords: Coords | null): Date | null {
  for (let i = 0; i <= 8; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    if (a.days?.length && !a.days.includes(day.getDay())) continue;
    const fire = fireTimeOn(a, day, coords);
    if (fire && fire.getTime() > now.getTime()) return fire;
  }
  return null;
}
