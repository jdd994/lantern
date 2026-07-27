// PersonPage.tsx — the humblest tree that works: a person, walked link by
// link. No zoomable canvas; every kin name is a doorway to the next page.
// The remembrance sits above the dates on purpose — it's the point.

import { useEffect, useState } from "react";
import {
  childrenOf,
  displayName,
  keepsakesFor,
  lifespanLabel,
  parentsOf,
  partnersOf,
  siblingsOf,
  whenLabel,
  type Keepsake,
  type Person,
  type Relation,
  type Union,
} from "../lib/model";
import { EditPerson } from "./EditPerson";

function KinSection({
  title,
  ids,
  people,
  onOpen,
  onAdd,
  addLabel,
}: {
  title: string;
  ids: string[];
  people: Map<string, Person>;
  onOpen: (id: string) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  const known = ids.map((id) => people.get(id)).filter((p): p is Person => !!p);
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onAdd}>{addLabel}</button>
      </div>
      {known.length === 0 ? (
        <p className="kin-none">None recorded yet.</p>
      ) : (
        known.map((p) => {
          const span = lifespanLabel(p);
          return (
            <button key={p.id} type="button" className="person-row" onClick={() => onOpen(p.id)}>
              <span className="person-name">{displayName(p)}</span>
              {span ? <span className="person-span">{span}</span> : null}
            </button>
          );
        })
      )}
    </section>
  );
}

export function PersonPage({
  person,
  people,
  unions,
  keepsakes,
  onOpen,
  onBack,
  onUpdate,
  onAddRelative,
}: {
  person: Person;
  people: Person[];
  unions: Union[];
  keepsakes: Keepsake[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onUpdate: (patch: Partial<Omit<Person, "id" | "createdAt" | "updatedAt">>) => void;
  onAddRelative: (relation: Relation) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [remembrance, setRemembrance] = useState(person.remembrance ?? "");
  useEffect(() => setRemembrance(person.remembrance ?? ""), [person.id, person.remembrance]);

  const byId = new Map(people.map((p) => [p.id, p]));
  const span = lifespanLabel(person);
  const treasures = keepsakesFor(person.id, keepsakes);

  const saveRemembrance = () => {
    const next = remembrance.trim();
    if (next !== (person.remembrance ?? "")) onUpdate({ remembrance: next || undefined });
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}>← Everyone</button>

      <div className="person-head">
        <h2 className="person-title">{displayName(person)}</h2>
        <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </div>
      {span ? <p className="person-life">{span}</p> : null}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">As the family remembers</h2>
        </div>
        <textarea
          className="remembrance"
          value={remembrance}
          onChange={(e) => setRemembrance(e.target.value)}
          onBlur={saveRemembrance}
          placeholder="Who were they? What did they love, what did they always say, what does the family still tell about them?"
        />
      </section>

      <KinSection title="Parents" ids={parentsOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("parent")} addLabel="Add a parent" />
      <KinSection title="Partners" ids={partnersOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("partner")} addLabel="Add a partner" />
      <KinSection title="Children" ids={childrenOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("child")} addLabel="Add a child" />
      <KinSection title="Siblings" ids={siblingsOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("sibling")} addLabel="Add a sibling" />

      {treasures.length ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Keepsakes</h2>
          </div>
          {treasures.map((k) => (
            <div key={k.id} className="keepsake">
              <div className="keepsake-caption">{k.caption || "A keepsake"}</div>
              {k.when ? <div className="keepsake-when">{whenLabel(k.when)}</div> : null}
              {k.transcription ? <p className="keepsake-text">{k.transcription}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {editing ? <EditPerson person={person} onSave={onUpdate} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
