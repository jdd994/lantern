import { describe, expect, it } from "vitest";
import {
  fmtDuration, fmtKm, fmtPace, haversine, parseGPX, routePath, runNatural,
  shapeOf, summarise,
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

  it("stores the route at ~1m precision, nothing else", () => {
    const shape = shapeOf([{ lat: 51.5000012, lon: -0.1000049, ele: 12, t: 5 }]);
    expect(shape).toEqual([[51.5, -0.1]]);
  });

  it("fits the route into the box, both dimensions inside", () => {
    const path = routePath([[51.5, -0.1], [51.501, -0.099], [51.5005, -0.1015]], 72, 44);
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
  it("formats the facts, and refuses a pace built on noise", () => {
    expect(fmtKm(5230)).toBe("5.23 km");
    expect(fmtDuration(1830)).toBe("30:30");
    expect(fmtDuration(3725)).toBe("1:02:05");
    expect(fmtPace(1500, 5000)).toBe("5:00 /km");
    expect(fmtPace(60, 50)).toBeNull(); // 50 metres is not a pace
  });
});
