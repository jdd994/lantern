// run.ts
// Runs, from GPX files — tier 0 the whole way down. GPX is the one honest door
// every vendor leaves open: phones, watches, and even the vendors whose live
// APIs we refuse (Garmin, Whoop) all export it. You pick a file; it's parsed
// right here; the route lands in your encrypted vault and nowhere else.
//
// A run trace deserves the vault more than anything else in Hearth: it's a map
// of where you are, alone, at predictable times. The dominant model publishes
// that. This is the other thing.
//
// NO MAP TILES, ON PURPOSE. Drawing the route on a real map means fetching
// tiles, and a tile server learns roughly where you run — a trust-ladder cost
// this feature refuses for now. The route is drawn as its own shape on blank
// ground instead (see routePath), which keeps the CSP's silence intact.
//
// GPX extensions (heart rate, cadence, and yes — calories) are never parsed.
// The calories refusal is the same one the wearables keep; the enforcement is
// the absence of any extension handling below.

export type TrackPoint = { lat: number; lon: number; ele?: number; t?: number };

export type RunContent = {
  name?: string;
  startedAt: number;
  seconds?: number;      // absent when the file carries no timestamps
  meters: number;
  ascent?: number;       // absent when the file carries no elevation
  points: [number, number][]; // [lat, lon], rounded — the shape of the run
};
export type Run = RunContent & { id: string };

// ---- parsing ---------------------------------------------------------------
// A deliberately small reader for the slice of GPX a run needs: track points
// with lat/lon and optional <ele>/<time>, plus the file's <name>. It's tolerant
// (either attribute order, either quote style, self-closing points, multiple
// segments) and depends on nothing — no DOMParser, so the same code runs in
// tests and the page.

const ATTR = (name: string, tag: string): string | null => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1] : null;
};
const CHILD = (name: string, body: string): string | null => {
  const m = body.match(new RegExp(`<${name}[^>]*>\\s*([^<]+?)\\s*</${name}>`));
  return m ? m[1] : null;
};

export function parseGPX(xml: string): { name?: string; points: TrackPoint[] } {
  const points: TrackPoint[] = [];
  const re = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const lat = parseFloat(ATTR("lat", m[1]) ?? "");
    const lon = parseFloat(ATTR("lon", m[1]) ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const body = m[2] ?? "";
    const ele = parseFloat(CHILD("ele", body) ?? "");
    const time = CHILD("time", body);
    const t = time ? Date.parse(time) : NaN;
    points.push({
      lat, lon,
      ...(Number.isFinite(ele) ? { ele } : {}),
      ...(Number.isFinite(t) ? { t } : {}),
    });
  }
  const name = CHILD("name", xml) ?? undefined;
  return { name, points };
}

// ---- the honest arithmetic ---------------------------------------------------

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: TrackPoint, b: TrackPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// GPS elevation wobbles by metres while you stand still; summing every wobble
// invents a mountain. A change only counts once it clears this threshold from
// the last accepted elevation — a plain hysteresis, applied openly. Ascent from
// GPS is still an estimate, and the UI says "≈" for exactly that reason.
const ASCENT_MIN_STEP_M = 3;

export type RunSummary = {
  meters: number;
  seconds?: number;
  ascent?: number;
  startedAt?: number;
};

export function summarise(points: TrackPoint[]): RunSummary | null {
  if (points.length < 2) return null;

  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += haversine(points[i - 1], points[i]);

  const times = points.filter((p) => p.t !== undefined);
  const seconds =
    times.length >= 2
      ? Math.round((times[times.length - 1].t! - times[0].t!) / 1000)
      : undefined;

  let ascent: number | undefined;
  const eles = points.filter((p) => p.ele !== undefined).map((p) => p.ele!);
  if (eles.length >= 2) {
    let gain = 0;
    let last = eles[0];
    for (const e of eles.slice(1)) {
      const d = e - last;
      if (Math.abs(d) >= ASCENT_MIN_STEP_M) {
        if (d > 0) gain += d;
        last = e;
      }
    }
    ascent = Math.round(gain);
  }

  return {
    meters: Math.round(meters),
    seconds: seconds !== undefined && seconds > 0 ? seconds : undefined,
    ascent,
    startedAt: times.length > 0 ? times[0].t : undefined,
  };
}

/** The stored shape: [lat, lon] pairs at ~1m precision — the route, no more. */
export function shapeOf(points: TrackPoint[]): [number, number][] {
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  return points.map((p) => [r5(p.lat), r5(p.lon)]);
}

/**
 * The natural key a re-import dedupes on (HMAC-tagged before it becomes a
 * record id, same as wearable readings — a record id is plaintext, and it must
 * not tell our own server that you run, let alone when).
 */
export function runNatural(s: RunSummary, points: TrackPoint[]): string {
  const anchor = s.startedAt ?? `${points[0].lat},${points[0].lon}`;
  return `run:gpx:${anchor}:${points.length}`;
}

// ---- the route as a shape ------------------------------------------------------
// Equirectangular projection scaled by cos(mid-latitude), fitted uniformly into
// the box so the run keeps its true proportions — a loop looks like a loop.

export function routePath(
  points: [number, number][], w: number, h: number, pad = 3
): string {
  if (points.length === 0) return "";
  const midLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kx = Math.cos(rad(midLat));
  const xs = points.map((p) => p[1] * kx);
  const ys = points.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(
    (w - 2 * pad) / (maxX - minX || 1e-9),
    (h - 2 * pad) / (maxY - minY || 1e-9)
  );
  const ox = (w - (maxX - minX) * scale) / 2;
  const oy = (h - (maxY - minY) * scale) / 2;
  return points
    .map((p) => {
      const x = ox + (p[1] * kx - minX) * scale;
      const y = h - oy - (p[0] - minY) * scale; // north up
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// ---- display helpers ------------------------------------------------------------

export function fmtKm(meters: number): string {
  return `${(meters / 1000).toFixed(meters >= 100_000 ? 0 : 2)} km`;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** min/km, the runner's number — only when both halves were measured. */
export function fmtPace(seconds: number, meters: number): string | null {
  if (seconds <= 0 || meters < 100) return null; // shorter than that, pace is noise
  const secPerKm = seconds / (meters / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}
