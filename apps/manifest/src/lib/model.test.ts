import { describe, expect, it } from "vitest";
import {
  cloneList, decodeItem, decodeList, encodeItem, encodeList,
  fromMarkdown, itemsFor, nextPosition, remainingLabel, toMarkdown,
  type Checklist, type Item,
} from "./model";

const shell = { id: "x", createdAt: 1, updatedAt: 2 };

function item(over: Partial<Item>): Item {
  return {
    id: "i1", listId: "l1", text: "socks", checked: false, position: 1,
    createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("encode/decode", () => {
  it("round-trips a list and strips bookkeeping from the payload", () => {
    const l: Checklist = { id: "l1", title: "Boundary Waters", note: "late Aug", createdAt: 1, updatedAt: 2 };
    const payload = encodeList(l);
    expect(payload).not.toContain('"id"');
    expect(decodeList(payload, shell)).toEqual({ ...shell, title: "Boundary Waters", note: "late Aug", author: undefined });
  });

  it("round-trips an item, listId inside the ciphertext", () => {
    const i = item({ claimedBy: "sam@example.com", checked: true, position: 4 });
    const got = decodeItem(encodeItem(i), shell);
    expect(got.listId).toBe("l1");
    expect(got.text).toBe("socks");
    expect(got.checked).toBe(true);
    expect(got.claimedBy).toBe("sam@example.com");
    expect(got.position).toBe(4);
  });

  it("is defensive: garbage in, empty-but-valid out", () => {
    expect(decodeList("not json", shell).title).toBe("");
    expect(decodeItem('{"__manifest":1,"t":"list"}', shell).text).toBe("");
    expect(decodeItem('{"__manifest":1,"t":"item","position":"first"}', shell).position).toBe(0);
  });
});

describe("itemsFor ordering", () => {
  it("keeps still-to-gather first and settles checked to the bottom", () => {
    const items = [
      item({ id: "a", position: 1, checked: true }),
      item({ id: "b", position: 2 }),
      item({ id: "c", position: 3, checked: true }),
      item({ id: "d", position: 4 }),
      item({ id: "e", listId: "other" }),
    ];
    expect(itemsFor("l1", items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("nextPosition / remainingLabel", () => {
  it("appends after everything on the list", () => {
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([item({ position: 7 }), item({ position: 3 })])).toBe(8);
  });

  it("says what's left, never a percent", () => {
    expect(remainingLabel([])).toBe("");
    expect(remainingLabel([item({}), item({ checked: true })])).toBe("1 to go");
    expect(remainingLabel([item({ checked: true })])).toBe("packed");
  });
});

describe("cloneList — lists remember", () => {
  it("copies the knowledge, resets the state, mints fresh private ids", () => {
    const source: Checklist = { id: "l1", title: "North Shore", createdAt: 1, updatedAt: 1 };
    const items = [
      item({ id: "a", position: 2, checked: true, claimedBy: "sam@example.com" }),
      item({ id: "b", position: 1 }),
    ];
    const { list, items: fresh } = cloneList(source, items, "North Shore, again", 99);
    expect(list.id).not.toBe("l1");
    expect(list.title).toBe("North Shore, again");
    expect(fresh).toHaveLength(2);
    expect(fresh.map((i) => i.text)).toEqual(["socks", "socks"]);
    expect(fresh.every((i) => !i.checked && i.claimedBy === undefined && i.listId === list.id)).toBe(true);
    // order preserved from the source's reading order, positions re-numbered
    expect(fresh.map((i) => i.position)).toEqual([1, 2]);
    expect(fresh[0].id).not.toBe(fresh[1].id);
  });

  it("falls back to the source title when the new one is blank", () => {
    const source: Checklist = { id: "l1", title: "North Shore", createdAt: 1, updatedAt: 1 };
    expect(cloneList(source, [], "  ", 99).list.title).toBe("North Shore");
  });
});

describe("fromMarkdown", () => {
  it("round-trips its own export, minus claims", () => {
    const lists: Checklist[] = [{ id: "l1", title: "Cabin", note: "bring it all", createdAt: 1, updatedAt: 1 }];
    const md = toMarkdown(lists, [
      item({ id: "a", text: "stove", claimedBy: "sam@example.com" }),
      item({ id: "b", text: "matches", checked: true, position: 2 }),
    ]);
    const parsed = fromMarkdown(md);
    expect(parsed).toEqual([
      { title: "Cabin", note: "bring it all", items: [{ text: "stove", checked: false }, { text: "matches", checked: true }] },
    ]);
  });

  it("reads hand-written files tolerantly", () => {
    const parsed = fromMarkdown("# Trip\n\nsome note\n* [X] tent\n- [ ] rope\nnot an item\n\n## Empty one\n_(empty)_\n");
    expect(parsed).toEqual([
      { title: "Trip", note: "some note", items: [{ text: "tent", checked: true }, { text: "rope", checked: false }] },
      { title: "Empty one", items: [] },
    ]);
  });

  it("returns nothing for prose without headings or items", () => {
    expect(fromMarkdown("just words\nmore words")).toEqual([]);
  });
});

describe("toMarkdown", () => {
  it("writes readable checklists with claims as plain text", () => {
    const lists: Checklist[] = [{ id: "l1", title: "Cabin", createdAt: 1, updatedAt: 1 }];
    const md = toMarkdown(lists, [
      item({ id: "a", text: "stove", claimedBy: "sam@example.com" }),
      item({ id: "b", text: "matches", checked: true }),
    ]);
    expect(md).toContain("## Cabin");
    expect(md).toContain("- [ ] stove — sam@example.com");
    expect(md).toContain("- [x] matches");
  });
});
