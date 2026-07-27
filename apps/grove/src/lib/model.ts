// model.ts
// Pure, framework-free logic for the tree. Operates on decrypted records held
// in memory after the vault is unlocked. No React, no IO here — easy to test
// and reason about. (Same contract as Driftless's journal.ts.)

// ---- Fuzzy time ----------------------------------------------------------
// Genealogy dates are fuzzy in the normal case, not the edge case: "abt 1885",
// "before 1900", "during the war". This is Driftless's Anchor (a calendar
// point with a precision, or a free-text era) extended with a qualifier.
// At least one of `time` / `label` is set.
export type When = {
  time?: number; // epoch ms at the start of the period; the sort key
  precision?: "year" | "month" | "day";
  qualifier?: "about" | "before" | "after";
  label?: string; // free-text era, when there's no usable date
};

export function hasWhen(w: When | undefined): w is When {
  return !!w && (w.time !== undefined || !!w.label);
}

// ---- People --------------------------------------------------------------
// A person may carry several names across a life (birth name, married name,
// the name everyone actually called them). The first name is the display one.
export type Name = {
  given?: string;
  family?: string;
  kind?: "birth" | "married" | "aka";
};

export type LifeEvent = {
  kind: "birth" | "death" | "marriage" | "other";
  when?: When;
  place?: string;
  note?: string;
};

export type Person = {
  id: string;
  names: Name[];
  // Guards the minimal-entry ethic for people who haven't consented by
  // joining, and privatizes them on export. Undefined means unknown — treated
  // as living so the cautious path is the default.
  living?: boolean;
  events: LifeEvent[]; // birth/death here; marriage lives on the Union
  // Freeform: who they were, as the family remembers them. The point of the
  // whole app; the dates above are scaffolding for this.
  remembrance?: string;
  portraitId?: string; // encrypted media blob id
  createdAt: number;
  updatedAt: number;
  author?: string; // user id who wrote this revision (attribution, not score)
};

// ---- Unions --------------------------------------------------------------
// A union is a partnership: partners plus the children raised in it. Mirrors
// GEDCOM's FAM record so import/export maps cleanly. Child links are typed —
// families are made in more than one way and the model says so plainly.
export type ChildLink = {
  personId: string;
  kind?: "birth" | "adoptive" | "step" | "foster" | "guardian";
};

export type Union = {
  id: string;
  partnerIds: string[]; // usually two; the model doesn't insist
  children: ChildLink[];
  events: LifeEvent[]; // marriage and the like
  createdAt: number;
  updatedAt: number;
  author?: string;
};

// ---- Keepsakes -----------------------------------------------------------
// Evidence and treasure in one: a photo, a scanned letter, a document — plus
// what the family says about it. `about` ties it to the people (or unions)
// it belongs to. This is the genealogist's "source", framed as a keepsake:
// presented as itself, never counted.
export type Keepsake = {
  id: string;
  mediaId?: string; // encrypted blob (image or document scan)
  caption?: string;
  transcription?: string; // a letter's text, typed out so it can be read
  about: string[]; // person and/or union ids
  when?: When;
  createdAt: number;
  updatedAt: number;
  author?: string;
};

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- Encrypted payloads --------------------------------------------------
// What actually gets encrypted is a small versioned JSON document per record,
// so everything meaningful travels inside the ciphertext. Decoders are
// defensive: garbage in, empty-but-valid out — never a crash on old data.

export function encodePerson(p: Person): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = p;
  return JSON.stringify({ __tree: 1, t: "person", ...body });
}

export function encodeUnion(u: Union): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = u;
  return JSON.stringify({ __tree: 1, t: "union", ...body });
}

export function encodeKeepsake(k: Keepsake): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = k;
  return JSON.stringify({ __tree: 1, t: "keepsake", ...body });
}

type Shell = { id: string; createdAt: number; updatedAt: number };

