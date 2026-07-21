// StrandsView.tsx
// The "narrative order" lens: named, ordered collections of pieces. You can
// pull in thoughts you've captured, write new pieces in place (each becomes an
// ordinary thought too), arrange the order, and read the whole as one draft.
import { useMemo, useRef, useState } from "react";
import { strandEntries, readAsOne, type Entry, type Strand, type Anchor, type MediaConfig } from "../lib/journal";
import { EntryItem, MediaThumb } from "./EntryItem";

type Props = {
  strands: Strand[];
  entries: Entry[];
  onCreate: (title: string) => Promise<Strand>;
  onRename: (id: string, title: string) => void;
  onDelete: (strand: Strand) => void;
  onAddTo: (strandId: string, entryId: string) => void;
  onRemoveFrom: (strandId: string, entryId: string) => void;
  onReorder: (strandId: string, entryIds: string[]) => void;
  onWriteIn: (strandId: string, text: string) => void;
  onWriteInAfter: (strandId: string, text: string, afterId: string | null) => void;
  onWriteChapter: (strandId: string, title: string) => void;
  onAddPhoto: (strandId: string, file: File) => void;
  onSaveEntry: (id: string, text: string) => void;
  onDeleteEntry: (id: string) => void;
  onAnchor: (id: string, anchor: Anchor | null) => void;
  onSetHeading: (id: string, heading: boolean) => void;
  onExport: (strand: Strand, ordered: Entry[]) => void;
  onAttachMedia: (entryId: string, file: File) => void;
  onRemoveMedia: (entryId: string, mediaId: string) => void;
  onSetMediaConfig: (entryId: string, mediaId: string, partial: MediaConfig) => void;
  getMediaUrl: (id: string) => Promise<string | null>;
};

