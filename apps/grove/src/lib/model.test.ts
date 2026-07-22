import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
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
  parentsOf,
  partnersOf,
  siblingsOf,
  unplaced,
  whenLabel,
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

describe("keepsakes", () => {
  it("gathers a person's keepsakes in lived-time order", () => {
    const later: Keepsake = { id: "k2", about: ["june"], when: { time: 500_000 }, ...shell };
    const early: Keepsake = { id: "k1", about: ["june", "arthur"], when: { time: 5 }, ...shell };
    const other: Keepsake = { id: "k3", about: ["ada"], ...shell };
    expect(keepsakesFor("june", [other, later, early]).map((k) => k.id)).toEqual(["k1", "k2"]);
  });
});
