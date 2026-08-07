// gedcom.ts
// GEDCOM 5.5.1 import/export — the informed-trade-offs principle applied to a
// family's history: portable, never hostage, and the honest on-ramp for
// someone arriving from Ancestry with twenty years of research.
//
// Mapping (per PLAN.md): INDI ↔ person, FAM ↔ union, SOUR ↔ keepsake (a
// keepsake exports as a titled source with its transcription; the scan itself
// stays in Grove — pixels don't fit in a GEDCOM, words do).
//
// Two stances enforced here, not merely suggested:
//   • Export privatizes living people BY DEFAULT (name → "Living", no dates,
//     no remembrance, no sources — structure only). Standard genealogy
//     ethics; the caller can only opt out deliberately.
//   • Partners are partners. GEDCOM's HUSB/WIFE slots are filled from the
//     pass-through `sex` field when it's known, positionally when it isn't,
//     and nothing is ever inferred.
//
// Pure and IO-free: strings in, records out, injected id generation so tests
// are deterministic.

import {
  hasWhen,
  uid,
  type ChildLink,
  type Keepsake,
  type LifeEvent,
  type Name,
  type Person,
  type Union,
  type When,
} from "./model";

export type GedcomTree = { people: Person[]; unions: Union[]; keepsakes: Keepsake[] };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ---- When ↔ GEDCOM DATE ----------------------------------------------------
// "abt 1885" is the normal case; a date that won't parse survives as a phrase
// in parentheses (GEDCOM's own escape hatch for "during the war").

export function whenToDate(w: When | undefined): string | undefined {
  if (!hasWhen(w)) return undefined;
  if (w.time === undefined) return `(${w.label})`;
  const d = new Date(w.time);
  const q = w.qualifier === "about" ? "ABT " : w.qualifier === "before" ? "BEF " : w.qualifier === "after" ? "AFT " : "";
  const y = String(d.getUTCFullYear());
  if (!w.precision || w.precision === "year") return q + y;
  const my = `${MONTHS[d.getUTCMonth()]} ${y}`;
  return q + (w.precision === "month" ? my : `${d.getUTCDate()} ${my}`);
}

export function dateToWhen(s: string | undefined): When | undefined {
  if (!s) return undefined;
  let t = s.trim();
  if (!t) return undefined;
  const phrase = t.match(/^\((.*)\)$/);
  if (phrase) return phrase[1].trim() ? { label: phrase[1].trim() } : undefined;

  let qualifier: When["qualifier"];
  const q = t.match(/^(ABT|EST|CAL|BEF|AFT)\.?\s+(.*)$/i);
  if (q) {
    const tag = q[1].toUpperCase();
    qualifier = tag === "BEF" ? "before" : tag === "AFT" ? "after" : "about";
    t = q[2].trim();
  }
  // Ranges/periods (BET x AND y, FROM x TO y): keep the first calendar point,
  // soften to "about" — an approximation is honest, silence isn't.
  const range = t.match(/^(?:BET|BETWEEN|FROM)\s+(.+?)\s+(?:AND|TO)\s+.+$/i);
  if (range) {
    qualifier = qualifier ?? "about";
    t = range[1].trim();
  }

  const dmy = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{3,4})$/);
  if (dmy) {
    const m = MONTHS.indexOf(dmy[2].slice(0, 3).toUpperCase());
    if (m >= 0) return pick({ time: Date.UTC(Number(dmy[3]), m, Number(dmy[1])), precision: "day" }, qualifier);
  }
  const my = t.match(/^([A-Za-z]{3,})\.?\s+(\d{3,4})$/);
  if (my) {
    const m = MONTHS.indexOf(my[1].slice(0, 3).toUpperCase());
    if (m >= 0) return pick({ time: Date.UTC(Number(my[2]), m, 1), precision: "month" }, qualifier);
  }
  const y = t.match(/^(\d{3,4})$/);
  if (y) return pick({ time: Date.UTC(Number(y[1]), 0, 1), precision: "year" }, qualifier);

  // Unparseable — keep the words rather than lose them.
  return { label: s.trim() };
}

