// PersonPage.tsx — the humblest tree that works: a person, walked link by
// link. No zoomable canvas; every kin name is a doorway to the next page.
// The remembrance sits above the dates on purpose — it's the point.

import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  birthFamilyName,
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
import type { KeepsakeDraft } from "../hooks/useGrove";
import { AddKeepsake } from "./AddKeepsake";
import { EditPerson } from "./EditPerson";

// A keepsake's scan, decrypted on view. An image shows as itself; a PDF (a
// data: URL can't open in a tab) offers itself as a download.
function KeepsakeMedia({ mediaId, getMediaUrl }: { mediaId: string; getMediaUrl: (id: string) => Promise<string | null> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    void getMediaUrl(mediaId).then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
  }, [mediaId, getMediaUrl]);
  if (!url) return null;
  if (url.startsWith("data:image")) return <img className="keepsake-img" src={url} alt="" />;
  return (
    <a className="linklike" href={url} download="keepsake.pdf">
      <Trans>Save the document to read it</Trans>
    </a>
  );
}

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
        <p className="kin-none"><Trans>None recorded yet.</Trans></p>
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
  onRemove,
  onTree,
  onAddRelative,
  onAddKeepsake,
  onRemoveKeepsake,
  getMediaUrl,
  authorHandle,
}: {
  person: Person;
  people: Person[];
  unions: Union[];
  keepsakes: Keepsake[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onUpdate: (patch: Partial<Omit<Person, "id" | "createdAt" | "updatedAt">>) => void;
  onRemove: () => void;
  onTree: () => void;
  onAddRelative: (relation: Relation) => void;
  onAddKeepsake: (draft: KeepsakeDraft, file?: File) => void;
  onRemoveKeepsake: (k: Keepsake) => void;
  getMediaUrl: (id: string) => Promise<string | null>;
  // Whose hand last touched a record — null for your own, and outside a shared
  // tree. A byline, never a score.
  authorHandle: (author?: string) => string | null;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [addingKeepsake, setAddingKeepsake] = useState(false);
  const [remembrance, setRemembrance] = useState(person.remembrance ?? "");
  useEffect(() => setRemembrance(person.remembrance ?? ""), [person.id, person.remembrance]);

  const byId = new Map(people.map((p) => [p.id, p]));
  const span = lifespanLabel(person);
  const bornAs = birthFamilyName(person.names);
  const treasures = keepsakesFor(person.id, keepsakes);
  const tendedBy = authorHandle(person.author);

  const saveRemembrance = () => {
    const next = remembrance.trim();
    if (next !== (person.remembrance ?? "")) onUpdate({ remembrance: next || undefined });
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}><Trans>← Everyone</Trans></button>

      <div className="person-head">
        <h2 className="person-title">{displayName(person)}</h2>
        <div className="person-actions">
          <button className="btn btn-ghost btn-sm" onClick={onTree}><Trans>In the tree</Trans></button>
          <button className="btn btn-sm" onClick={() => setEditing(true)}><Trans>Edit</Trans></button>
        </div>
      </div>
      {bornAs || span || tendedBy ? (
        <p className="person-life">
          {bornAs ? <Trans>born {bornAs}</Trans> : null}
          {bornAs && span ? " · " : ""}
          {span}
          {(bornAs || span) && tendedBy ? " · " : ""}
          {tendedBy ? <span className="byline"><Trans>last tended by {tendedBy}</Trans></span> : null}
        </p>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><Trans>As the family remembers</Trans></h2>
        </div>
        <textarea
          className="remembrance"
          value={remembrance}
          onChange={(e) => setRemembrance(e.target.value)}
          onBlur={saveRemembrance}
          placeholder={t`Who were they? What did they love, what did they always say, what does the family still tell about them?`}
        />
      </section>

      <KinSection title={t`Parents`} ids={parentsOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("parent")} addLabel={t`Add a parent`} />
      <KinSection title={t`Partners`} ids={partnersOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("partner")} addLabel={t`Add a partner`} />
      <KinSection title={t`Children`} ids={childrenOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("child")} addLabel={t`Add a child`} />
      <KinSection title={t`Siblings`} ids={siblingsOf(person.id, unions)} people={byId} onOpen={onOpen} onAdd={() => onAddRelative("sibling")} addLabel={t`Add a sibling`} />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><Trans>Keepsakes</Trans></h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddingKeepsake(true)}><Trans>Add a keepsake</Trans></button>
        </div>
        {treasures.length === 0 ? (
          <p className="kin-none"><Trans>Nothing kept here yet — a photo, a letter, a story worth saving.</Trans></p>
        ) : (
          treasures.map((k) => (
            <div key={k.id} className="keepsake">
              <div className="keepsake-head">
                <div>
                  <div className="keepsake-caption">{k.caption || t`A keepsake`}</div>
                  {k.when ? <div className="keepsake-when">{whenLabel(k.when)}</div> : null}
                  {authorHandle(k.author) ? (
                    <div className="keepsake-when byline"><Trans>kept by {authorHandle(k.author)}</Trans></div>
                  ) : null}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  title={t`Remove this keepsake`}
                  onClick={() => {
                    if (window.confirm(t`Remove this keepsake? It will be gone from the tree.`)) onRemoveKeepsake(k);
                  }}
                >
                  ×
                </button>
              </div>
              {k.mediaId ? <KeepsakeMedia mediaId={k.mediaId} getMediaUrl={getMediaUrl} /> : null}
              {k.transcription ? <p className="keepsake-text">{k.transcription}</p> : null}
            </div>
          ))
        )}
      </section>

      {editing ? <EditPerson person={person} onSave={onUpdate} onRemove={onRemove} onClose={() => setEditing(false)} /> : null}
      {addingKeepsake ? <AddKeepsake person={person} onAdd={onAddKeepsake} onClose={() => setAddingKeepsake(false)} /> : null}
    </>
  );
}
