// TreeView.tsx — the hourglass: the family displayed as a tree, one person in
// focus. Ancestors rise, descendants hang, partners stand alongside. Tap
// anyone to re-center the tree on them; tap the focused person to open their
// page. Wayfinding, not a map room — no zoom, no pan machinery, just a quiet
// chart that scrolls if the family outgrows the screen.

import { useEffect, useRef } from "react";
import { hourglass } from "../lib/layout";
import { displayName, lifespanLabel, type Person, type Union } from "../lib/model";

const COL = 150; // px per grid column
const ROW = 96; // px per generation row
const W = 132; // chip width
const H = 52; // chip height

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function TreeView({
  focus,
  people,
  unions,
  onFocus,
  onOpen,
  onBack,
}: {
  focus: Person;
  people: Person[];
  unions: Union[];
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const h = hourglass(focus.id, unions);
  // A union may reference someone whose record hasn't arrived yet (a shared
  // tree mid-race) — the chart simply doesn't draw them; the unplaced shelf
  // and person page still honor the never-silently-dropped rule.
  const nodes = h.nodes.filter((n) => byId.has(n.personId));
  const drawn = new Set(nodes.map((n) => n.personId));
  const edges = h.edges.filter((e) => drawn.has(e.from) && drawn.has(e.to));

  const width = (h.maxX - h.minX + 1) * COL;
  const height = (h.maxGen - h.minGen + 1) * ROW;
  const cx = (x: number) => (x - h.minX + 0.5) * COL;
  const cy = (gen: number) => (gen - h.minGen + 0.5) * ROW;
  const pos = new Map(nodes.map((n) => [n.personId, { x: cx(n.x), y: cy(n.gen) }]));

  // Open with the focus in the middle of the viewport.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const f = pos.get(focus.id);
    if (f) el.scrollLeft = Math.max(0, f.x - el.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.id]);

  return (
    <>
      <div className="tree-head">
        <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}>← Back</button>
        <h2 className="tree-title">Around {displayName(focus)}</h2>
        <button className="btn btn-sm" onClick={() => onOpen(focus.id)}>Open their page</button>
      </div>
      <p className="hint">Tap anyone to look at the tree from where they stand.</p>

      <div className="tree-scroll" ref={scrollRef}>
        <svg width={width} height={height} role="group" aria-label={`Family tree around ${displayName(focus)}`}>
          {edges.map((e) => {
            const a = pos.get(e.from)!;
            const b = pos.get(e.to)!;
            if (e.kind === "partner") {
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  className="tree-vine tree-vine-partner"
                  x1={a.x + W / 2} y1={a.y} x2={b.x - W / 2} y2={b.y}
                />
              );
            }
            const midY = (a.y + b.y) / 2;
            return (
              <path
                key={`${e.from}-${e.to}`}
                className="tree-vine"
                d={`M ${a.x} ${a.y + H / 2} V ${midY} H ${b.x} V ${b.y - H / 2}`}
                fill="none"
              />
            );
          })}
          {nodes.map((n) => {
            const p = byId.get(n.personId)!;
            const { x, y } = pos.get(n.personId)!;
            const span = lifespanLabel(p);
            const isFocus = n.role === "focus";
            return (
              <g
                key={n.personId}
                className={`tnode${isFocus ? " tnode-focus" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={isFocus ? `Open ${displayName(p)}'s page` : `Center the tree on ${displayName(p)}`}
                onClick={() => (isFocus ? onOpen(p.id) : onFocus(p.id))}
                onKeyDown={(e) => e.key === "Enter" && (isFocus ? onOpen(p.id) : onFocus(p.id))}
              >
                <rect x={x - W / 2} y={y - H / 2} width={W} height={H} rx={10} />
                <text className="tnode-name" x={x} y={span ? y - 3 : y + 4} textAnchor="middle">
                  {clip(displayName(p), 17)}
                </text>
                {span ? (
                  <text className="tnode-life" x={x} y={y + 15} textAnchor="middle">
                    {clip(span, 20)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
