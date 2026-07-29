// Home.tsx — the lists, most recently touched first (recency, never counts —
// same discipline as Driftless's tag row). Each row says only what a list is
// for and what's left to remember.

import { itemsFor, remainingLabel, type Checklist, type Item } from "../lib/model";
import type { SharedList } from "../hooks/useManifest";

function ListRow({
  list,
  items,
  shared,
  onOpen,
}: {
  list: Checklist;
  items: Item[];
  shared: SharedList | undefined;
  onOpen: (id: string) => void;
}) {
  const label = remainingLabel(itemsFor(list.id, items));
  return (
    <button type="button" className="list-row" onClick={() => onOpen(list.id)}>
      <span className="list-title">{list.title || "Untitled list"}</span>
      <span className="list-meta">
        {shared ? <span className="badge">shared</span> : null}
        {label ? <span className="list-remaining">{label}</span> : null}
      </span>
    </button>
  );
}

export function Home({
  lists,
  items,
  shared,
  onOpen,
  onNew,
}: {
  lists: Checklist[];
  items: Item[];
  shared: Record<string, SharedList>;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  if (lists.length === 0) {
    return (
      <div className="empty">
        <p>
          Nothing on the manifest yet. Start with the trip you're packing for — add things as you
          think of them, check them off at the door.
        </p>
        <button className="btn btn-primary" onClick={onNew}>Start a list</button>
      </div>
    );
  }

  const sorted = [...lists].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Lists</h2>
        <button className="btn btn-sm" onClick={onNew}>New list</button>
      </div>
      {sorted.map((l) => (
        <ListRow key={l.id} list={l} items={items} shared={shared[l.id]} onOpen={onOpen} />
      ))}
    </section>
  );
}
