// The anchor logic, pinned: a #tag is an anchor to a moment, and the promise
// is that tapping, gathering, and rendering all agree on what a tag is —
// splitTagged and extractTags speak the same regex, and this is where that
// stays true.
import { describe, expect, it } from "vitest";
import {
  allTags,
  extractTags,
  filterEntries,
  splitTagged,
  type Entry,
} from "./journal";

const entry = (text: string, createdAt: number): Entry => ({
  id: `e${createdAt}`,
  text,
  createdAt,
  updatedAt: createdAt,
});

describe("extractTags", () => {
  it("finds tags at the start, middle, and end of a thought", () => {
    expect(extractTags("#mom said the funniest thing")).toEqual(["mom"]);
    expect(extractTags("walked the ridge #trail today")).toEqual(["trail"]);
    expect(extractTags("first steps #firstword")).toEqual(["firstword"]);
  });

  it("lowercases and dedupes", () => {
    expect(extractTags("#Mom and #MOM and #mom")).toEqual(["mom"]);
  });

  it("requires a word boundary — an email or mid-word # is not a tag", () => {
    expect(extractTags("me@example.com#anchor no")).toEqual([]);
    expect(extractTags("width#tag nope")).toEqual([]);
  });

  it("stops at punctuation", () => {
    expect(extractTags("thinking of #mom.")).toEqual(["mom"]);
  });
});

describe("splitTagged", () => {
  it("round-trips: the segments joined are exactly the original text", () => {
    const texts = [
      "#mom said the funniest thing",
      "walked the ridge #trail today, thinking of #mom.",
      "no tags here at all",
      "#a #b #c",
      "",
    ];
    for (const t of texts) {
      expect(splitTagged(t).map((s) => s.text).join("")).toBe(t);
    }
  });

  it("marks tag segments and leaves prose unmarked", () => {
    const segs = splitTagged("tea with #mom on the porch");
    expect(segs).toEqual([
      { text: "tea with " },
      { text: "#mom", tag: "mom" },
      { text: " on the porch" },
    ]);
  });

  it("catches a tag at the very start (the old renderer missed this)", () => {
    expect(splitTagged("#mom stories")[0]).toEqual({ text: "#mom", tag: "mom" });
  });

  it("keeps the boundary space with the prose, not the anchor", () => {
    expect(splitTagged("a #b")).toEqual([{ text: "a " }, { text: "#b", tag: "b" }]);
  });

  it("lowercases the tag key but preserves the written text", () => {
    const [seg] = splitTagged("#Mom");
    expect(seg.text).toBe("#Mom");
    expect(seg.tag).toBe("mom");
  });
});

describe("allTags", () => {
  it("orders by recency of last use, not by count", () => {
    const entries = [
      entry("#often one", 1),
      entry("#often two", 2),
      entry("#often three", 3),
      entry("#recent once", 10),
    ];
    expect(allTags(entries)).toEqual(["recent", "often"]);
  });

  it("breaks recency ties alphabetically", () => {
    expect(allTags([entry("#b #a", 5)])).toEqual(["a", "b"]);
  });
});

describe("shared-strand gathering", () => {
  // SharedPiece rides the same helpers structurally (id/text/createdAt/
  // updatedAt). This pins that compatibility: if Entry grows a required field,
  // this breaks loudly instead of shared gathering breaking quietly. The
  // audience rule itself — a gather never mixes rooms — lives in SharedView,
  // which only ever hands these helpers its own strand's pieces.
  it("tag helpers accept piece-shaped records", () => {
    const pieces = [
      { id: "p1", text: "the lake trip #grandma", createdAt: 1, updatedAt: 1, author: "u1" },
      { id: "p2", text: "her bread recipe #grandma #kitchen", createdAt: 2, updatedAt: 2, author: "u2" },
    ];
    expect(allTags(pieces)).toEqual(["grandma", "kitchen"]);
    expect(pieces.filter((p) => extractTags(p.text).includes("grandma")).map((p) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
  });
});

describe("filterEntries", () => {
  const entries = [
    entry("tea with #mom", 1),
    entry("ridge walk #trail", 2),
    entry("#mom's garden, planning the beds", 3),
  ];

  it("gathers a tag's moments, newest first", () => {
    const got = filterEntries(entries, "", "mom");
    expect(got.map((e) => e.createdAt)).toEqual([3, 1]);
  });

  it("narrows a gathered tag with a query", () => {
    const got = filterEntries(entries, "garden", "mom");
    expect(got.map((e) => e.createdAt)).toEqual([3]);
  });

  it("searches case-insensitively", () => {
    expect(filterEntries(entries, "RIDGE", null)).toHaveLength(1);
  });
});
