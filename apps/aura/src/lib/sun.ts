// sun.ts — pure sunrise/sunset math (no IO, unit-tested). Standard US Naval
// Observatory "Almanac for Computers" algorithm; all trig in degrees. Given a local
// calendar day + coordinates, returns the absolute Date of the sun event, or null
// at extreme latitudes where the sun doesn't rise/set that day (polar day/night).
// Good to within a minute or two — plenty for "bring the lights up at sunset."

const ZENITH = 90.833; // official sunrise/sunset (sun's upper limb at the horizon)
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (v: number, max: number) => ((v % max) + max) % max;

function dayOfYear(y: number, m: number, d: number): number {
  const n1 = Math.floor((275 * m) / 9);
  const n2 = Math.floor((m + 9) / 12);
  const n3 = 1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3);
  return n1 - n2 * n3 + d - 30;
}

export function sunTime(date: Date, lat: number, lon: number, event: "sunrise" | "sunset"): Date | null {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const N = dayOfYear(y, m, d);

  const lngHour = lon / 15;
  const t = N + ((event === "sunrise" ? 6 : 18) - lngHour) / 24;

  const M = 0.9856 * t - 3.289; // sun's mean anomaly
  let L = M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634; // true longitude
  L = norm(L, 360);

  let RA = deg(Math.atan(0.91764 * Math.tan(rad(L)))); // right ascension
  RA = norm(RA, 360);
  // Put RA in the same quadrant as L, then express in hours.
  const Lquad = Math.floor(L / 90) * 90;
  const RAquad = Math.floor(RA / 90) * 90;
  RA = (RA + (Lquad - RAquad)) / 15;

  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosH = (Math.cos(rad(ZENITH)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null; // sun never rises / never sets this day

  const H = (event === "sunrise" ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;

  const T = H + RA - 0.06571 * t - 6.622; // local mean time of the event
  const UT = norm(T - lngHour, 24); // in UTC hours

  const hours = Math.floor(UT);
  const minutes = Math.floor((UT - hours) * 60);
  return new Date(Date.UTC(y, m - 1, d, hours, minutes));
}