function pick(w: When, qualifier: When["qualifier"]): When {
  return qualifier ? { ...w, qualifier } : w;
}

// ---- child-link kinds ↔ PEDI -----------------------------------------------
// GEDCOM 5.5.1 PEDI knows adopted/birth/foster; step and guardian ride a
// custom _PEDI so the standard field is never polluted and nothing is lost.

const PEDI_OUT: Partial<Record<NonNullable<ChildLink["kind"]>, { tag: "PEDI" | "_PEDI"; value: string }>> = {
  birth: { tag: "PEDI", value: "birth" },
  adoptive: { tag: "PEDI", value: "adopted" },
  foster: { tag: "PEDI", value: "foster" },
  step: { tag: "_PEDI", value: "step" },
  guardian: { tag: "_PEDI", value: "guardian" },
};

function pediToKind(value: string): ChildLink["kind"] {
  const v = value.trim().toLowerCase();
  if (v === "adopted" || v === "adoptive") return "adoptive";
  if (v === "foster" || v === "sealing") return "foster";
  if (v === "step") return "step";
  if (v === "guardian") return "guardian";
  if (v === "birth") return "birth";
  return undefined;
}

// ---- export -----------------------------------------------------------------

export type ExportOptions = {
  // Living people (living !== false — unknown is treated as living, the
  // cautious default) export as structure only. Opting out is deliberate.
  privatizeLiving?: boolean;
};

