// EditPerson.tsx — names and the scaffolding dates. Edits preserve what it
// doesn't touch: extra names keep their order, an event keeps its place and
// note when only its year changes.

import { useState } from "react";
import { Sheet } from "@lantern/ui";
import { whenYear, withEventWhen, yearWhen, type Person, type When } from "../lib/model";
import type { PersonDraft } from "../hooks/useGrove";

type Qual = "" | NonNullable<When["qualifier"]>;

function eventWhen(p: Person, kind: "birth" | "death"): When | undefined {
  return p.events.find((e) => e.kind === kind)?.when;
}

export function EditPerson({
  person,
  onSave,
  onClose,
}: {
  person: Person;
  onSave: (patch: Partial<PersonDraft>) => void;
  onClose: () => void;
}) {
  const first = person.names[0] ?? {};
  const birth = eventWhen(person, "birth");
  const death = eventWhen(person, "death");

  const [given, setGiven] = useState(first.given ?? "");
  const [family, setFamily] = useState(first.family ?? "");
  const [living, setLiving] = useState(person.living !== false);
  const [birthYear, setBirthYear] = useState(whenYear(birth)?.toString() ?? "");
  const [birthQual, setBirthQual] = useState<Qual>(birth?.qualifier ?? "");
  const [deathYear, setDeathYear] = useState(whenYear(death)?.toString() ?? "");
  const [deathQual, setDeathQual] = useState<Qual>(death?.qualifier ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!given.trim() && !family.trim()) return setError("A name — even just the one everyone used.");
    const parse = (s: string, label: string): number | undefined | null => {
      if (!s.trim()) return undefined;
      const n = Number(s.trim());
      if (!Number.isFinite(n)) {
        setError(`The ${label} year didn't read as a number.`);
        return null;
      }
      return n;
    };
    const by = parse(birthYear, "birth");
    if (by === null) return;
    const dy = living ? undefined : parse(deathYear, "death");
    if (dy === null) return;

    let events = withEventWhen(person.events, "birth", yearWhen(by, birthQual || undefined));
    events = withEventWhen(events, "death", living ? undefined : yearWhen(dy, deathQual || undefined));

    onSave({
      names: [{ ...first, given: given.trim() || undefined, family: family.trim() || undefined }, ...person.names.slice(1)],
      living,
      events,
    });
    onClose();
  }

  const qualSelect = (value: Qual, set: (q: Qual) => void) => (
    <select value={value} onChange={(e) => set(e.target.value as Qual)}>
      <option value="">Exactly</option>
      <option value="about">About</option>
      <option value="before">Before</option>
      <option value="after">After</option>
    </select>
  );

  return (
    <Sheet onClose={onClose} ariaLabel="Edit person">
      <h3>Edit</h3>
      <form onSubmit={submit}>
        {error ? <div className="error">{error}</div> : null}
        <div className="row">
          <label className="field">
            <span className="label">Given name</span>
            <input type="text" value={given} onChange={(e) => setGiven(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="label">Family name</span>
            <input type="text" value={family} onChange={(e) => setFamily(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span className="label">Born (year)</span>
            <input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">How sure?</span>
            {qualSelect(birthQual, setBirthQual)}
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} />
          <span>Still living</span>
        </label>
        {!living ? (
          <div className="row">
            <label className="field">
              <span className="label">Died (year, if known)</span>
              <input type="number" value={deathYear} onChange={(e) => setDeathYear(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">How sure?</span>
              {qualSelect(deathQual, setDeathQual)}
            </label>
          </div>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </Sheet>
  );
}
