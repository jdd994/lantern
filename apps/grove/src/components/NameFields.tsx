// NameFields.tsx — the two ways to write a name, shared by the add and edit
// sheets so they can't drift apart.
//
// The default is given + family, because that's the shape most people here
// are typing and it costs them nothing. A name that shape can't hold says so
// and gets a single free field instead — no culture is asked to pay for a
// case it doesn't have, and none is told its name is written wrong.

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { birthFamilyName, withBirthFamilyName, type Name } from "../lib/model";

export function useNameFields(existing: Name[] = []) {
  const first = existing[0] ?? {};
  const [freeform, setFreeform] = useState(!!first.full);
  const [full, setFull] = useState(first.full ?? "");
  const [given, setGiven] = useState(first.given ?? "");
  const [family, setFamily] = useState(first.family ?? "");
  const [born, setBorn] = useState(birthFamilyName(existing) ?? "");

  // Switching to the free field starts from whatever's already typed, so a
  // name only has to be reordered, never retyped.
  function setFreeformMode(on: boolean) {
    if (on && !full.trim()) setFull([given, family].filter(Boolean).join(" ").trim());
    setFreeform(on);
  }

  // Only the mode in use writes anything: leaving the free field never leaves
  // a stale `full` behind to override the pair the person is looking at.
  function name(): Name {
    const fam = family.trim() || undefined;
    const written = freeform ? { full: full.trim() || undefined } : { given: given.trim() || undefined };
    return { ...written, ...(fam ? { family: fam } : {}), ...(first.kind ? { kind: first.kind } : {}) };
  }

  return {
    freeform,
    setFreeformMode,
    full,
    setFull,
    given,
    setGiven,
    family,
    setFamily,
    born,
    setBorn,
    empty: freeform ? !full.trim() : !given.trim() && !family.trim(),
    // The finished list: this name first, then whatever else the person
    // already carried, with the birth name set or cleared alongside.
    names: (rest: Name[] = []) => withBirthFamilyName([name(), ...rest], born),
  };
}

export function NameFields({ fields, autoFocus = true }: { fields: ReturnType<typeof useNameFields>; autoFocus?: boolean }) {
  const { t } = useLingui();
  const f = fields;

  return (
    <>
      {f.freeform ? (
        <>
          <label className="field">
            <span className="label"><Trans>Name</Trans></span>
            <input type="text" value={f.full} onChange={(e) => f.setFull(e.target.value)} autoFocus={autoFocus} />
            <span className="hint">
              <Trans>Written the way it's said, in its own order — however many parts it has.</Trans>
            </span>
          </label>
          <label className="field">
            <span className="label"><Trans>Family name, if one of them is</Trans></span>
            <input type="text" value={f.family} onChange={(e) => f.setFamily(e.target.value)} />
            <span className="hint">
              <Trans>
                Optional, and only ever what you say it is — Grove never guesses. It marks a name at
                birth and labels the surname when a tree is exported.
              </Trans>
            </span>
          </label>
        </>
      ) : (
        <div className="row">
          <label className="field">
            <span className="label"><Trans>Given names</Trans></span>
            <input
              type="text"
              value={f.given}
              onChange={(e) => f.setGiven(e.target.value)}
              autoFocus={autoFocus}
              placeholder={t`Mary Jane`}
            />
          </label>
          <label className="field">
            <span className="label"><Trans>Family name</Trans></span>
            <input type="text" value={f.family} onChange={(e) => f.setFamily(e.target.value)} />
          </label>
        </div>
      )}

      <label className="field">
        <span className="label"><Trans>Family name at birth</Trans></span>
        <input type="text" value={f.born} onChange={(e) => f.setBorn(e.target.value)} placeholder={t`a maiden name, say`} />
        <span className="hint">
          <Trans>A maiden name, or any family name that changed later. Leave it empty if it never did.</Trans>
        </span>
      </label>

      <p className="hint">
        <button type="button" className="linklike" onClick={() => f.setFreeformMode(!f.freeform)}>
          {f.freeform ? t`Use given and family names instead` : t`Is the name written another way?`}
        </button>
      </p>
    </>
  );
}
