import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  birthFamilyName,
  childrenOf,
  decodeKeepsake,
  decodePerson,
  decodeUnion,
  descendantsOf,
  displayName,
  encodeKeepsake,
  encodePerson,
  encodeUnion,
  keepsakesFor,
  lifespanLabel,
  linkRelative,
  parentsOf,
  partnersOf,
  siblingsOf,
  unlinkPerson,
  unplaced,
  whenLabel,
  whenYear,
  withBirthFamilyName,
  withEventWhen,
  yearWhen,
  type Keepsake,
  type Person,
  type Union,
} from "./model";

const shell = { createdAt: 1000, updatedAt: 2000 };

function person(id: string, given: string, extra: Partial<Person> = {}): Person {
  return { id, names: [{ given }], events: [], ...shell, ...extra };
}

function union(id: string, partnerIds: string[], childIds: string[], extra: Partial<Union> = {}): Union {
  return {
    id,
    partnerIds,
    children: childIds.map((personId) => ({ personId })),
    events: [],
    ...shell,
    ...extra,
  };
}

// Three generations: June+Arthur → Mary (+ adopted Tom); Mary+Sam → Ada.
const june = person("june", "June", { living: false });
const mary = person("mary", "Mary");
const grandUnion: Union = {
  ...union("u1", ["june", "arthur"], []),
  children: [{ personId: "mary", kind: "birth" }, { personId: "tom", kind: "adoptive" }],
};
const parentUnion = union("u2", ["mary", "sam"], ["ada"]);
const unions = [grandUnion, parentUnion];

describe("payload codecs", () => {
  it("round-trips a person through encode/decode", () => {
    const p = person("mary", "Mary", {
      names: [{ given: "Mary", family: "Hale", kind: "birth" }, { given: "Mary", family: "Poole", kind: "married" }],
      living: false,
      events: [{ kind: "birth", when: { time: Date.UTC(1931, 4, 2), precision: "day" }, place: "Galway" }],
      remembrance: "She sang while she cooked.",
      portraitId: "m1",
      author: "johnny",
    });
    const back = decodePerson(encodePerson(p), { id: "mary", ...shell });
    expect(back).toEqual(p);
  });

  it("round-trips a union and a keepsake", () => {
    const u = decodeUnion(encodeUnion(grandUnion), { id: "u1", ...shell });
    expect(u).toEqual(grandUnion);
    const k: Keepsake = {
      id: "k1",
      mediaId: "blob1",
      caption: "Letter home, 1944",
      transcription: "Dear June…",
      about: ["arthur", "june"],
      when: { time: Date.UTC(1944, 0), precision: "year" },
      ...shell,
    };
    expect(decodeKeepsake(encodeKeepsake(k), { id: "k1", ...shell })).toEqual(k);
  });

  it("decodes garbage and wrong-type payloads to empty-but-valid records", () => {
    for (const bad of ["not json", "{}", encodeUnion(grandUnion)]) {
      const p = decodePerson(bad, { id: "x", ...shell });
      expect(p.names).toEqual([]);
      expect(p.events).toEqual([]);
      expect(p.living).toBeUndefined();
    }
  });
});

