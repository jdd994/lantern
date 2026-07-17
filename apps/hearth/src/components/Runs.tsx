// Runs.tsx
// Runs from GPX files — the route drawn as its own quiet shape, never on a map.
// Fetching map tiles would tell a tile server roughly where you run, so there
// are no tiles: the shape on blank ground is the tier 0 answer, and it's enough
// to recognise your own loop at a glance.
//
// The tone rules hold hardest here, because running apps are the worst
// offenders: no personal records, no pace judgement, no comparison to last
// week, no streaks. A run is stated as its facts — how far, how long, how much
// climb — and the facts are enough.

import { useRef } from "react";
import { fmtDuration, fmtKm, fmtPace, routePath, type Run } from "../lib/run";

function RouteShape({ points }: { points: [number, number][] }) {
  const W = 72, H = 44;
  if (points.length < 2) return null;
  return (
    <svg className="run-shape" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline
        points={routePath(points, W, H)}
        fill="none" stroke="var(--ember)" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

function runDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

export function Runs({
  runs, error, onImport, onRemove,
}: {
  runs: Run[];
  error: string | null;
  onImport: (files: { name: string; text: string }[]) => void;
  onRemove: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: await f.text() }))
    );
    onImport(files);
    if (fileInput.current) fileInput.current.value = "";
  }

  const newestFirst = [...runs].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Runs</h2>
        <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
          Import GPX
        </button>
        <input
          ref={fileInput} type="file" accept=".gpx,application/gpx+xml" multiple hidden
          onChange={(e) => void pick(e.target.files)}
        />
      </div>

      {error ? <div className="error">{error}</div> : null}

      {newestFirst.length === 0 ? (
        <div className="empty">
          No runs yet.
          <br />
          Export a GPX from your phone or watch and bring it here — the file is read on this
          device and your routes stay yours, encrypted like everything else.
        </div>
      ) : (
        <div className="metric-list">
          {newestFirst.map((r) => {
            const pace = r.seconds !== undefined ? fmtPace(r.seconds, r.meters) : null;
            return (
              <div className="run-row" key={r.id}>
                <RouteShape points={r.points} />
                <div className="run-facts">
                  <div className="run-head">
                    <span className="run-dist">{fmtKm(r.meters)}</span>
                    {r.name ? <span className="run-name">{r.name}</span> : null}
                  </div>
                  <div className="run-meta">
                    {runDate(r.startedAt)}
                    {r.seconds !== undefined ? ` · ${fmtDuration(r.seconds)}` : ""}
                    {pace ? ` · ${pace}` : ""}
                    {r.ascent !== undefined && r.ascent > 0 ? ` · ≈${r.ascent} m climb` : ""}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(r.id)} title="Remove">×</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
