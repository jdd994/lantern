// Home.tsx — everyone in the grove, humbly listed. The person page is the
// tree; this is just the way in. The "unplaced" shelf keeps the
// never-silently-dropped promise visible: added but not yet linked still means
// fully here.

import { displayName, lifespanLabel, unplaced, type Person, type Union } from "../lib/model";

function PersonRow({ person, onOpen }: { person: Person; onOpen: (id: string) => void }) {
  const span = lifespanLabel(person);
  return (
    <button type="button" className="person-row" onClick={() => onOpen(person.id)}>
      <span className="person-name">{displayName(person)}</span>
      {span ? <span className="person-span">{span}</span> : null}
    </button>
  );
}

export function Home({
  people,
  unions,
  onOpen,
  onAddFirst,
}: {
  people: Person[];
  unions: Union[];
  onOpen: (id: string) => void;
  onAddFirst: () => void;
}) {
  if (people.length === 0) {
    return (
      <div className="empty">
        <p>
          The grove is empty. Begin with anyone — yourself, a grandparent, the relative everyone
          tells stories about. One name is enough; the rest grows from it.
        </p>
        <button className="btn btn-primary" onClick={onAddFirst}>Add the first person</button>
      </div>
    );
  }

  const byName = (a: Person, b: Person) => displayName(a).localeCompare(displayName(b));
  const loose = unions.length ? unplaced(people, unions) : [];
  const looseIds = new Set(loose.map((p) => p.id));
  const placed = people.filter((p) => !looseIds.has(p.id)).sort(byName);

  return (
    <>
      {placed.length ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Family</h2>
          </div>
          {placed.map((p) => <PersonRow key={p.id} person={p} onOpen={onOpen} />)}
        </section>
      ) : null}
      {loose.length ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Not yet placed</h2>
          </div>
          <p className="hint">Added but not linked to anyone yet — they still belong.</p>
          {loose.sort(byName).map((p) => <PersonRow key={p.id} person={p} onOpen={onOpen} />)}
        </section>
      ) : null}
    </>
  );
}