export function toGedcom(tree: GedcomTree, opts: ExportOptions = {}): string {
  const privatize = opts.privatizeLiving !== false;
  const lines: string[] = [];
  const put = (level: number, tag: string, value?: string) => {
    if (value === undefined || value === "") {
      lines.push(`${level} ${tag}`);
      return;
    }
    // Multi-line values continue with CONT — a remembrance keeps its shape.
    const parts = value.split("\n");
    lines.push(`${level} ${tag} ${parts[0]}`);
    for (const rest of parts.slice(1)) lines.push(`${level + 1} CONT ${rest}`);
  };

  const iRef = new Map(tree.people.map((p, i) => [p.id, `@I${i + 1}@`]));
  const fRef = new Map(tree.unions.map((u, i) => [u.id, `@F${i + 1}@`]));
  const exportedKeepsakes = tree.keepsakes.filter(
    (k) => (k.caption || k.transcription) && (!privatize || !k.about.some((id) => isLiving(tree.people, id)))
  );
  const sRef = new Map(exportedKeepsakes.map((k, i) => [k.id, `@S${i + 1}@`]));

  put(0, "HEAD");
  put(1, "SOUR", "Grove");
  put(1, "GEDC");
  put(2, "VERS", "5.5.1");
  put(2, "FORM", "LINEAGE-LINKED");
  put(1, "CHAR", "UTF-8");

  for (const p of tree.people) {
    const ref = iRef.get(p.id)!;
    lines.push(`0 ${ref} INDI`);
    const priv = privatize && p.living !== false;
    if (priv) {
      // Structure only: they exist and they're connected. Nothing else about
      // a living person leaves without their say.
      put(1, "NAME", "Living");
    } else {
      const names = p.names.length ? p.names : [{}];
      names.forEach((n: Name, idx) => {
        put(1, "NAME", nameValue(n));
        // A full name whose family part can't be found inside it still says
        // which name is the family one, in the subtag made for exactly that.
        if (n.full && n.family && !n.full.includes(n.family)) put(2, "SURN", n.family);
        const type = n.kind === "married" ? "married" : n.kind === "aka" ? "aka" : idx > 0 ? "aka" : undefined;
        if (type) put(2, "TYPE", type);
      });
      if (p.sex) put(1, "SEX", p.sex);
      for (const e of p.events) {
        if (e.kind !== "birth" && e.kind !== "death") continue;
        put(1, e.kind === "birth" ? "BIRT" : "DEAT");
        const date = whenToDate(e.when);
        if (date) put(2, "DATE", date);
        if (e.place) put(2, "PLAC", e.place);
        if (e.note) put(2, "NOTE", e.note);
      }
      // Passed, but no death event recorded: GEDCOM's "DEAT Y" says exactly
      // that — it happened, details unknown — so the fact survives the trip.
      if (p.living === false && !p.events.some((e) => e.kind === "death")) put(1, "DEAT", "Y");
      if (p.remembrance) put(1, "NOTE", p.remembrance);
      for (const k of exportedKeepsakes) {
        if (k.about.includes(p.id)) put(1, "SOUR", sRef.get(k.id)!);
      }
    }
    for (const u of tree.unions) {
      if (u.partnerIds.includes(p.id)) put(1, "FAMS", fRef.get(u.id)!);
      const link = u.children.find((c) => c.personId === p.id);
      if (link) {
        put(1, "FAMC", fRef.get(u.id)!);
        const pedi = link.kind ? PEDI_OUT[link.kind] : undefined;
        if (pedi && !priv) put(2, pedi.tag, pedi.value);
      }
    }
  }

  for (const u of tree.unions) {
    lines.push(`0 ${fRef.get(u.id)!} FAM`);
    // HUSB/WIFE are GEDCOM's slots, not Grove's: fill by pass-through sex
    // when known, positionally when not. Partners are partners.
    const slots: Array<"HUSB" | "WIFE"> = [];
    for (const pid of u.partnerIds) {
      const sex = tree.people.find((p) => p.id === pid)?.sex?.toUpperCase();
      let slot: "HUSB" | "WIFE" =
        sex === "M" && !slots.includes("HUSB") ? "HUSB"
        : sex === "F" && !slots.includes("WIFE") ? "WIFE"
        : !slots.includes("HUSB") ? "HUSB" : "WIFE";
      slots.push(slot);
      put(1, slot, iRef.get(pid));
    }
    for (const c of u.children) {
      const ref = iRef.get(c.personId);
      if (ref) put(1, "CHIL", ref);
    }
    const marriage = u.events.find((e) => e.kind === "marriage");
    if (marriage) {
      put(1, "MARR");
      const date = whenToDate(marriage.when);
      if (date) put(2, "DATE", date);
      if (marriage.place) put(2, "PLAC", marriage.place);
    }
  }

  for (const k of exportedKeepsakes) {
    lines.push(`0 ${sRef.get(k.id)!} SOUR`);
    if (k.caption) put(1, "TITL", k.caption);
    if (k.transcription) put(1, "TEXT", k.transcription);
    const date = whenToDate(k.when);
    if (date) put(1, "_WHEN", date);
  }

  put(0, "TRLR");
  return lines.join("\n") + "\n";
}

function isLiving(people: Person[], id: string): boolean {
  const p = people.find((x) => x.id === id);
  return !!p && p.living !== false;
}

// ---- import -----------------------------------------------------------------

type GLine = { level: number; xref?: string; tag: string; value: string };
type GNode = GLine & { children: GNode[] };

function parseLines(text: string): GLine[] {
  const out: GLine[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^﻿/, "");
    if (!line.trim()) continue;
    const m = line.match(/^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/);
    if (!m) continue; // a malformed line loses itself, never the file
    out.push({ level: Number(m[1]), xref: m[2], tag: m[3].toUpperCase(), value: m[4] ?? "" });
  }
  return out;
}

function buildNodes(lines: GLine[]): GNode[] {
  const roots: GNode[] = [];
  const stack: GNode[] = [];
  for (const line of lines) {
    const node: GNode = { ...line, children: [] };
    while (stack.length > line.level) stack.pop();
    if (line.level === 0) roots.push(node);
    else stack[line.level - 1]?.children.push(node);
    stack[line.level] = node;
  }
  return roots;
}