describe("names and lifespans", () => {
  it("shows the first name, falling back gently", () => {
    expect(displayName(person("p", "June", { names: [{ given: "June", family: "Hale" }] }))).toBe("June Hale");
    expect(displayName({ ...person("p", ""), names: [] })).toBe("Someone");
  });

  it("prefers a name written out in full, and falls back to the pair", () => {
    expect(displayName(person("p", "x", { names: [{ full: "王偉", family: "王" }] }))).toBe("王偉");
    expect(displayName(person("p", "x", { names: [{ full: "Aristotle" }] }))).toBe("Aristotle");
    // A stale pair never shows through a full name, and vice versa.
    expect(displayName(person("p", "x", { names: [{ full: "Jón Einarsson", given: "old" }] }))).toBe("Jón Einarsson");
  });

  it("reads a birth family name only when it differs from the shown one", () => {
    expect(birthFamilyName([{ given: "Mary", family: "Poole" }, { given: "Mary", family: "Hale", kind: "birth" }])).toBe("Hale");
    // Shown under the name they were born with: nothing extra to say.
    expect(birthFamilyName([{ given: "Mary", family: "Hale", kind: "birth" }])).toBeUndefined();
    expect(birthFamilyName([{ given: "Mary" }])).toBeUndefined();
  });

  it("sets, updates and clears a birth family name without disturbing other names", () => {
    const shown = { given: "Mary", family: "Poole" };
    const aka = { given: "Molly", kind: "aka" as const };

    // Added: the birth entry lands after the shown name, borrowing its given.
    expect(withBirthFamilyName([shown, aka], " Hale ")).toEqual([shown, { given: "Mary", family: "Hale", kind: "birth" }, aka]);

    // Updated in place — the entry keeps its slot and its own given name.
    const withBorn = [shown, { given: "Máire", family: "Hale", kind: "birth" as const }, aka];
    expect(withBirthFamilyName(withBorn, "Hayle")).toEqual([shown, { given: "Máire", family: "Hayle", kind: "birth" }, aka]);

    // Cleared, or set to the name they already go by: the entry goes.
    expect(withBirthFamilyName(withBorn, "")).toEqual([shown, aka]);
    expect(withBirthFamilyName(withBorn, "Poole")).toEqual([shown, aka]);

    // Once the two differ, the shown name stops claiming to be the birth one.
    expect(withBirthFamilyName([{ given: "Mary", family: "Poole", kind: "birth" }], "Hale")).toEqual([
      { given: "Mary", family: "Poole", kind: undefined },
      { given: "Mary", family: "Hale", kind: "birth" },
    ]);

    expect(withBirthFamilyName([], "Hale")).toEqual([{ family: "Hale", kind: "birth" }]);
  });

  it("swaps the family part inside a full name, keeping its order and its other parts", () => {
    expect(withBirthFamilyName([{ full: "Mary Jane Poole", family: "Poole" }], "Hale")).toEqual([
      { full: "Mary Jane Poole", family: "Poole" },
      { full: "Mary Jane Hale", family: "Hale", kind: "birth" },
    ]);
    // Family name first: the swap happens where the name actually stands.
    expect(withBirthFamilyName([{ full: "王偉", family: "王" }], "李")).toEqual([
      { full: "王偉", family: "王" },
      { full: "李偉", family: "李", kind: "birth" },
    ]);
    // Nothing to swap into: the surname alone is still the whole answer.
    expect(withBirthFamilyName([{ full: "Aristotle" }], "Hale")).toEqual([
      { full: "Aristotle" },
      { family: "Hale", kind: "birth" },
    ]);
  });

  it("formats fuzzy whens with qualifier and precision", () => {
    expect(whenLabel({ time: Date.UTC(1885, 0), qualifier: "about" })).toBe("abt 1885");
    expect(whenLabel({ time: Date.UTC(1900, 0), qualifier: "before" })).toBe("bef 1900");
    expect(whenLabel({ time: Date.UTC(1931, 4, 2), precision: "day" })).toBe("2 May 1931");
    expect(whenLabel({ label: "during the war" })).toBe("during the war");
    expect(whenLabel(undefined)).toBe("");
  });

  it("never dangles a death dash for the living", () => {
    const born = person("p", "Ada", {
      events: [{ kind: "birth", when: { time: Date.UTC(1990, 0) } }],
    });
    expect(lifespanLabel(born)).toBe("1990");
    const passed = person("p", "June", {
      living: false,
      events: [
        { kind: "birth", when: { time: Date.UTC(1885, 0), qualifier: "about" } },
        { kind: "death", when: { time: Date.UTC(1962, 0) } },
      ],
    });
    expect(lifespanLabel(passed)).toBe("abt 1885 – 1962");
    expect(lifespanLabel(person("p", "Mary"))).toBe("");
  });
});

describe("walking the tree", () => {
  it("finds parents, children, partners and siblings through unions", () => {
    expect(parentsOf("mary", unions)).toEqual(["june", "arthur"]);
    expect(childrenOf("june", unions)).toEqual(["mary", "tom"]);
    expect(partnersOf("mary", unions)).toEqual(["sam"]);
    expect(siblingsOf("tom", unions)).toEqual(["mary"]);
  });

  it("treats adoptive children exactly like birth children in walks", () => {
    expect(parentsOf("tom", unions)).toEqual(["june", "arthur"]);
  });

  it("walks generations of ancestors and descendants", () => {
    expect(ancestorsOf("ada", unions)).toEqual([
      ["mary", "sam"],
      ["june", "arthur"],
    ]);
    expect(descendantsOf("june", unions)).toEqual([["mary", "tom"], ["ada"]]);
    expect(ancestorsOf("june", unions)).toEqual([]);
  });

  it("survives cyclic bad data without looping", () => {
    const cycle = [union("c1", ["a"], ["b"]), union("c2", ["b"], ["a"])];
    expect(ancestorsOf("a", cycle)).toEqual([["b"]]);
  });

  it("keeps unreferenced people visible on the unplaced shelf", () => {
    const drifter = person("d", "Dora");
    expect(unplaced([june, mary, drifter], unions)).toEqual([drifter]);
    expect(unplaced([june, mary], unions)).toEqual([]);
  });
});

