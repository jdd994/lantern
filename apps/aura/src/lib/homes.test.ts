import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_ID,
  activeHomeId,
  addHome,
  dbNameFor,
  homeKey,
  listHomes,
  removeHome,
  renameHome,
  setActiveHome,
} from "./homes";

// An in-memory Storage so the registry logic tests without a browser.
function memStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("homes registry", () => {
  it("starts with a single home named Home", () => {
    const s = memStore();
    const homes = listHomes(s);
    expect(homes).toHaveLength(1);
    expect(homes[0].id).toBe(DEFAULT_HOME_ID);
    expect(homes[0].name).toBe("Home");
    expect(activeHomeId(s)).toBe(DEFAULT_HOME_ID);
  });

  it("adds, renames, switches, and removes", () => {
    const s = memStore();
    const cabin = addHome("The cabin", s);
    expect(listHomes(s).map((h) => h.name)).toEqual(["Home", "The cabin"]);
    setActiveHome(cabin.id, s);
    expect(activeHomeId(s)).toBe(cabin.id);
    renameHome(cabin.id, "Lakeside", s);
    expect(listHomes(s).find((h) => h.id === cabin.id)?.name).toBe("Lakeside");
    removeHome(cabin.id, s);
    expect(listHomes(s)).toHaveLength(1);
    // The active home fell back to one that still exists.
    expect(activeHomeId(s)).toBe(DEFAULT_HOME_ID);
  });

  it("never removes the last home", () => {
    const s = memStore();
    expect(removeHome(DEFAULT_HOME_ID, s)).toHaveLength(1);
  });

  it("keeps the first home on the original database and preference keys", () => {
    expect(dbNameFor(DEFAULT_HOME_ID)).toBe("aura");
    expect(homeKey("aura-geo", DEFAULT_HOME_ID)).toBe("aura-geo");
    expect(dbNameFor("abc")).toBe("aura-h-abc");
    expect(homeKey("aura-geo", "abc")).toBe("aura-geo:abc");
  });

  it("falls back to the first home when the stored active id is gone", () => {
    const s = memStore();
    setActiveHome("no-such-home", s);
    expect(activeHomeId(s)).toBe(DEFAULT_HOME_ID);
  });
});
