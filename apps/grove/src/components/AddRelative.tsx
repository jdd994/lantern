// AddRelative.tsx — one sheet for both beginnings: the first person in an
// empty grove, and a relative anchored to someone already here. Adding and
// placing happen in one gesture (see linkRelative), so nobody lands invisible.
//
// The living-by-default checkbox guards the minimal-entry ethic: someone who
// hasn't consented by joining gets a name and a place, and tells their own
// story when they arrive.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Sheet } from "@lantern/ui";
import {
  displayName,
  withBirthFamilyName,
  yearWhen,
  type ChildLink,
  type Person,
  type Relation,
  type When,
} from "../lib/model";
import type { PersonDraft } from "../hooks/useGrove";

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
  const { t } = useLingui();
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [born, setBorn] = useState("");
  const [living, setLiving] = useState(true);
  const [birthYear, setBirthYear] = useState("");
  const [qualifier, setQualifier] = useState<"" | NonNullable<When["qualifier"]>>("");
  const [kind, setKind] = useState<NonNullable<ChildLink["kind"]>>("birth");
  const [error, setError] = useState<string | null>(null);

  const relLabel: Record<Relation, string> = {
    parent: t`a parent of`,
    partner: t`a partner of`,
    child: t`a child of`,
    sibling: t`a sibling of`,
  };
  const kindLabel: Record<NonNullable<ChildLink["kind"]>, string> = {
    birth: t`birth`,
    adoptive: t`adoptive`,
    step: t`step`,
    foster: t`foster`,
    guardian: t`guardian`,
  };

  // Families are made in more than one way; the link kind says so plainly.
  const asksKind = relation === "parent" || relation === "child" || relation === "sibling";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!given.trim() && !family.trim()) return setError(t`A name — even just the one everyone used.`);
    const year = birthYear.trim() ? Number(birthYear.trim()) : undefined;
    if (birthYear.trim() && !Number.isFinite(year)) return setError(t`The birth year didn't read as a number.`);
    const when = yearWhen(year, qualifier || undefined);
    const draft: PersonDraft = {
      names: withBirthFamilyName([{ given: given.trim() || undefined, family: family.trim() || undefined }], born),
      living,
      events: when ? [{ kind: "birth", when }] : [],
    };
    onAdd(draft, asksKind ? kind : undefined);
    onClose();
  }

  return (
    <Sheet onClose={onClose} ariaLabel={t`Add a person`}>
      <h3>{anchor && relation ? t`Add ${relLabel[relation]} ${displayName(anchor)}` : t`Add the first person`}</h3>
      <form onSubmit={submit}>
        {error ? <div className="error">{error}</div> : null}
        <div className="row">
          <label className="field">
            <span className="label"><Trans>Given name</Trans></span>
            <input type="text" value={given} onChange={(e) => setGiven(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="label"><Trans>Family name</Trans></span>
            <input type="text" value={family} onChange={(e) => setFamily(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="label"><Trans>Family name at birth (if it changed)</Trans></span>
          <input type="text" value={born} onChange={(e) => setBorn(e.target.value)} placeholder={t`a maiden name, say`} />
        </label>
        <div className="row">
          <label className="field">
            <span className="label"><Trans>Born (year, if known)</Trans></span>
            <input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder={t`1885`} />
          </label>
          <label className="field">
            <span className="label"><Trans>How sure?</Trans></span>
            <select value={qualifier} onChange={(e) => setQualifier(e.target.value as typeof qualifier)}>
              <option value="">{t`Exactly`}</option>
              <option value="about">{t`About`}</option>
              <option value="before">{t`Before`}</option>
              <option value="after">{t`After`}</option>
            </select>
          </label>
        </div>
        {asksKind ? (
          <label className="field">
            <span className="label"><Trans>How they're linked</Trans></span>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {LINK_KINDS.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}
            </select>
          </label>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} />
          <span><Trans>Still living</Trans></span>
        </label>
        {living ? (
          <p className="hint">
            <Trans>
              Living people get a minimal entry — a name and a place in the tree. They tell their own
              story when they join.
            </Trans>
          </p>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}><Trans>Cancel</Trans></button>
          <button type="submit" className="btn btn-primary"><Trans>Add</Trans></button>
        </div>
      </form>
    </Sheet>
  );
}