export function StrandsView(props: Props) {
  const { strands, entries } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const selected = strands.find((s) => s.id === selectedId) ?? null;

  async function create() {
    const title = newTitle.trim();
    if (!title) return;
    const s = await props.onCreate(title);
    setNewTitle("");
    setSelectedId(s.id);
  }

  if (!selected) {
    return (
      <main className="strands" aria-live="polite">
        <div className="strand-new">
          <input
            className="anchor-input"
            placeholder="Name a strand — “Grandma's story”, “Riverbed”, “Chapter 3”…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="save-btn" disabled={!newTitle.trim()} onClick={create}>
            Start
          </button>
        </div>

        {strands.length === 0 ? (
          <div className="empty">
            <div className="mark">❋</div>
            <p>
              No strands yet.
              <br />
              Gather scattered thoughts into a story, a song, a chapter.
            </p>
          </div>
        ) : (
          <ul className="strand-list">
            {strands.map((s) => {
              const count = strandEntries(s.entryIds, byId).length;
              return (
                <li key={s.id}>
                  <button className="strand-card" onClick={() => setSelectedId(s.id)}>
                    <span className="strand-card-title">{s.title || "Untitled"}</span>
                    <span className="strand-card-count">
                      {count} {count === 1 ? "piece" : "pieces"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    );
  }

  return <StrandDetail {...props} strand={selected} byId={byId} onBack={() => setSelectedId(null)} />;
}

function StrandDetail({
  strand,
  byId,
  onBack,
  onRename,
  onDelete,
  onAddTo,
  onRemoveFrom,
  onReorder,
  onWriteIn,
  onWriteInAfter,
  onWriteChapter,
  onAddPhoto,
  onSaveEntry,
  onDeleteEntry,
  onAnchor,
  onSetHeading,
  onExport,
  onAttachMedia,
  onRemoveMedia,
  onSetMediaConfig,
  getMediaUrl,
}: Props & { strand: Strand; byId: Map<string, Entry>; onBack: () => void }) {
  const [reading, setReading] = useState(false);
  const [titleDraft, setTitleDraft] = useState(strand.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [compose, setCompose] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);

  const ordered = strandEntries(strand.entryIds, byId);
  const { sections } = readAsOne(ordered, { headings: true });
  const toc = sections.filter((s) => s.heading).map((s) => s.heading!);

  // Where a piece added "to this chapter" lands: the end of that heading's
  // section (its last piece), or the heading itself if the section is empty.
  const sectionEndByHeading = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) {
      if (s.heading) map.set(s.heading.id, s.body.length ? s.body[s.body.length - 1].id : s.heading.id);
    }
    return map;
  }, [sections]);

  function move(index: number, dir: -1 | 1) {
    const ids = [...strand.entryIds];
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    onReorder(strand.id, ids);
  }

  function write() {
    const text = compose.trim();
    if (!text) return;
    onWriteIn(strand.id, text);
    setCompose("");
  }

  return (
    <main className="strands" aria-live="polite">
      <div className="strand-top">
        <button className="lock-link" onClick={onBack}>
          ‹ Strands
        </button>
        <div className="strand-top-actions">
          <button className="ghost-btn" onClick={() => setReading((r) => !r)}>
            {reading ? "Arrange" : "Read"}
          </button>
          <button className="ghost-btn" onClick={() => onExport(strand, ordered)}>
            Export
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              if (confirm(`Delete the strand “${strand.title}”? Your thoughts stay in the Stream.`))
                onDelete(strand);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {editingTitle ? (
        <input
          className="anchor-input strand-title-input"
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            onRename(strand.id, titleDraft);
            setEditingTitle(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(strand.id, titleDraft);
              setEditingTitle(false);
            }
          }}
        />
      ) : (
        <h2 className="strand-title" onClick={() => { setTitleDraft(strand.title); setEditingTitle(true); }}>
          {strand.title || "Untitled"}
        </h2>
      )}

      {reading ? (
        <div className="strand-read">
          {ordered.length === 0 ? (
            <p className="strand-read-empty">Nothing here yet.</p>
          ) : (
            <>
              {toc.length > 1 && (
                <nav className="reader-toc" aria-label="Sections">
                  {toc.map((h) => (
                    <a key={h.id} href={`#strand-section-${h.id}`} className="reader-toc-item">
                      {h.text || "Untitled section"}
                    </a>
                  ))}
                </nav>
              )}
              {sections.map((section, i) => (
                <div key={section.heading?.id ?? `section-${i}`}>
                  {section.heading && (
                    <h3 className="reader-section-heading" id={`strand-section-${section.heading.id}`}>
                      {section.heading.text || "Untitled section"}
                    </h3>
                  )}
                  {section.body.map((e) => (
                    <div key={e.id} className="read-piece">
                      {e.text && <p>{e.text}</p>}
                      {e.mediaIds && e.mediaIds.length > 0 && (
                        <div className="media-grid">
                          {e.mediaIds.map((mid) => (
                            <MediaThumb
                              key={mid}
                              mediaId={mid}
                              getUrl={getMediaUrl}
                              config={e.mediaConfig?.[mid]}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          {ordered.map((e, i) => (
            <div className={e.heading ? "strand-piece strand-piece-heading" : "strand-piece"} key={e.id}>
              <div className="strand-piece-ctl">
                <button className="act" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  ↑
                </button>
                <button
                  className="act"
                  disabled={i === ordered.length - 1}
                  onClick={() => move(i, 1)}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="act"
                  onClick={() => onRemoveFrom(strand.id, e.id)}
                  title="Remove from this strand"
                >
                  ✕
                </button>
              </div>
              <div className="strand-piece-body">
                {e.heading ? (
                  <button
                    className="heading-badge"
                    onClick={() => onSetHeading(e.id, false)}
                    title="Unflag as a section heading"
                  >
                    Heading <span className="heading-badge-x">✕</span>
                  </button>
                ) : (
                  <button className="heading-link" onClick={() => onSetHeading(e.id, true)}>
                    + Make this a heading
                  </button>
                )}
                <EntryItem
                  entry={e}
                  recent={false}
                  displayTime=""
                  onSave={onSaveEntry}
                  onDelete={onDeleteEntry}
                  onAnchor={onAnchor}
                  onAttachMedia={onAttachMedia}
                  onRemoveMedia={onRemoveMedia}
                  onSetMediaConfig={onSetMediaConfig}
                  getMediaUrl={getMediaUrl}
                />
                {e.heading && (
                  <HeadingAdd
                    onAdd={(text) => onWriteInAfter(strand.id, text, sectionEndByHeading.get(e.id) ?? e.id)}
                  />
                )}
              </div>
            </div>
          ))}

          <NewChapter onAdd={(title) => onWriteChapter(strand.id, title)} />

          <div className="strand-compose">
            <textarea
              className="edit"
              placeholder="Write the next piece — it joins this strand and your Stream…"
              value={compose}
              onChange={(e) => setCompose(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  write();
                }
              }}
            />
            <div className="edit-foot">
              <button className="save-btn" disabled={!compose.trim()} onClick={write}>
                Add piece
              </button>
              <button className="ghost-btn" onClick={() => photoRef.current?.click()}>
                ＋ Photo
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onAddPhoto(strand.id, f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <StrandPicker
            strand={strand}
            entries={[...byId.values()]}
            onAddTo={(eid) => onAddTo(strand.id, eid)}
          />
        </>
      )}
    </main>
  );
}

// A quiet way to write straight into a chapter, so building it out doesn't
// mean writing at the bottom of the whole strand and dragging each piece up.
// Lands at the end of that heading's section — see sectionEndByHeading.
// Start a chapter in one step — write + flag as a heading together — instead
// of writing a plain piece and separately flagging it after. The placeholder
// mixes a few different structures (a book's chapters, a song's verses, a
// play's acts) so it reads as a general tool, not one tuned to any of them —
// a heading is still just a piece, flagged.
function NewChapter({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function submit() {
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="ghost-btn new-chapter-link" onClick={() => setOpen(true)}>
        + New chapter
      </button>
    );
  }

  return (
    <div className="new-chapter">
      <input
        className="anchor-input"
        autoFocus
        placeholder="Chapter One, Verse 1, Act II…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setDraft("");
            setOpen(false);
          }
        }}
      />
      <button className="save-btn" disabled={!draft.trim()} onClick={submit}>
        Start
      </button>
      <button
        className="ghost-btn"
        onClick={() => {
          setDraft("");
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function HeadingAdd({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="heading-add-link" onClick={() => setOpen(true)}>
        + Add to this chapter
      </button>
    );
  }

  return (
    <div className="heading-add">
      <textarea
        className="edit"
        autoFocus
        placeholder="Add a piece to this chapter…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setDraft("");
            setOpen(false);
          }
        }}
      />
      <div className="edit-foot">
        <button className="save-btn" disabled={!draft.trim()} onClick={submit}>
          Add
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            setDraft("");
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StrandPicker({
  strand,
  entries,
  onAddTo,
}: {
  strand: Strand;
  entries: Entry[];
  onAddTo: (entryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const candidates = useMemo(() => {
    const inStrand = new Set(strand.entryIds);
    const query = q.trim().toLowerCase();
    return entries
      .filter((e) => !inStrand.has(e.id))
      .filter((e) => !query || e.text.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [entries, strand.entryIds, q]);

  if (!open) {
    return (
      <button className="ghost-btn strand-pull" onClick={() => setOpen(true)}>
        + Pull in a thought
      </button>
    );
  }

  return (
    <div className="strand-picker">
      <input
        className="anchor-input"
        autoFocus
        placeholder="Search your thoughts to pull in…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="strand-picker-list">
        {candidates.map((e) => (
          <li key={e.id}>
            <button className="strand-pick" onClick={() => onAddTo(e.id)}>
              {e.text.length > 90 ? e.text.slice(0, 90) + "…" : e.text}
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="strand-pick-empty">No matching thoughts.</li>}
      </ul>
      <button className="ghost-btn" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  );
}
