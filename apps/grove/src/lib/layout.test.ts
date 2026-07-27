import { describe, expect, it } from "vitest";
import { hourglass } from "./layout";
import type { Union } from "./model";

const shell = { createdAt: 1000, updatedAt: 2000, events: [] };

function union(id: string, partnerIds: string[], childIds: string[]): Union {
  return { id, partnerIds, children: childIds.map((personId) => ({ personId })), ...shell };
}

// Three generations: june+arthur → mary (+ tom); mary+sam → ada, ben.
const unions = [union("u1", ["june", "arthur"], ["mary", "tom"]), union("u2", ["mary", "sam"], ["ada", "ben"])];

const at = (h: ReturnType<typeof hourglass>, id: string) => h.nodes.find((n) => n.personId === id)!;

describe("hourglass layout", () => {
  const h = hourglass("mary", unions);

  it("puts the focus at the origin, ancestors above, descendants below", () => {
    expect(at(h, "mary")).toMatchObject({ x: 0, gen: 0, role: "focus" });
    expect(at(h, "june").gen).toBe(-1);
    expect(at(h, "arthur").gen).toBe(-1);
    expect(at(h, "ada").gen).toBe(1);
    expect(at(h, "ben").gen).toBe(1);
  });

  it("stands partners beside the focus, never in the bloodline rows", () => {
    expect(at(h, "sam")).toMatchObject({ gen: 0, role: "partner" });
    expect(at(h, "sam").x).toBeGreaterThan(0);
    expect(h.edges).toContainEqual({ from: "mary", to: "sam", kind: "partner" });
  });

  it("centers a node over its children and under its parents", () => {
    const ada = at(h, "ada");
    const ben = at(h, "ben");
    expect((ada.x + ben.x) / 2).toBeCloseTo(at(h, "mary").x);
    const june = at(h, "june");
    const arthur = at(h, "arthur");
    expect((june.x + arthur.x) / 2).toBeCloseTo(at(h, "mary").x);
    expect(june.x).not.toBeCloseTo(arthur.x); // no overlap
  });

  it("wires blood edges parent → child in both halves", () => {
    expect(h.edges).toContainEqual({ from: "june", to: "mary", kind: "blood" });
    expect(h.edges).toContainEqual({ from: "mary", to: "ada", kind: "blood" });
  });

  it("does not show the focus's siblings as descendants of the grandparents' walk", () => {
    // tom is june's child but not in mary's ancestor or descendant line;
    // the hourglass shows lineage, the person page shows siblings.
    expect(h.nodes.find((n) => n.personId === "tom")).toBeUndefined();
  });

  it("reports bounds the renderer can size a canvas from", () => {
    expect(h.minGen).toBe(-1);
    expect(h.maxGen).toBe(1);
    expect(h.maxX).toBeGreaterThanOrEqual(at(h, "sam").x);
  });

  it("re-centers cleanly on a grandchild", () => {
    const g = hourglass("ada", unions);
    expect(at(g, "ada").role).toBe("focus");
    expect(at(g, "mary").gen).toBe(-1);
    expect(at(g, "sam").gen).toBe(-1);
    expect(at(g, "june").gen).toBe(-2);
  });

  it("survives cyclic bad data without looping", () => {
    const cycle = [union("c1", ["a"], ["b"]), union("c2", ["b"], ["a"])];
    const g = hourglass("a", cycle);
    expect(g.nodes.filter((n) => n.personId === "a")).toHaveLength(1);
    expect(g.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("handles a person with nobody yet", () => {
    const lone = hourglass("solo", []);
    expect(lone.nodes).toEqual([{ personId: "solo", x: 0, gen: 0, role: "focus" }]);
    expect(lone.edges).toEqual([]);
  });
});
