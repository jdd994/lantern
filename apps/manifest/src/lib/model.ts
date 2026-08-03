// model.ts
// Pure, framework-free logic for the lists. Operates on decrypted records held
// in memory after the vault is unlocked. No React, no IO here — easy to test
// and reason about. (Same contract as Grove's model.ts and Driftless's
// journal.ts.)
//
// The soul, encoded as an absence: an Item has no due date, no priority, no
// reminder, no assignee. A list is a memory aid you consult at the door, not a
// taskmaster. The one social field is `claimedBy` — who *volunteered* to bring
// a thing. Nobody can set it to anyone but themselves; the UI only ever offers
// "I've got it."

// ---- Lists ----------------------------------------------------------------
export type Checklist = {
  id: string;
  title: string;
  note?: string; // a line about the trip/plan, if the list wants one
  createdAt: number;
  updatedAt: number;
  author?: string; // whose hand last touched it (attribution, not score)
};

// ---- Items ----------------------------------------------------------------
export type Item = {
  id: string;
  listId: string; // which list it belongs to — inside the ciphertext, so the
  // server never even learns how records group into lists
  text: string;
  checked: boolean; // packed / aboard / done
  claimedBy?: string; // account email of whoever said "I've got it" — a claim,
  // never an assignment
  position: number; // sort key; appending uses nextPosition()
  createdAt: number;
  updatedAt: number;
  author?: string;
};

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---- Encrypted payloads ---------------------------------------------------
// What actually gets encrypted is a small versioned JSON document per record,
// so everything meaningful travels inside the ciphertext. Decoders are
// defensive: garbage in, empty-but-valid out — never a crash on old data.

export function encodeList(l: Checklist): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = l;
  return JSON.stringify({ __manifest: 1, t: "list", ...body });
}

export function encodeItem(i: Item): string {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = i;
  return JSON.stringify({ __manifest: 1, t: "item", ...body });
}

type Shell = { id: string; createdAt: number; updatedAt: number };

export function decodeList(decrypted: string, shell: Shell): Checklist {
  const o = parseManifest(decrypted, "list");
  return {
    ...shell,
    title: typeof o.title === "string" ? o.title : "",
    note: typeof o.note === "string" ? o.note : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

export function decodeItem(decrypted: string, shell: Shell): Item {
  const o = parseManifest(decrypted, "item");
  return {
    ...shell,
    listId: typeof o.listId === "string" ? o.listId : "",
    text: typeof o.text === "string" ? o.text : "",
    checked: o.checked === true,
    claimedBy: typeof o.claimedBy === "string" ? o.claimedBy : undefined,
    position: typeof o.position === "number" && Number.isFinite(o.position) ? o.position : 0,
    author: typeof o.author === "string" ? o.author : undefined,
  };
}

function parseManifest(decrypted: string, t: string): Record<string, unknown> {
  try {
    const o = JSON.parse(decrypted);
    if (o && o.__manifest === 1 && o.t === t) return o as Record<string, unknown>;
  } catch {
    // fall through
  }
  return {};
}

// ---- Working with a list --------------------------------------------------

// A list's items in reading order: still-to-gather first, packed settled
// quietly at the bottom — checked things sink, they don't celebrate.
export function itemsFor(listId: string, items: Item[]): Item[] {
  return items
    .filter((i) => i.listId === listId)
    .sort((a, b) =>
      a.checked !== b.checked
        ? Number(a.checked) - Number(b.checked)
        : a.position - b.position || a.createdAt - b.createdAt
    );
}

// Where a new item goes: after everything already on the list.
export function nextPosition(listItems: Item[]): number {
  let max = 0;
  for (const i of listItems) if (i.position > max) max = i.position;
  return max + 1;
}

// "3 to go", "packed", or "" for an empty list. A remaining count is the
// list's whole job — what's left to remember — never a completion meter.
export function remainingLabel(listItems: Item[]): string {
  if (listItems.length === 0) return "";
  const left = listItems.filter((i) => !i.checked).length;
  return left === 0 ? "packed" : `${left} to go`;
}

// ---- Lists remember -------------------------------------------------------
// Clone a list for the next departure: fresh ids (a copy is private until it's
// deliberately shared), everything unchecked, every claim released — the
// *knowledge* of what you needed travels, the state of last time doesn't.
export function cloneList(
  source: Checklist,
  sourceItems: Item[],
  title: string,
  now: number = Date.now()
): { list: Checklist; items: Item[] } {
  const list: Checklist = {
    id: uid(),
    title: title.trim() || source.title,
    note: source.note,
    createdAt: now,
    updatedAt: now,
  };
  const items: Item[] = itemsFor(source.id, sourceItems).map((i, idx) => ({
    id: uid(),
    listId: list.id,
    text: i.text,
    checked: false,
    position: idx + 1,
    createdAt: now,
    updatedAt: now,
  }));
  return { list, items };
}

// The way back in: Markdown checklists → drafts ready to persist. Tolerant of
// hand-written files — `## Title` starts a list, `- [ ]`/`- [x]` are items,
// the first plain line under a heading becomes the note. Claims are NOT
// imported (a trailing " — someone@example.com" from our own export is
// stripped): a claim is volunteered in person, never carried in on paper.
export type ImportedList = { title: string; note?: string; items: { text: string; checked: boolean }[] };

export function fromMarkdown(text: string): ImportedList[] {
  const out: ImportedList[] = [];
  let current: ImportedList | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      out.push(current);
      continue;
    }
    if (!current || !line || line === "_(empty)_") continue;
    const item = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (item) {
      const text = item[2].replace(/\s+—\s+\S+@\S+$/, "").trim();
      if (text) current.items.push({ text, checked: item[1] !== " " });
    } else if (!current.note && current.items.length === 0) {
      current.note = line;
    }
  }
  return out.filter((l) => l.title || l.items.length);
}

// ---- Portability ----------------------------------------------------------
// Every list as plain Markdown checklists — readable anywhere, forever. Your
// lists are never hostage here.
export function toMarkdown(lists: Checklist[], items: Item[]): string {
  const parts: string[] = [];
  for (const l of [...lists].sort((a, b) => b.updatedAt - a.updatedAt)) {
    parts.push(`## ${l.title || "Untitled list"}`);
    if (l.note) parts.push(l.note);
    const its = itemsFor(l.id, items);
    if (its.length === 0) parts.push("_(empty)_");
    for (const i of its) {
      const claim = i.claimedBy ? ` — ${i.claimedBy}` : "";
      parts.push(`- [${i.checked ? "x" : " "}] ${i.text}${claim}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}
