// AddRelative.tsx — one sheet for both beginnings: the first person in an
// empty grove, and a relative anchored to someone already here. Adding and
// placing happen in one gesture (see linkRelative), so nobody lands invisible.
//
// The living-by-default checkbox guards the minimal-entry ethic: someone who
// hasn't consented by joining gets a name and a place, and tells their own
// story when they arrive.

import { useState } from "react";
import { Sheet } from "@lantern/ui";
import { displayName, yearWhen, type ChildLink, type Person, type Relation, type When } from "../lib/model";
import type { PersonDraft } from "../hooks/useGrove";

const REL_LABEL: Record<Relation, string> = {
  parent: "a parent of",
  partner: "a partner of",
  child: "a child of",
  sibling: "a sibling of",
};

const LINK_KINDS: NonNullable<ChildLink["kind"]>[] = ["birth", "adoptive", "step", "foster", "guardian"];

export function AddRelative({
  anchor,
  relation,
  onAdd,
  onClose,
}: {
  anchor?: Person;
  relation?: Relation;
  onAdd: (draft: PersonDraft, childKind?: ChildLink["kind"]) => void;
  onClose: () => void;
}) {
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [living, setLiving] = useState(true);
  const [birthYear, setBirthYear] = useState("");
  const [qualifier, setQualifier] = useState<"" | NonNullable<When["qualifier"]>>("");
  const [kind, setKind] = useState<NonNullable<ChildLink["kind"]>>("birth");
  const [error, setError] = useState<string | null>(null);

  // Families are made in more than one way; the link kind says so plainly.
  const asksKind = relation === "parent" || relation === "child" || relation === "sibling";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!given.trim() && !family.trim()) return setError("A name — even just the one everyone used.");
    const year = birthYear.trim() ? Number(birthYear.trim()) : undefined;
    if (birthYear.trim() && !Number.isFinite(year)) return setError("The birth year didn't read as a number.");
    const when = yearWhen(year, qualifier || undefined);
    const draft: PersonDraft = {
      names: [{ given: given.trim() || undefined, family: family.trim() || undefined }],
      living,
      events: when ? [{ kind: "birth", when }] : [],
    };
    onAdd(draft, asksKind ? kind : undefined);
    onClose();
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Add a person">
      <h3>{anchor && relation ? `Add ${REL_LABEL[relation]} ${displayName(anchor)}` : "Add the first person"}</h3>
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
            <span className="label">Born (year, if known)</span>
            <input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="1885" />
          </label>
          <label className="field">
            <span className="label">How sure?</span>
            <select value={qualifier} onChange={(e) => setQualifier(e.target.value as typeof qualifier)}>
              <option value="">Exactly</option>
              <option value="about">About</option>
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
          </label>
        </div>
        {asksKind ? (
          <label className="field">
            <span className="label">How they're linked</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {LINK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} />
          <span>Still living</span>
        </label>
        {living ? (
          <p className="hint">
            Living people get a minimal entry — a name and a place in the tree. They tell their own
            story when they join.
          </p>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Add</button>
        </div>
      </form>
    </Sheet>
  );
}