describe("placing a relative", () => {
  const NOW = 9000;

  it("adds a partner to an open union rather than splitting the family", () => {
    const solo = union("u", ["mary"], ["ada"]);
    const [u] = linkRelative("mary", "sam", "partner", [solo], undefined, NOW);
    expect(u.id).toBe("u");
    expect(u.partnerIds).toEqual(["mary", "sam"]);
    expect(u.updatedAt).toBe(NOW);
    expect(solo.partnerIds).toEqual(["mary"]); // input untouched
  });

  it("starts a fresh partnership when the anchor's unions are full", () => {
    const [u] = linkRelative("mary", "leo", "partner", [union("u", ["mary", "sam"], [])], undefined, NOW);
    expect(u.id).not.toBe("u");
    expect(u.partnerIds).toEqual(["mary", "leo"]);
    expect(u.children).toEqual([]);
  });

  it("adds a child to the anchor's union, or makes a solo one", () => {
    const [joined] = linkRelative("mary", "ada", "child", [union("u", ["mary", "sam"], [])], "birth", NOW);
    expect(joined.children).toEqual([{ personId: "ada", kind: "birth" }]);
    const [made] = linkRelative("mary", "tom", "child", [], "adoptive", NOW);
    expect(made.partnerIds).toEqual(["mary"]);
    expect(made.children).toEqual([{ personId: "tom", kind: "adoptive" }]);
  });

  it("slots a second parent into the anchor's childhood union", () => {
    const childhood = union("u", ["june"], ["mary"]);
    const [u] = linkRelative("mary", "arthur", "parent", [childhood], undefined, NOW);
    expect(u.id).toBe("u");
    expect(u.partnerIds).toEqual(["june", "arthur"]);
    const [fresh] = linkRelative("mary", "june", "parent", [], "birth", NOW);
    expect(fresh.partnerIds).toEqual(["june"]);
    expect(fresh.children).toEqual([{ personId: "mary", kind: "birth" }]);
  });

  it("gives siblings the anchor's childhood union, partnerless if need be", () => {
    const [shared] = linkRelative("mary", "tom", "sibling", [union("u", ["june"], ["mary"])], "adoptive", NOW);
    expect(shared.id).toBe("u");
    expect(shared.children).toEqual([{ personId: "mary" }, { personId: "tom", kind: "adoptive" }]);
    const [orphaned] = linkRelative("mary", "tom", "sibling", [], undefined, NOW);
    expect(orphaned.partnerIds).toEqual([]);
    expect(orphaned.children.map((c) => c.personId)).toEqual(["mary", "tom"]);
  });
});

describe("removing a person", () => {
  const NOW = 9000;

  it("strips their links but leaves everyone else's places untouched", () => {
    const { upserts, emptied } = unlinkPerson("june", unions, NOW);
    expect(emptied).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].id).toBe("u1");
    expect(upserts[0].partnerIds).toEqual(["arthur"]);
    expect(upserts[0].children).toEqual(grandUnion.children);
    expect(upserts[0].updatedAt).toBe(NOW);
    expect(grandUnion.partnerIds).toContain("june"); // input untouched
  });

  it("reports a union left saying nothing so the caller can tombstone it", () => {
    const solo = union("s", ["dora"], []);
    const { upserts, emptied } = unlinkPerson("dora", [solo], NOW);
    expect(upserts).toEqual([]);
    expect(emptied).toEqual(["s"]);
  });

  it("removes them as child and partner across unions in one pass", () => {
    const { upserts } = unlinkPerson("mary", unions, NOW);
    expect(upserts.map((u) => u.id).sort()).toEqual(["u1", "u2"]);
    const u1 = upserts.find((u) => u.id === "u1")!;
    expect(u1.children.map((c) => c.personId)).toEqual(["tom"]);
    const u2 = upserts.find((u) => u.id === "u2")!;
    expect(u2.partnerIds).toEqual(["sam"]);
    expect(u2.children.map((c) => c.personId)).toEqual(["ada"]);
  });

  it("touches nothing when the person was never linked", () => {
    expect(unlinkPerson("stranger", unions, NOW)).toEqual({ upserts: [], emptied: [] });
  });
});

describe("year ↔ when helpers", () => {
  it("round-trips a year through a UTC calendar When", () => {
    const w = yearWhen(1885, "about");
    expect(w).toEqual({ time: Date.UTC(1885, 0, 1), precision: "year", qualifier: "about" });
    expect(whenYear(w)).toBe(1885);
    expect(yearWhen(undefined)).toBeUndefined();
    expect(whenYear(undefined)).toBeUndefined();
  });

  it("replaces an event's when but keeps its place and note", () => {
    const events = [{ kind: "birth" as const, when: yearWhen(1885), place: "Galway" }];
    const next = withEventWhen(events, "birth", yearWhen(1886));
    expect(next[0].place).toBe("Galway");
    expect(whenYear(next[0].when)).toBe(1886);
  });

  it("drops an event left saying nothing, keeps one that still speaks", () => {
    expect(withEventWhen([{ kind: "death", when: yearWhen(1962) }], "death", undefined)).toEqual([]);
    const kept = withEventWhen([{ kind: "death", when: yearWhen(1962), note: "at home" }], "death", undefined);
    expect(kept).toEqual([{ kind: "death", when: undefined, note: "at home" }]);
    expect(withEventWhen([], "death", undefined)).toEqual([]);
  });
});

describe("keepsakes", () => {
  it("gathers a person's keepsakes in lived-time order", () => {
    const later: Keepsake = { id: "k2", about: ["june"], when: { time: 500_000 }, ...shell };
    const early: Keepsake = { id: "k1", about: ["june", "arthur"], when: { time: 5 }, ...shell };
    const other: Keepsake = { id: "k3", about: ["ada"], ...shell };
    expect(keepsakesFor("june", [other, later, early]).map((k) => k.id)).toEqual(["k1", "k2"]);
  });
});
