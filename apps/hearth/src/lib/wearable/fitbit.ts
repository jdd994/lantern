// wearable/fitbit.ts
// Tier 2 — your browser talks straight to Fitbit, with no server in the middle.
//
// WHY FITBIT AND NOT THE OTHERS (probed 2026-07-16, don't re-litigate from docs):
// the only thing that decides whether a PWA can do this is whether the API sends
// `access-control-allow-origin`. Fitbit does, on both the API and the token
// endpoint, and it supports OAuth2 + PKCE for public clients — so there is no
// client secret, which means no backend, which means nobody new sees your body.
// Oura sends no allow-origin (and killed personal tokens in Dec 2025). Garmin is
// webhook-push with partner approval; Whoop's docs say outright that all requests
// must be server-side. Both of those would need a server that sees PLAINTEXT body
// data — the one thing every app here promises never to do. So they're not here.
//
// SCOPES ARE COARSER THAN OUR PROMISE. Fitbit's `activity` scope covers steps and
// calories burned in one grant; there is no way to ask for less. So the promise
// isn't kept by what we're permitted to read — it's kept by what we actually ask
// for. There is no calories endpoint in this file, and that's the enforcement.

import { pkceClient, type OAuthTokens } from "@lantern/core/connect";
import type { Reading } from "./index";

const API = "https://api.fitbit.com";

// The narrowest set that covers what we take. Notably absent: `nutrition`
// (Hearth's food log is ours and stays ours), `profile`, `location`, `social`.
const SCOPES = ["weight", "sleep", "heartrate", "activity"];

export type FitbitTokens = OAuthTokens;

export function clientId(): string {
  return (import.meta.env.VITE_FITBIT_CLIENT_ID as string | undefined) ?? "";
}
export const configured = (): boolean => clientId().length > 0;

// ---- the dance -----------------------------------------------------------
// The OAuth2+PKCE machinery is @lantern/core/connect — the same dance every
// tier-2 connector in the family does. What stays HERE is Fitbit: the
// endpoints, the scopes, and everything below about what we take and refuse.
//
// Lazy, because clientId() reads the env and module-eval order shouldn't.
const client = () =>
  pkceClient({
    clientId: clientId(),
    label: "Fitbit",
    authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
    tokenUrl: "https://api.fitbit.com/oauth2/token",
    scopes: SCOPES,
    // Unchanged from before the extraction: same sessionStorage keys, so a
    // dance in flight across a deploy still completes.
    storagePrefix: "hearth-fitbit",
  });

/** Leave for Fitbit's consent page. Returns only to say it's about to navigate. */
export const beginConnect = (): Promise<void> => client().beginConnect();

/**
 * Is this page load a return from Fitbit? Reads (and does not clear) the code.
 * Returns null when there's nothing pending, or when `state` doesn't match what
 * we sent — which means it isn't our redirect and we want no part of it.
 */
export const pendingCode = (search?: string): string | null => client().pendingCode(search);

/**
 * Did we come back having been told no? Saying no is a perfectly good answer, so
 * it gets a calm sentence rather than silence — without this, declining on
 * Fitbit's page returns you to a screen where nothing whatsoever happens.
 * Returns null when this isn't our redirect, or isn't a refusal.
 */
export const pendingError = (search?: string): string | null => client().pendingError(search);

/** Scrub the code out of the address bar so a reload can't replay it. */
export const clearCallback = (): void => client().clearCallback();

/** Trade the code for tokens. No client secret — that's the whole point of PKCE. */
export const completeConnect = (code: string): Promise<FitbitTokens> =>
  client().completeConnect(code);

/** Fitbit rotates the refresh token on every use — always store what comes back. */
export const refreshTokens = (refreshToken: string): Promise<FitbitTokens> =>
  client().refreshTokens(refreshToken);

export const ensureFresh = (t: FitbitTokens): Promise<FitbitTokens> => client().ensureFresh(t);

// ---- reading -------------------------------------------------------------

// No Accept-Language header on purpose: Fitbit returns METRIC units when you
// don't ask for a locale, which is exactly our canonical (kg). Adding
// `Accept-Language: en_US` here would silently start returning pounds while
// still labelling them kg.
async function get(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("Fitbit signed this device out. Connect it again when you like.");
  if (res.status === 429) throw new Error("Fitbit's hourly limit is reached. It'll work again shortly.");
  if (!res.ok) throw new Error("Couldn't reach Fitbit just now.");
  return res.json();
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
};

