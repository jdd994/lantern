// homes.ts — the registry of homes. A home is a whole world: its own connected
// brands, devices, rooms, scenes, automations, custom vibes, location, and
// rhythm — a separate IndexedDB database per home, switched in the header.
// The registry itself is tiny (names and ids) and lives in localStorage.
//
// The first home is special only in its storage names: it keeps the original
// "aura" database and the original preference keys, so everyone who already
// has an Aura simply finds their world renamed "Home" — nothing moves,
// nothing re-pairs. The same brand account may be connected in two homes
// (one Govee account can span houses); each home just assigns the devices
// that actually live there to its rooms.
import { closeHome } from "./db";

export type Home = { id: string; name: string; createdAt: number };

export const DEFAULT_HOME_ID = "default";
const LIST_KEY = "aura-homes";
const ACTIVE_KEY = "aura-active-home";

const uid = () => crypto.randomUUID();

// The storage is injectable so the pure logic is unit-testable; every caller
// in the app just uses the default.
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // private mode — a single unnamed home, not a crash
  }
};

export function listHomes(s: Store | null = store()): Home[] {
  try {
    const raw = s?.getItem(LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Home[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* fall through to the default */
  }
  return [{ id: DEFAULT_HOME_ID, name: "Home", createdAt: 0 }];
}

function saveHomes(homes: Home[], s: Store | null = store()): void {
  try {
    s?.setItem(LIST_KEY, JSON.stringify(homes));
  } catch {
    /* private mode */
  }
}

export function activeHomeId(s: Store | null = store()): string {
  try {
    const id = s?.getItem(ACTIVE_KEY);
    if (id && listHomes(s).some((h) => h.id === id)) return id;
  } catch {
    /* fall through */
  }
  return listHomes(s)[0].id;
}

export function setActiveHome(id: string, s: Store | null = store()): void {
  try {
    s?.setItem(ACTIVE_KEY, id);
  } catch {
    /* private mode */
  }
}

export function addHome(name: string, s: Store | null = store()): Home {
  const home: Home = { id: uid(), name: name.trim() || "New home", createdAt: Date.now() };
  saveHomes([...listHomes(s), home], s);
  return home;
}

export function renameHome(id: string, name: string, s: Store | null = store()): void {
  saveHomes(
    listHomes(s).map((h) => (h.id === id ? { ...h, name: name.trim() || h.name } : h)),
    s
  );
}

// Removes the home from the registry (never the last one) and returns the list.
// Deleting its actual data is deleteHomeData below — a separate, deliberate call.
export function removeHome(id: string, s: Store | null = store()): Home[] {
  const homes = listHomes(s);
  if (homes.length <= 1) return homes;
  const next = homes.filter((h) => h.id !== id);
  saveHomes(next, s);
  if (activeHomeId(s) === id) setActiveHome(next[0].id, s);
  return next;
}

// The first home keeps the original database name and preference keys — see
// the header comment. Every later home gets namespaced ones.
export function dbNameFor(homeId: string): string {
  return homeId === DEFAULT_HOME_ID ? "aura" : `aura-h-${homeId}`;
}

export function homeKey(base: string, homeId: string): string {
  return homeId === DEFAULT_HOME_ID ? base : `${base}:${homeId}`;
}

// Erase a removed home's world: its database and its namespaced preferences.
// The open connection must be closed first or deleteDatabase blocks forever.
export async function deleteHomeData(homeId: string): Promise<void> {
  try {
    await closeHome(dbNameFor(homeId));
    indexedDB.deleteDatabase(dbNameFor(homeId));
  } catch {
    /* already gone */
  }
  try {
    for (const base of ["aura-geo", "aura-rhythm"]) {
      localStorage.removeItem(homeKey(base, homeId));
    }
  } catch {
    /* private mode */
  }
}
