// EditPerson.tsx — names and the scaffolding dates. Edits preserve what it
// doesn't touch: extra names keep their order, an event keeps its place and
// note when only its year changes.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Sheet } from "@lantern/ui";
import {
  birthFamilyName,
  whenYear,
  withBirthFamilyName,
  withEventWhen,
  yearWhen,
  type Person,
  type When,
} from "../lib/model";
import type { PersonDraft } from "../hooks/useGrove";

type Qual = "" | NonNullable<When["qualifier"]>;

function eventWhen(p: Person, kind: "birth" | "death"): When | undefined {
  return p.events.find((e) => e.kind === kind)?.when;
}

export function EditPerson({
  person,
  onSave,
  onRemove,
  onClose,
}: {
  person: Person;
  onSave: (patch: Partial<PersonDraft>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const first = person.names[0] ?? {};
  const birth = eventWhen(person, "birth");
  const death = eventWhen(person, "death");

  const [given, setGiven] = useState(first.given ?? "");
  const [family, setFamily] = useState(first.family ?? "");
  const [born, setBorn] = useState(birthFamilyName(person) ?? "");
  const [living, setLiving] = useState(person.living !== false);
  const [birthYear, setBirthYear] = useState(whenYear(birth)?.toString() ?? "");
  const [birthQual, setBirthQual] = useState<Qual>(birth?.qualifier ?? "");
  const [deathYear, setDeathYear] = useState(whenYear(death)?.toString() ?? "");
  const [deathQual, setDeathQual] = useState<Qual>(death?.qualifier ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!given.trim() && !family.trim()) return setError(t`A name — even just the one everyone used.`);
    const parse = (s: string, invalidMsg: string): number | undefined | null => {
      if (!s.trim()) return undefined;
      const n = Number(s.trim());
      if (!Number.isFinite(n)) {
        setError(invalidMsg);
        return null;
      }
      return n;
    };
    const by = parse(birthYear, t`The birth year didn't read as a number.`);
    if (by === null) return;
    const dy = living ? undefined : parse(deathYear, t`The death year didn't read as a number.`);
    if (dy === null) return;

    let events = withEventWhen(person.events, "birth", yearWhen(by, birthQual || undefined));
    events = withEventWhen(events, "death", living ? undefined : yearWhen(dy, deathQual || undefined));

    const shown = { ...first, given: given.trim() || undefined, family: family.trim() || undefined };
    onSave({
      names: withBirthFamilyName([shown, ...person.names.slice(1)], born),
      living,
      events,
    });
    onClose();
  }

  const qualSelect = (value: Qual, set: (q: Qual) => void) => (
    <select value={value} onChange={(e) => set(e.target.value as Qual)}>
      <option value="">{t`Exactly`}</option>
      <option value="about">{t`About`}</option>
      <option value="before">{t`Before`}</option>
      <option value="after">{t`After`}</option>
    </select>
  );

  return (
    <Sheet onClose={onClose} ariaLabel={t`Edit person`}>
      <h3><Trans>Edit</Trans></h3>
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
          <span className="label"><Trans>Family name at birth</Trans></span>
          <input type="text" value={born} onChange={(e) => setBorn(e.target.value)} />
          <span className="hint">
            <Trans>A maiden name, or any family name that changed later. Leave it empty if it never did.</Trans>
          </span>
        </label>
        <div className="row">
          <label className="field">
            <span className="label"><Trans>Born (year)</Trans></span>
            <input type="number" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
          </label>
          <label className="field">
            <span className="label"><Trans>How sure?</Trans></span>
            {qualSelect(birthQual, setBirthQual)}
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={living} onChange={(e) => setLiving(e.target.checked)} />
          <span><Trans>Still living</Trans></span>
        </label>
        {!living ? (
          <div className="row">
            <label className="field">
              <span className="label"><Trans>Died (year, if known)</Trans></span>
              <input type="number" value={deathYear} onChange={(e) => setDeathYear(e.target.value)} />
            </label>
            <label className="field">
              <span className="label"><Trans>How sure?</Trans></span>
              {qualSelect(deathQual, setDeathQual)}
            </label>
          </div>
        ) : null}
        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}><Trans>Cancel</Trans></button>
          <button type="submit" className="btn btn-primary"><Trans>Save</Trans></button>
        </div>
        <div className="danger-zone">
          <button
            type="button"
            className="linklike danger"
            onClick={() => {
              if (
                window.confirm(
                  t`Remove this person from the tree? Their links and any union left empty go too. Keepsakes stay, but stop pointing at them.`
                )
              ) {
                onRemove();
                onClose();
              }
            }}
          >
            <Trans>Remove from the tree</Trans>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
