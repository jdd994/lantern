import { describe, expect, it } from "vitest";
import { dateToWhen, fromGedcom, toGedcom, whenToDate } from "./gedcom";
import { displayName, type Keepsake, type Person, type Union } from "./model";

const shell = { createdAt: 1000, updatedAt: 2000 };
const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};

const june: Person = {
  id: "june",
  names: [{ given: "June", family: "Hale" }, { given: "June", family: "Poole", kind: "married" }],
  living: false,
  sex: "F",
  events: [
    { kind: "birth", when: { time: Date.UTC(1931, 4, 2), precision: "day" }, place: "Galway" },
    { kind: "death", when: { time: Date.UTC(1996, 0, 1), precision: "year", qualifier: "about" } },
  ],
  remembrance: "She sang while she cooked.\nAlways Puccini.",
  ...shell,
};
const arthur: Person = { id: "arthur", names: [{ given: "Arthur", family: "Hale" }], living: false, sex: "M", events: [], ...shell };
const tom: Person = { id: "tom", names: [{ given: "Tom", family: "Hale" }], living: true, events: [], ...shell };
const grand: Union = {
  id: "u1",
  partnerIds: ["arthur", "june"],
  children: [{ personId: "tom", kind: "adoptive" }],
  events: [{ kind: "marriage", when: { time: Date.UTC(1950, 5, 1), precision: "month" }, place: "Sligo" }],
  ...shell,
};
const letter: Keepsake = {
  id: "k1",
  caption: "Letter home, 1944",
  transcription: "Dear June, the winters here are long…",
  about: ["june"],
  when: { time: Date.UTC(1944, 0, 1), precision: "year" },
  ...shell,
};

describe("dates", () => {
  it("writes fuzzy whens as GEDCOM dates", () => {
    expect(whenToDate({ time: Date.UTC(1885, 0), qualifier: "about" })).toBe("ABT 1885");
    expect(whenToDate({ time: Date.UTC(1931, 4, 2), precision: "day" })).toBe("2 MAY 1931");
    expect(whenToDate({ time: Date.UTC(1950, 5), precision: "month" })).toBe("JUN 1950");
    expect(whenToDate({ label: "during the war" })).toBe("(during the war)");
    expect(whenToDate(undefined)).toBeUndefined();
  });

  it("reads GEDCOM dates back into whens, keeping words it can't parse", () => {
    expect(dateToWhen("ABT 1885")).toEqual({ time: Date.UTC(1885, 0, 1), precision: "year", qualifier: "about" });
    expect(dateToWhen("BEF 1900")).toEqual({ time: Date.UTC(1900, 0, 1), precision: "year", qualifier: "before" });
    expect(dateToWhen("2 MAY 1931")).toEqual({ time: Date.UTC(1931, 4, 2), precision: "day" });
    expect(dateToWhen("MAY 1931")).toEqual({ time: Date.UTC(1931, 4, 1), precision: "month" });
    expect(dateToWhen("BET 1850 AND 1860")).toEqual({ time: Date.UTC(1850, 0, 1), precision: "year", qualifier: "about" });
    expect(dateToWhen("(during the war)")).toEqual({ label: "during the war" });
    expect(dateToWhen("SOMEDAY SOON")).toEqual({ label: "SOMEDAY SOON" });
    expect(dateToWhen(undefined)).toBeUndefined();
  });
});

describe("round trip", () => {
  const text = toGedcom({ people: [june, arthur, tom], unions: [grand], keepsakes: [letter] }, { privatizeLiving: false });
  const back = fromGedcom(text, counter(), 5000);
  const byName = (n: string) => back.people.find((p) => displayName(p) === n)!;

  it("keeps people: names with types, sex pass-through, events, remembrance", () => {
    expect(back.people).toHaveLength(3);
    const j = byName("June Hale");
    expect(j.names).toEqual([
      { given: "June", family: "Hale" },
      { given: "June", family: "Poole", kind: "married" },
    ]);
    expect(j.sex).toBe("F");
    expect(j.living).toBe(false);
    expect(j.events).toEqual(june.events);
    expect(j.remembrance).toBe("She sang while she cooked.\nAlways Puccini.");
  });

  it("keeps 'passed, details unknown' via DEAT Y", () => {
    const a = byName("Arthur Hale"); // living: false, no death event
    expect(text).toMatch(/1 DEAT Y/);
    expect(a.living).toBe(false);
  });

  it("keeps unions: partners, typed child links, marriage", () => {
    expect(back.unions).toHaveLength(1);
    const u = back.unions[0];
    expect(u.partnerIds.map((id) => displayName(back.people.find((p) => p.id === id)!)).sort())
      .toEqual(["Arthur Hale", "June Hale"]);
    expect(u.children).toEqual([{ personId: byName("Tom Hale").id, kind: "adoptive" }]);
    expect(u.events).toEqual(grand.events);
  });

  it("keeps keepsakes as sources, tied back to their people", () => {
    expect(back.keepsakes).toHaveLength(1);
    const k = back.keepsakes[0];
    expect(k.caption).toBe("Letter home, 1944");
    expect(k.transcription).toBe("Dear June, the winters here are long…");
    expect(k.when).toEqual(letter.when);
    expect(k.about).toEqual([byName("June Hale").id]);
  });
});

