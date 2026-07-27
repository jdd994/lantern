// layout.ts
// The hourglass chart: one person in focus, ancestors rising above,
// descendants hanging below, partners alongside. Pure geometry on a unit
// grid — x in columns, gen in rows (negative above the focus, positive
// below) — so it's testable without a pixel in sight. The component scales
// to pixels and draws; this file only decides where things stand.
//
// Deliberately humble: this is wayfinding, not a zoomable canvas. Each half
// is a tidy tree (a node is centered over/under its subtree); the two halves
// meet at the focus. Cycles in bad data can't loop it — every id places once.

import { childrenOf, parentsOf, partnersOf, type Union } from "./model";

export type TreeNode = { personId: string; x: number; gen: number; role: "focus" | "partner" | "kin" };
export type TreeEdge = { from: string; to: string; kind: "blood" | "partner" };

export type Hourglass = {
  nodes: TreeNode[];
  edges: TreeEdge[];
  // Bounds in grid units, so the renderer can size its canvas.
  minX: number;
  maxX: number;
  minGen: number;
  maxGen: number;
};

export const MAX_UP = 3; // generations of ancestors shown
export const MAX_DOWN = 3; // generations of descendants shown

export function hourglass(focusId: string, unions: Union[]): Hourglass {
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const seen = new Set<string>([focusId]);

  // ---- descendants: a node is centered over the block of its children ----
  const widthDown = (id: string, depth: number, path: Set<string>): number => {
    if (depth >= MAX_DOWN) return 1;
    const kids = childrenOf(id, unions).filter((k) => !path.has(k));
    if (!kids.length) return 1;
    let w = 0;
    for (const k of kids) w += widthDown(k, depth + 1, new Set(path).add(k));
    return Math.max(1, w);
  };
  const placeDown = (id: string, x: number, gen: number, depth: number, path: Set<string>): void => {
    if (depth >= MAX_DOWN) return;
    const kids = childrenOf(id, unions).filter((k) => !path.has(k) && !seen.has(k));
    if (!kids.length) return;
    let cursor = x - widthDown(id, depth, path) / 2;
    for (const k of kids) {
      const kw = widthDown(k, depth + 1, new Set(path).add(k));
      const kx = cursor + kw / 2;
      cursor += kw;
      seen.add(k);
      nodes.push({ personId: k, x: kx, gen: gen + 1, role: "kin" });
      edges.push({ from: id, to: k, kind: "blood" });
      placeDown(k, kx, gen + 1, depth + 1, new Set(path).add(k));
    }
  };

  // ---- ancestors: mirrored — a node is centered under its parents' block ----
  const widthUp = (id: string, depth: number, path: Set<string>): number => {
    if (depth >= MAX_UP) return 1;
    const folks = parentsOf(id, unions).filter((p) => !path.has(p));
    if (!folks.length) return 1;
    let w = 0;
    for (const p of folks) w += widthUp(p, depth + 1, new Set(path).add(p));
    return Math.max(1, w);
  };
  const placeUp = (id: string, x: number, gen: number, depth: number, path: Set<string>): void => {
    if (depth >= MAX_UP) return;
    const folks = parentsOf(id, unions).filter((p) => !path.has(p) && !seen.has(p));
    if (!folks.length) return;
    let cursor = x - widthUp(id, depth, path) / 2;
    for (const p of folks) {
      const pw = widthUp(p, depth + 1, new Set(path).add(p));
      const px = cursor + pw / 2;
      cursor += pw;
      seen.add(p);
      nodes.push({ personId: p, x: px, gen: gen - 1, role: "kin" });
      edges.push({ from: p, to: id, kind: "blood" });
      placeUp(p, px, gen - 1, depth + 1, new Set(path).add(p));
    }
  };

  nodes.push({ personId: focusId, x: 0, gen: 0, role: "focus" });
  placeUp(focusId, 0, 0, 0, new Set([focusId]));
  placeDown(focusId, 0, 0, 0, new Set([focusId]));

  // Partners stand beside the focus, past whatever the halves have claimed
  // at generation 0 (only the focus, today — but measured, not assumed).
  const gen0Max = Math.max(...nodes.filter((n) => n.gen === 0).map((n) => n.x));
  let px = gen0Max;
  for (const partner of partnersOf(focusId, unions)) {
    if (seen.has(partner)) continue;
    seen.add(partner);
    px += 1;
    nodes.push({ personId: partner, x: px, gen: 0, role: "partner" });
    edges.push({ from: focusId, to: partner, kind: "partner" });
  }

  const xs = nodes.map((n) => n.x);
  const gens = nodes.map((n) => n.gen);
  return {
    nodes,
    edges,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minGen: Math.min(...gens),
    maxGen: Math.max(...gens),
  };
}
