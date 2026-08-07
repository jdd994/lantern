import { describe, expect, it } from "vitest";
import {
  cumulative, elevationPath, fmtClimb, fmtDistance, fmtDuration, fmtPace,
  haversine, parseGPX, routePath, runNatural, shapeOf, splits, summarise,
  type RoutePoint,
} from "./run";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="a phone">
  <metadata><time>2026-07-16T07:00:00Z</time></metadata>
  <trk><name>Morning loop</name><trkseg>
    <trkpt lat="51.5000" lon="-0.1000"><ele>10.0</ele><time>2026-07-16T07:00:00Z</time></trkpt>
    <trkpt lon="-0.1010" lat="51.5010"><ele>14.5</ele><time>2026-07-16T07:01:00Z</time></trkpt>
    <trkpt lat='51.5020' lon='-0.1000'><ele>12.0</ele><time>2026-07-16T07:02:00Z</time></trkpt>
  </trkseg><trkseg>
    <trkpt lat="51.5030" lon="-0.0990"/>
  </trkseg></trk>
</gpx>`;

describe("parseGPX", () => {
  it("reads points across segments, either attribute order, either quote style", () => {
    const { name, points } = parseGPX(GPX);
    expect(name).toBe("Morning loop");
    expect(points).toHaveLength(4);
    expect(points[1]).toMatchObject({ lat: 51.501, lon: -0.101, ele: 14.5 });
    expect(points[1].t).toBe(Date.parse("2026-07-16T07:01:00Z"));
    expect(points[3]).toEqual({ lat: 51.503, lon: -0.099 }); // self-closing, bare
  });

  it("skips malformed points and survives an empty file", () => {
    expect(parseGPX(`<gpx><trk><trkseg><trkpt lat="oops" lon="1"/></trkseg></trk></gpx>`).points).toEqual([]);
    expect(parseGPX("").points).toEqual([]);
  });

  it("never reads extensions — heart rate and calories stay in the file", () => {
    const withExt = `<gpx><trk><trkseg>
      <trkpt lat="51.5" lon="-0.1"><extensions><gpxtpx:hr>150</gpxtpx:hr><calories>320</calories></extensions></trkpt>
      <trkpt lat="51.6" lon="-0.1"/>
    </trkseg></trk></gpx>`;
    const { points } = parseGPX(withExt);
    expect(points).toHaveLength(2);
    expect(JSON.stringify(points)).not.toContain("150");
    expect(JSON.stringify(points)).not.toContain("320");
  });
});

describe("haversine", () => {
  it("knows how long a degree is", () => {
    // One degree of latitude ≈ 111.2 km, anywhere.
    const d = haversine({ lat: 51, lon: 0 }, { lat: 52, lon: 0 });
    expect(d).toBeGreaterThan(110_500);
    expect(d).toBeLessThan(111_800);
  });
});

describe("summarise", () => {
  it("computes distance, duration, and start from the track", () => {
    const s = summarise(parseGPX(GPX).points)!;
    expect(s.meters).toBeGreaterThan(300); // ~3 × ~120m legs
    expect(s.meters).toBeLessThan(500);
    expect(s.seconds).toBe(120);
    expect(s.startedAt).toBe(Date.parse("2026-07-16T07:00:00Z"));
  });

  it("ascends only past the wobble threshold — standing still builds no mountain", () => {
    const wobble = (eles: number[]) =>
      summarise(eles.map((ele, i) => ({ lat: 51 + i * 0.001, lon: 0, ele })))!.ascent;
    expect(wobble([10, 11, 10, 11.5, 10.2, 11, 10])).toBe(0);   // ±1.5m noise
    expect(wobble([10, 14.5, 12, 16, 20])).toBe(10);            // 4.5 up + 5.5 up; the wobbles don't count
  });

  it("says nothing about time or climb when the file measured neither", () => {
    const s = summarise([{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.1 }])!;
    expect(s.seconds).toBeUndefined();
    expect(s.ascent).toBeUndefined();
    expect(s.startedAt).toBeUndefined();
  });

  it("is quiet below two points", () => {
    expect(summarise([])).toBeNull();
    expect(summarise([{ lat: 51, lon: 0 }])).toBeNull();
  });
});

describe("naturals and shape", () => {
  it("the same run imports to the same natural, twice", () => {
    const points = parseGPX(GPX).points;
    const s = summarise(points)!;
    expect(runNatural(s, points)).toBe(runNatural(s, points));
    expect(runNatural(s, points)).toContain("run:gpx:");
  });

  it("stores position at ~1m, elevation at 0.1m, and time as seconds from the start", () => {
    const start = Date.parse("2026-07-16T07:00:00Z");
    const shape = shapeOf(
      [
        { lat: 51.5000012, lon: -0.1000049, ele: 12.34, t: start },
        { lat: 51.501, lon: -0.101, t: start + 61_000 },
        { lat: 51.502, lon: -0.102, ele: 15 },
      ],
      start
    );
    expect(shape).toEqual([
      [51.5, -0.1, 12.3, 0],
      [51.501, -0.101, null, 61],
      [51.502, -0.102, 15, null],
    ]);
  });

  it("fits the route into the box, both dimensions inside", () => {
    const pts: RoutePoint[] = [
      [51.5, -0.1, null, null], [51.501, -0.099, null, null], [51.5005, -0.1015, null, null],
    ];
    const path = routePath(pts, 72, 44);
    const coords = path.split(" ").map((p) => p.split(",").map(Number));
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(72);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(44);
    }
  });
});

describe("display helpers", () => {
  it("formats the facts in either unit, and refuses a pace built on noise", () => {
    expect(fmtDistance(5230, "km")).toBe("5.23 km");
    expect(fmtDistance(8046.72, "mi")).toBe("5.00 mi");
    expect(fmtDuration(1830)).toBe("30:30");
    expect(fmtDuration(3725)).toBe("1:02:05");
    expect(fmtPace(1500, 5000, "km")).toBe("5:00 /km");
    expect(fmtPace(1500, 5000, "mi")).toBe("8:03 /mi");
    expect(fmtPace(60, 50, "km")).toBeNull(); // 50 metres is not a pace
    expect(fmtClimb(120.4, "km")).toBe("≈120 m climb");
    expect(fmtClimb(30.48, "mi")).toBe("≈100 ft climb");
  });
});

describe("depth: splits and the profile", () => {
  // A straight line north at constant speed: each 0.001° of latitude ≈ 111.2m,
  // one point per 30 seconds. ~10 points ≈ 1km.
  const steady = (n: number): RoutePoint[] =>
    Array.from({ length: n }, (_, i) => [51 + i * 0.001, 0, 10 + i, i * 30]);

  it("cumulative distance climbs monotonically", () => {
    const cum = cumulative(steady(4));
    expect(cum[0]).toBe(0);
    expect(cum[3]).toBeGreaterThan(cum[2]);
    expect(cum[3]).toBeCloseTo(3 * 111_195 * 0.001, -1);
  });

  it("splits interpolate boundary times and never dress up the partial", () => {
    const parts = splits(steady(12), 1000); // ~1.22 km total
    expect(parts.length).toBe(2);
    expect(parts[0].meters).toBe(1000);
    // ~111.2m per 30s → 1km ≈ 270s. Interpolated, so near, not exact.
    expect(parts[0].seconds).toBeGreaterThan(255);
    expect(parts[0].seconds).toBeLessThan(285);
    expect(parts[1].meters).toBeLessThan(1000); // the honest remainder
  });

  it("no times means no splits — never a pace invented from an assumption", () => {
    const untimed: RoutePoint[] = steady(12).map((p) => [p[0], p[1], p[2], null]);
    expect(splits(untimed, 1000)).toEqual([]);
  });

  it("draws the ground only when the ground was measured", () => {
    expect(elevationPath(steady(5), 600, 90)).not.toBeNull();
    const flat: RoutePoint[] = steady(5).map((p) => [p[0], p[1], null, p[3]]);
    expect(elevationPath(flat, 600, 90)).toBeNull();
  });
});