describe("privatizing the living (the default)", () => {
  const secret: Keepsake = { id: "k2", caption: "Tom's photo", about: ["tom"], ...shell };
  const text = toGedcom({ people: [june, tom], unions: [grand], keepsakes: [letter, secret] });

  it("exports a living person as structure only", () => {
    expect(text).toContain("1 NAME Living");
    expect(text).not.toContain("Tom");
    // June passed — her record travels whole.
    expect(text).toContain("June /Hale/");
    expect(text).toContain("2 MAY 1931");
  });

  it("keeps a living person's place in the family", () => {
    const back = fromGedcom(text, counter(), 5000);
    const u = back.unions[0];
    expect(u.children).toHaveLength(1); // still June's child, name withheld
    expect(u.children[0].kind).toBeUndefined(); // pedigree withheld too
  });

  it("withholds keepsakes about the living, keeps the rest", () => {
    expect(text).toContain("Letter home, 1944");
    expect(text).not.toContain("Tom's photo");
  });
});

describe("a foreign file (the Ancestry on-ramp)", () => {
  const foreign = [
    "0 HEAD",
    "1 SOUR AncestryLike",
    "1 CHAR UTF-8",
    "0 @I1@ INDI",
    "1 NAME Mary Anne /O'Brien/",
    "2 TYPE birth",
    "1 NAME Mary /Poole/",
    "2 TYPE married",
    "1 SEX F",
    "1 BIRT",
    "2 DATE ABT. 1885",
    "2 PLAC County Clare, Ireland",
    "1 DEAT",
    "1 NOTE She crossed in 1904 with one trunk",
    "2 CONC  and her mother's ring.",
    "2 CONT Nobody ever heard her complain.",
    "1 FAMC @F7@",
    "2 PEDI adopted",
    "0 @I2@ INDI",
    "1 NAME Patrick /O'Brien/",
    "1 SEX M",
    "0 @F7@ FAM",
    "1 HUSB @I2@",
    "1 CHIL @I1@",
    "1 MARR",
    "2 DATE 12 JUN 1880",
    "0 TRLR",
  ].join("\r\n");
  const back = fromGedcom(foreign, counter(), 5000);

  it("reads people, CONC/CONC notes, and pedigree from the child's side", () => {
    expect(back.people).toHaveLength(2);
    const mary = back.people.find((p) => p.names[0]?.family === "O'Brien" && p.sex === "F")!;
    expect(mary.names).toEqual([
      { given: "Mary Anne", family: "O'Brien", kind: "birth" },
      { given: "Mary", family: "Poole", kind: "married" },
    ]);
    expect(mary.living).toBe(false); // a bare DEAT still means they passed
    expect(mary.events).toContainEqual({
      kind: "birth",
      when: { time: Date.UTC(1885, 0, 1), precision: "year", qualifier: "about" },
      place: "County Clare, Ireland",
    });
    expect(mary.remembrance).toBe(
      "She crossed in 1904 with one trunk and her mother's ring.\nNobody ever heard her complain."
    );
  });

  it("builds the union with the adopted link", () => {
    expect(back.unions).toHaveLength(1);
    const u = back.unions[0];
    expect(u.partnerIds).toHaveLength(1);
    expect(u.children[0].kind).toBe("adoptive");
    expect(u.events[0]).toEqual({ kind: "marriage", when: { time: Date.UTC(1880, 5, 12), precision: "day" } });
  });

  it("survives garbage without throwing", () => {
    expect(fromGedcom("not gedcom at all\n<<<>>>", counter(), 1).people).toEqual([]);
    expect(fromGedcom("", counter(), 1).people).toEqual([]);
  });
});