// A node's value plus its CONT/CONC continuations (CONT = newline, CONC = splice).
function textOf(node: GNode): string {
  let s = node.value;
  for (const c of node.children) {
    if (c.tag === "CONT") s += "\n" + c.value;
    else if (c.tag === "CONC") s += c.value;
  }
  return s;
}

// The whole name, with the surname slash-marked where it actually stands —
// so an order that isn't fore-names-then-surname survives the trip out.
function nameValue(n: Name): string {
  if (n.full) return n.family && n.full.includes(n.family) ? n.full.replace(n.family, `/${n.family}/`) : n.full;
  return `${n.given ?? ""} /${n.family ?? ""}/`.trim();
}

function child(node: GNode, tag: string): GNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

// GEDCOM writes the whole name in its own order and marks the surname inside
// it with slashes, wherever it falls: "Mary Jane /Poole/", but equally
// "/Wang/ Wei" or "Martin Luther /King/ Jr.". So the surname is read where it
// stands and everything around it keeps its place. A name that is plainly
// fore-names-then-surname stays in the given/family pair the rest of the app
// grew up on; only a name that pair can't hold reaches for `full`.
function parseName(value: string, surn?: string): Name {
  const m = value.match(/^([^/]*)\/([^/]*)\/(.*)$/);
  if (!m) {
    const given = value.trim();
    const family = surn?.trim();
    return { ...(given ? { given } : {}), ...(family ? { family } : {}) };
  }
  const [, before, family, after] = m;
  if (!after.trim()) {
    const given = before.trim();
    return { ...(given ? { given } : {}), ...(family.trim() ? { family: family.trim() } : {}) };
  }
  const full = `${before}${family}${after}`.replace(/\s+/g, " ").trim();
  return { ...(full ? { full } : {}), ...(family.trim() ? { family: family.trim() } : {}) };
}

function parseEvent(node: GNode, kind: LifeEvent["kind"]): LifeEvent | null {
  const when = dateToWhen(child(node, "DATE") ? textOf(child(node, "DATE")!) : undefined);
  const place = child(node, "PLAC") ? textOf(child(node, "PLAC")!).trim() : undefined;
  const note = child(node, "NOTE") ? textOf(child(node, "NOTE")!).trim() : undefined;
  if (!hasWhen(when) && !place && !note) return null;
  return { kind, ...(when ? { when } : {}), ...(place ? { place } : {}), ...(note ? { note } : {}) };
}

