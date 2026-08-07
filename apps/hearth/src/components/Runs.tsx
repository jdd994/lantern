// Runs.tsx
// Runs from GPX files — the route drawn as its own quiet shape, never on a map.
// Fetching map tiles would tell a tile server roughly where you run, so there
// are no tiles: the shape on blank ground is the tier 0 answer, and it's enough
// to recognise your own loop at a glance.
//
// The tone rules hold hardest here, because running apps are the worst
// offenders: no personal records, no pace judgement, no comparison to last
// week, no streaks. A run is stated as its facts — how far, how long, how much
// climb — and tapping one opens the same facts in depth: the route large, each
// split as it actually went, the ground's own profile. Still no verdicts.

import { useRef, useState } from "react";
import {
  elevationPath, fmtClimb, fmtDistance, fmtDuration, fmtPace, routePath,
  splitMeters, splits, type DistanceUnit, type Run,
} from "../lib/run";

function RouteShape({
  points, w, h, strokeWidth = 1.5,
}: {
  points: Run["points"]; w: number; h: number; strokeWidth?: number;
}) {
  if (points.length < 2) return null;
  return (
    <svg className="run-shape" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline
        points={routePath(points, w, h)}
        fill="none" stroke="var(--ember)" strokeWidth={strokeWidth}
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

function runDate(at: number, long = false): string {
  return new Date(at).toLocaleDateString(undefined, long
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}

// ---- one run, in depth ------------------------------------------------------

function RunDetail({
  run, unit, onClose,
}: {
  run: Run; unit: DistanceUnit; onClose: () => void;
}) {
  const pace = run.seconds !== undefined ? fmtPace(run.seconds, run.meters, unit) : null;
  const parts = splits(run.points, splitMeters(unit));
  const profile = elevationPath(run.points, 600, 90);
  const per = splitMeters(unit);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{run.name ?? "A run"}</h3>
        <p className="run-detail-date">{runDate(run.startedAt, true)}</p>

        <div className="run-detail-shape">
          <RouteShape points={run.points} w={300} h={170} strokeWidth={2} />
        </div>

        <div className="run-detail-facts">
          <span className="run-dist">{fmtDistance(run.meters, unit)}</span>
          {run.seconds !== undefined ? <span>{fmtDuration(run.seconds)}</span> : null}
          {pace ? <span>{pace}</span> : null}
          {run.ascent !== undefined && run.ascent > 0 ? <span>{fmtClimb(run.ascent, unit)}</span> : null}
        </div>

        {profile ? (
          <>
            <div className="set-head">The ground</div>
            <svg className="run-profile" viewBox="0 0 600 90" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={profile} fill="none" stroke="var(--ink-faint)" strokeWidth="1.5"
                strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </>
        ) : null}

        {parts.length > 0 ? (
          <>
            <div className="set-head">Splits — as they went, no verdicts</div>
            <div className="run-splits">
              {parts.map((s, i) => {
                const full = s.meters >= per - 1;
                return (
                  <div className="run-split" key={i}>
                    <span className="run-split-n">
                      {full ? `${unit === "mi" ? "mi" : "km"} ${i + 1}` : `last ${fmtDistance(s.meters, unit)}`}
                    </span>
                    <span className="run-split-t">{fmtDuration(s.seconds)}</span>
                    <span className="run-split-p">{fmtPace(s.seconds, s.meters, unit) ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function Runs({
  runs, error, unit, onImport, onRemove,
}: {
  runs: Run[];
  error: string | null;
  unit: DistanceUnit;
  onImport: (files: { name: string; text: string }[]) => void;
  onRemove: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Run | null>(null);

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
            const pace = r.seconds !== undefined ? fmtPace(r.seconds, r.meters, unit) : null;
            return (
              <div className="run-row" key={r.id}>
                <button className="run-open" onClick={() => setOpen(r)} title="Look closer">
                  <RouteShape points={r.points} w={72} h={44} />
                  <div className="run-facts">
                    <div className="run-head">
                      <span className="run-dist">{fmtDistance(r.meters, unit)}</span>
                      {r.name ? <span className="run-name">{r.name}</span> : null}
                    </div>
                    <div className="run-meta">
                      {runDate(r.startedAt)}
                      {r.seconds !== undefined ? ` · ${fmtDuration(r.seconds)}` : ""}
                      {pace ? ` · ${pace}` : ""}
                      {r.ascent !== undefined && r.ascent > 0 ? ` · ${fmtClimb(r.ascent, unit)}` : ""}
                    </div>
                  </div>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(r.id)} title="Remove">×</button>
              </div>
            );
          })}
        </div>
      )}

      {open ? <RunDetail run={open} unit={unit} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