/** Local YYYY-MM-DD — Fitbit's dates are the user's own days, not UTC. */
export function ymd(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A dated reading with no clock time sits at midday, matching what the manual
// "log a reading" sheet does for a past date.
const stamp = (date: string, time?: string): number =>
  new Date(`${date}T${time && /^\d{2}:\d{2}/.test(time) ? time : "12:00:00"}`).getTime();

const ok = (n: number) => Number.isFinite(n) && n > 0;

// What we drop on the floor, named so the test can prove we drop it. Each of
// these is a verdict wearing a number's clothes.
export const REFUSED_FIELDS = ["bmi", "efficiency", "score", "calories", "caloriesOut", "heartRateZones"];

export function mapWeight(json: unknown): Reading[] {
  const rows = (json as { weight?: unknown[] })?.weight ?? [];
  return rows.flatMap((raw): Reading[] => {
    const r = raw as { weight?: unknown; date?: string; time?: string; logId?: unknown };
    const value = num(r.weight);
    if (!ok(value) || !r.date) return [];
    // `bmi` rides along in this payload. It is not taken.
    return [{
      kind: "weight", value, unit: "kg", at: stamp(r.date, r.time),
      natural: `fitbit:weight:${r.logId ?? `${r.date}T${r.time ?? ""}`}`,
    }];
  });
}

export function mapFat(json: unknown): Reading[] {
  const rows = (json as { fat?: unknown[] })?.fat ?? [];
  return rows.flatMap((raw): Reading[] => {
    const r = raw as { fat?: unknown; date?: string; time?: string; logId?: unknown };
    const value = num(r.fat);
    if (!ok(value) || !r.date) return [];
    return [{
      kind: "bodyfat", value, unit: "%", at: stamp(r.date, r.time),
      natural: `fitbit:fat:${r.logId ?? `${r.date}T${r.time ?? ""}`}`,
    }];
  });
}

// Main sleep only. Fitbit lists naps as their own records, and a trend line that
// mixes "7.5h last night" with "a 20 minute nap" tells you nothing true.
// `efficiency` — Fitbit's grade for how well you slept — is not taken.
export function mapSleep(json: unknown): Reading[] {
  const rows = (json as { sleep?: unknown[] })?.sleep ?? [];
  return rows.flatMap((raw): Reading[] => {
    const r = raw as { minutesAsleep?: unknown; dateOfSleep?: string; isMainSleep?: boolean; logId?: unknown };
    if (r.isMainSleep === false) return [];
    const mins = num(r.minutesAsleep);
    if (!ok(mins) || !r.dateOfSleep) return [];
    return [{
      kind: "sleep", value: mins / 60, unit: "h", at: stamp(r.dateOfSleep),
      natural: `fitbit:sleep:${r.logId ?? r.dateOfSleep}`,
    }];
  });
}

// `value.heartRateZones` comes with this and is not taken — zones are a
// prescription ("you should have been in fat burn"), not a measurement.
export function mapRestingHR(json: unknown): Reading[] {
  const rows = (json as { "activities-heart"?: unknown[] })?.["activities-heart"] ?? [];
  return rows.flatMap((raw): Reading[] => {
    const r = raw as { dateTime?: string; value?: { restingHeartRate?: unknown } };
    const value = num(r.value?.restingHeartRate);
    if (!ok(value) || !r.dateTime) return [];
    return [{
      kind: "restingHR", value, unit: "bpm", at: stamp(r.dateTime),
      natural: `fitbit:rhr:${r.dateTime}`,
    }];
  });
}

// A zero-step day is almost always "didn't wear it", not "didn't move" — Fitbit
// returns 0 for days it has nothing for. Importing those would draw a floor of
// false zeroes through your own history, so they're skipped.
export function mapSteps(json: unknown): Reading[] {
  const rows = (json as { "activities-steps"?: unknown[] })?.["activities-steps"] ?? [];
  return rows.flatMap((raw): Reading[] => {
    const r = raw as { dateTime?: string; value?: unknown };
    const value = num(r.value);
    if (!ok(value) || !r.dateTime) return [];
    return [{
      kind: "steps", value, unit: "steps", at: stamp(r.dateTime),
      natural: `fitbit:steps:${r.dateTime}`,
    }];
  });
}

/**
 * Everything we take, for the last `days`. One ranged request per kind rather
 * than one per day — Fitbit allows 150 requests an hour, and being a good guest
 * is free. 30 days keeps us inside the weight log's 31-day ceiling.
 */
export async function fetchReadings(tokens: FitbitTokens, days = 30): Promise<Reading[]> {
  const end = ymd(Date.now());
  const start = ymd(Date.now() - days * 86_400_000);
  const t = tokens.accessToken;
  const [weight, fat, sleep, hr, steps] = await Promise.all([
    get(`/1/user/-/body/log/weight/date/${start}/${end}.json`, t),
    get(`/1/user/-/body/log/fat/date/${start}/${end}.json`, t),
    get(`/1.2/user/-/sleep/date/${start}/${end}.json`, t),
    get(`/1/user/-/activities/heart/date/${start}/${end}.json`, t),
    get(`/1/user/-/activities/steps/date/${start}/${end}.json`, t),
  ]);
  return [
    ...mapWeight(weight), ...mapFat(fat), ...mapSleep(sleep),
    ...mapRestingHR(hr), ...mapSteps(steps),
  ];
}