// Parse a GEDCOM file into Grove records with fresh ids. Never throws on
// messy input: what parses is kept, what doesn't is skipped — an import adds,
// it never destroys.
export function fromGedcom(text: string, idgen: () => string = uid, now: number = Date.now()): GedcomTree {
  const roots = buildNodes(parseLines(text));

  const people: Person[] = [];
  const unions: Union[] = [];
  const keepsakes: Keepsake[] = [];
  const personByXref = new Map<string, Person>();
  const keepsakeByXref = new Map<string, Keepsake>();
  // A child's pedigree lives on the INDI's FAMC, keyed by the family xref.
  const pediByPerson = new Map<string, Map<string, ChildLink["kind"]>>();
  // Which keepsakes each INDI cites — resolved after SOUR records parse.
  const citations: Array<{ personId: string; sourXref: string }> = [];

  for (const rec of roots) {
    if (rec.tag !== "INDI" || !rec.xref) continue;
    const names: Name[] = [];
    let sex: string | undefined;
    const events: LifeEvent[] = [];
    let remembrance: string | undefined;
    const pedi = new Map<string, ChildLink["kind"]>();

    for (const n of rec.children) {
      if (n.tag === "NAME") {
        const surn = child(n, "SURN");
        const name = parseName(textOf(n), surn ? textOf(surn) : undefined);
        const type = child(n, "TYPE") ? textOf(child(n, "TYPE")!).trim().toLowerCase() : undefined;
        if (type === "married" || type === "aka" || type === "birth") name.kind = type;
        if (Object.keys(name).length) names.push(name);
      } else if (n.tag === "SEX") {
        sex = n.value.trim() || undefined;
      } else if (n.tag === "BIRT" || n.tag === "DEAT") {
        const e = parseEvent(n, n.tag === "BIRT" ? "birth" : "death");
        if (e) events.push(e);
        else if (n.tag === "DEAT") events.push({ kind: "death" }); // a bare DEAT still means they passed
      } else if (n.tag === "NOTE") {
        const t = textOf(n).trim();
        if (t) remembrance = remembrance ? `${remembrance}\n\n${t}` : t;
      } else if (n.tag === "FAMC") {
        const p = child(n, "PEDI") ?? child(n, "_PEDI");
        if (p) pedi.set(n.value.trim(), pediToKind(textOf(p)));
        else pedi.set(n.value.trim(), undefined);
      } else if (n.tag === "SOUR" && n.value.startsWith("@")) {
        citations.push({ personId: rec.xref, sourXref: n.value.trim() });
      }
    }

    // "Living" placeholders from privatized exports come back as they left:
    // a person with a place in the tree and their own story still to tell.
    const dead = rec.children.some((n) => n.tag === "DEAT");
    const person: Person = {
      id: idgen(),
      names,
      ...(dead ? { living: false } : {}),
      ...(sex ? { sex } : {}),
      events,
      ...(remembrance ? { remembrance } : {}),
      createdAt: now,
      updatedAt: now,
    };
    people.push(person);
    personByXref.set(rec.xref, person);
    pediByPerson.set(rec.xref, pedi);
  }

  for (const rec of roots) {
    if (rec.tag !== "FAM" || !rec.xref) continue;
    const partnerIds: string[] = [];
    const children: ChildLink[] = [];
    const events: LifeEvent[] = [];
    for (const n of rec.children) {
      if (n.tag === "HUSB" || n.tag === "WIFE") {
        const p = personByXref.get(n.value.trim());
        if (p && !partnerIds.includes(p.id)) partnerIds.push(p.id);
      } else if (n.tag === "CHIL") {
        const xref = n.value.trim();
        const p = personByXref.get(xref);
        if (p && !children.some((c) => c.personId === p.id)) {
          const kind = pediByPerson.get(xref)?.get(rec.xref);
          children.push({ personId: p.id, ...(kind ? { kind } : {}) });
        }
      } else if (n.tag === "MARR") {
        const e = parseEvent(n, "marriage");
        if (e) events.push(e);
      }
    }
    if (partnerIds.length === 0 && children.length === 0) continue;
    unions.push({ id: idgen(), partnerIds, children, events, createdAt: now, updatedAt: now });
  }

  for (const rec of roots) {
    if (rec.tag !== "SOUR" || !rec.xref) continue;
    const caption = child(rec, "TITL") ? textOf(child(rec, "TITL")!).trim() : undefined;
    const transcription = child(rec, "TEXT") ? textOf(child(rec, "TEXT")!).trim() : undefined;
    const when = dateToWhen(child(rec, "_WHEN") ? textOf(child(rec, "_WHEN")!) : undefined);
    if (!caption && !transcription) continue;
    const k: Keepsake = {
      id: idgen(),
      ...(caption ? { caption } : {}),
      ...(transcription ? { transcription } : {}),
      about: [],
      ...(when ? { when } : {}),
      createdAt: now,
      updatedAt: now,
    };
    keepsakes.push(k);
    keepsakeByXref.set(rec.xref, k);
  }

  for (const c of citations) {
    const person = personByXref.get(c.personId);
    const keepsake = keepsakeByXref.get(c.sourXref);
    if (person && keepsake && !keepsake.about.includes(person.id)) keepsake.about.push(person.id);
  }

  return { people, unions, keepsakes: keepsakes.filter((k) => k.about.length || k.caption || k.transcription) };
}