export function decodePerson(decrypted: string, shell: Shell): Person {
  const o = parseTree(decrypted, "person");
  return {
    ...shell,
    names: Array.isArray(o.names) ? (o.names as Name[]) : [],
    living: typeof o.living === "boolean" ? o.living : undefined,
    events: Array.isArray(o.events) ? (o.events as LifeEvent[]) : [],
    remembrance: typeof o.remembrance === "string" ? o.remembrance : undefined,
    portraitId: typeof o.portraitId === "string" ? o.portraitId : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

export function decodeUnion(decrypted: string, shell: Shell): Union {
  const o = parseTree(decrypted, "union");
  return {
    ...shell,
    partnerIds: Array.isArray(o.partnerIds) ? (o.partnerIds as string[]) : [],
    children: Array.isArray(o.children) ? (o.children as ChildLink[]) : [],
    events: Array.isArray(o.events) ? (o.events as LifeEvent[]) : [],
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

export function decodeKeepsake(decrypted: string, shell: Shell): Keepsake {
  const o = parseTree(decrypted, "keepsake");
  return {
    ...shell,
    mediaId: typeof o.mediaId === "string" ? o.mediaId : undefined,
    caption: typeof o.caption === "string" ? o.caption : undefined,
    transcription: typeof o.transcription === "string" ? o.transcription : undefined,
    about: Array.isArray(o.about) ? (o.about as string[]) : [],
    when: o.when && typeof o.when === "object" ? (o.when as When) : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

function parseTree(decrypted: string, t: string): Record<string, unknown> {
  try {
    const o = JSON.parse(decrypted);
    if (o && o.__tree === 1 && o.t === t) return o as Record<string, unknown>;
  } catch {
    // fall through
  }
  return {};
}

// ---- Names & lifespans ---------------------------------------------------

export function displayName(p: Person): string {
  const n = p.names[0];
  const s = [n?.given, n?.family].filter(Boolean).join(" ").trim();
  return s || "Someone";
}

function eventOf(p: Person, kind: LifeEvent["kind"]): LifeEvent | undefined {
  return p.events.find((e) => e.kind === kind);
}

// "abt 1885 – 1962", "1890 –", "– bef 1900", or "" when nothing is known.
// A living person never shows an open death slot — no morbid dangling dash.
export function lifespanLabel(p: Person): string {
  const b = whenLabel(eventOf(p, "birth")?.when);
  const d = whenLabel(eventOf(p, "death")?.when);
  if (!b && !d) return "";
  if (p.living !== false && !d) return b;
  return `${b} – ${d}`.trim();
}

// A When is a calendar date, not an instant: "2 May 1931" must read the same
// in every timezone. So `time` is stored as UTC midnight of the calendar
// point and read back with UTC getters — never local ones.
export function whenLabel(w: When | undefined): string {
  if (!hasWhen(w)) return "";
  if (w.time === undefined) return w.label!;
  const d = new Date(w.time);
  const q = w.qualifier === "about" ? "abt " : w.qualifier === "before" ? "bef " : w.qualifier === "after" ? "aft " : "";
  const y = String(d.getUTCFullYear());
  if (!w.precision || w.precision === "year") return q + y;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const my = `${MONTHS[d.getUTCMonth()]} ${y}`;
  return q + (w.precision === "month" ? my : `${d.getUTCDate()} ${my}`);
}

// A year the UI collected → a When (UTC midnight of Jan 1, year precision,
// same calendar-date discipline as whenLabel), and back again.
export function yearWhen(year: number | undefined, qualifier?: When["qualifier"]): When | undefined {
  if (year === undefined || !Number.isFinite(year)) return undefined;
  return qualifier ? { time: Date.UTC(year, 0, 1), precision: "year", qualifier } : { time: Date.UTC(year, 0, 1), precision: "year" };
}

export function whenYear(w: When | undefined): number | undefined {
  return w?.time === undefined ? undefined : new Date(w.time).getUTCFullYear();
}

// Replace the `when` of a person's birth/death event, preserving whatever else
// the event carries (place, note). An event left saying nothing is dropped.
export function withEventWhen(events: LifeEvent[], kind: "birth" | "death", when: When | undefined): LifeEvent[] {
  const i = events.findIndex((e) => e.kind === kind);
  if (i === -1) return hasWhen(when) ? [...events, { kind, when }] : events;
  const next: LifeEvent = { ...events[i], when: hasWhen(when) ? when : undefined };
  if (!hasWhen(next.when) && !next.place && !next.note) return events.filter((_, j) => j !== i);
  return events.map((e, j) => (j === i ? next : e));
}

// ---- Walking the tree ----------------------------------------------------
// The graph is small (a family, not a social network) so walks are plain
// scans — no indexes until a real tree proves they're needed.

export function parentsOf(personId: string, unions: Union[]): string[] {
  const out: string[] = [];
  for (const u of unions) {
    if (u.children.some((c) => c.personId === personId)) {
      for (const p of u.partnerIds) if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export function childrenOf(personId: string, unions: Union[]): string[] {
  const out: string[] = [];
  for (const u of unions) {
    if (u.partnerIds.includes(personId)) {
      for (const c of u.children) if (!out.includes(c.personId)) out.push(c.personId);
    }
  }
  return out;
}

export function partnersOf(personId: string, unions: Union[]): string[] {
  const out: string[] = [];
  for (const u of unions) {
    if (u.partnerIds.includes(personId)) {
      for (const p of u.partnerIds) if (p !== personId && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

// Anyone who shares a union-as-child with this person — full, half, step and
// adoptive siblings alike. Distinctions live on the ChildLink if the UI ever
// wants them; the walk itself doesn't rank kinds of siblinghood.
export function siblingsOf(personId: string, unions: Union[]): string[] {
  const out: string[] = [];
  for (const u of unions) {
    if (u.children.some((c) => c.personId === personId)) {
      for (const c of u.children) {
        if (c.personId !== personId && !out.includes(c.personId)) out.push(c.personId);
      }
    }
  }
  return out;
}

// Breadth-first ancestor walk; returns ids grouped by generation (1 =
// parents, 2 = grandparents, …). Cycles (bad data) can't loop it — each id
// visits once.
export function ancestorsOf(personId: string, unions: Union[], maxGen = 32): string[][] {
  const seen = new Set<string>([personId]);
  const gens: string[][] = [];
  let frontier = [personId];
  for (let g = 0; g < maxGen && frontier.length; g++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const p of parentsOf(id, unions)) {
        if (!seen.has(p)) {
          seen.add(p);
          next.push(p);
        }
      }
    }
    if (next.length) gens.push(next);
    frontier = next;
  }
  return gens;
}

export function descendantsOf(personId: string, unions: Union[], maxGen = 32): string[][] {
  const seen = new Set<string>([personId]);
  const gens: string[][] = [];
  let frontier = [personId];
  for (let g = 0; g < maxGen && frontier.length; g++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of childrenOf(id, unions)) {
        if (!seen.has(c)) {
          seen.add(c);
          next.push(c);
        }
      }
    }
    if (next.length) gens.push(next);
    frontier = next;
  }
  return gens;
}

// ---- Placing a relative ---------------------------------------------------
// Where a new person attaches to the graph. Pure: takes the current unions,
// returns only the unions to upsert (fresh objects, inputs untouched). The
// caller persists them and the new person together, so a relative is added and
// placed in one gesture — never left invisible half-linked.

export type Relation = "parent" | "partner" | "child" | "sibling";

export function linkRelative(
  anchorId: string,
  newId: string,
  relation: Relation,
  unions: Union[],
  childKind?: ChildLink["kind"],
  now: number = Date.now()
): Union[] {
  const fresh = (partnerIds: string[], children: ChildLink[]): Union => ({
    id: uid(),
    partnerIds,
    children,
    events: [],
    createdAt: now,
    updatedAt: now,
  });

  switch (relation) {
    case "partner": {
      // Join an existing solo union (e.g. one made by adding a child first),
      // otherwise start a new partnership.
      const open = unions.find((u) => u.partnerIds.includes(anchorId) && u.partnerIds.length < 2);
      if (open) return [{ ...open, partnerIds: [...open.partnerIds, newId], updatedAt: now }];
      return [fresh([anchorId, newId], [])];
    }
    case "child": {
      const u = unions.find((x) => x.partnerIds.includes(anchorId));
      const link: ChildLink = { personId: newId, kind: childKind };
      if (u) return [{ ...u, children: [...u.children, link], updatedAt: now }];
      return [fresh([anchorId], [link])];
    }
    case "parent": {
      // Slot into the union the anchor is already a child of, if it has room;
      // otherwise a new union with the anchor as its child.
      const u = unions.find((x) => x.children.some((c) => c.personId === anchorId));
      if (u && u.partnerIds.length < 2) return [{ ...u, partnerIds: [...u.partnerIds, newId], updatedAt: now }];
      return [fresh([newId], [{ personId: anchorId, kind: childKind }])];
    }
    case "sibling": {
      // Share the anchor's childhood union; a partnerless union is a valid
      // sibling group when no parent has been recorded yet.
      const u = unions.find((x) => x.children.some((c) => c.personId === anchorId));
      const link: ChildLink = { personId: newId, kind: childKind };
      if (u) return [{ ...u, children: [...u.children, link], updatedAt: now }];
      return [fresh([], [{ personId: anchorId }, link])];
    }
  }
}

// The never-silently-dropped rule (same spirit as shared strands): a person
// no union references still appears — on the "unplaced" shelf — so a relative
// someone added is never invisible because a linking write lost a race.
export function unplaced(people: Person[], unions: Union[]): Person[] {
  const placed = new Set<string>();
  for (const u of unions) {
    for (const p of u.partnerIds) placed.add(p);
    for (const c of u.children) placed.add(c.personId);
  }
  return people.filter((p) => !placed.has(p.id));
}

export function keepsakesFor(id: string, keepsakes: Keepsake[]): Keepsake[] {
  return keepsakes
    .filter((k) => k.about.includes(id))
    .sort((a, b) => (a.when?.time ?? a.createdAt) - (b.when?.time ?? b.createdAt));
}
