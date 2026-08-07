// ListPage.tsx — one list, open at the door. Fast capture at the top (the
// sunscreen remembered at 11pm goes in with one thumb), still-to-gather in the
// middle, packed things settled quietly at the bottom.
//
// The claim chip is the soul of the shared case: an item is never assigned.
// The list says needed; a person says "I've got it." The only claim the app
// will ever write is your own.

import { useEffect, useState } from "react";
import { itemsFor, type Checklist, type Item } from "../lib/model";
import type { SharedList } from "../hooks/useManifest";
import { Down, Pencil, Up } from "./icons";

// them@example.com → "them" — a first-name-ish handle for chips.
function shortName(email: string): string {
  return email.split("@")[0] || email;
}

export function ListPage({
  list,
  items,
  shared,
  account,
  onBack,
  onRename,
  onAddItem,
  onToggle,
  onSetClaim,
  onEditItem,
  onMove,
  onRemoveItem,
  onDuplicate,
  onOpenShare,
  onRemoveList,
}: {
  list: Checklist;
  items: Item[];
  shared: SharedList | undefined;
  account: string | null;
  onBack: () => void;
  onRename: (title: string) => void;
  onAddItem: (text: string) => void;
  onToggle: (item: Item) => void;
  onSetClaim: (item: Item, mine: boolean) => void;
  onEditItem: (item: Item, text: string) => void;
  onMove: (item: Item, dir: -1 | 1) => void;
  onRemoveItem: (item: Item) => void;
  onDuplicate: () => void;
  onOpenShare: () => void;
  onRemoveList: () => void;
}) {
  const its = itemsFor(list.id, items);
  const [text, setText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [arranging, setArranging] = useState(false);

  useEffect(() => {
    setTitle(list.title);
    setRenaming(false);
    setConfirmRemove(false);
    setEditingId(null);
    setArranging(false);
  }, [list.id, list.title]);

  function saveEdit(item: Item) {
    const t = editText.trim();
    if (t && t !== item.text) onEditItem(item, t);
    setEditingId(null);
  }

  // A byline, never a score: on a shared list, whose hand added this — shown
  // only for other people's items, faintly.
  const myUserId = shared?.members.find((m) => m.email === account)?.userId;
  function authorHandle(i: Item): string | null {
    if (!shared || !i.author || i.author === myUserId) return null;
    const em = shared.members.find((m) => m.userId === i.author)?.email;
    return em ? shortName(em) : null;
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onAddItem(text);
    setText("");
  }

  function rename(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim()) onRename(title);
    setRenaming(false);
  }

  const others = shared ? shared.members.filter((m) => m.email !== account) : [];

  return (
    <>
      <button className="btn btn-ghost btn-sm back" onClick={onBack}>‹ All lists</button>

      <div className="list-head">
        {renaming ? (
          <form className="row" style={{ flex: 1 }} onSubmit={rename}>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm">Save</button>
          </form>
        ) : (
          <h2 className="list-title-lg">
            {list.title || "Untitled list"}{" "}
            <button className="linklike list-rename" onClick={() => setRenaming(true)}>rename</button>
          </h2>
        )}
        <div className="list-actions">
          <button className="btn btn-sm" onClick={onOpenShare} title={shared ? "Who's packing this together" : "Pack this list together"}>
            {shared ? `Shared · ${shared.members.length || "…"}` : "Share"}
          </button>
        </div>
      </div>
      {list.note ? <p className="list-note">{list.note}</p> : null}
      {shared && others.length ? (
        <p className="hint">Packed together with {others.map((m) => shortName(m.email)).join(", ")}.</p>
      ) : null}

      <form className="add-row" onSubmit={add}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add something — sunscreen, chargers, the good coffee…"
          aria-label="Add an item"
        />
        <button type="submit" className="btn" disabled={!text.trim()}>Add</button>
      </form>

      {its.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: "18px 0" }}>
          Empty so far. Add things as you think of them — the list does the remembering.
        </p>
      ) : (
        <>
          {its.length > 1 ? (
            <div className="items-tools">
              <button className="linklike" onClick={() => setArranging((a) => !a)}>
                {arranging ? "Done arranging" : "Arrange"}
              </button>
            </div>
          ) : null}
          <div className="items">
            {its.map((i) => {
              const group = its.filter((x) => x.checked === i.checked);
              const gi = group.findIndex((x) => x.id === i.id);
              return (
                <div key={i.id} className={`item-row${i.checked ? " item-done" : ""}`}>
                  {editingId === i.id ? (
                    <form
                      className="item-main"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveEdit(i);
                      }}
                    >
                      <input
                        type="text"
                        value={editText}
                        autoFocus
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={() => saveEdit(i)}
                        onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                        aria-label={`Edit ${i.text}`}
                      />
                    </form>
                  ) : (
                    <label className="item-main">
                      <input type="checkbox" checked={i.checked} onChange={() => onToggle(i)} />
                      <span className="item-text">
                        {i.text}
                        {authorHandle(i) ? <span className="item-author">· {authorHandle(i)}</span> : null}
                      </span>
                    </label>
                  )}
                  {arranging ? (
                    <>
                      <button className="item-x" disabled={gi <= 0} onClick={() => onMove(i, -1)} aria-label={`Move ${i.text} up`}>
                        <Up />
                      </button>
                      <button className="item-x" disabled={gi >= group.length - 1} onClick={() => onMove(i, 1)} aria-label={`Move ${i.text} down`}>
                        <Down />
                      </button>
                    </>
                  ) : (
                    <>
                      {shared && account ? (
                        i.claimedBy ? (
                          i.claimedBy === account ? (
                            <button className="claim claim-mine" onClick={() => onSetClaim(i, false)} title="Release your claim">
                              you've got it ✕
                            </button>
                          ) : (
                            <span className="claim">{shortName(i.claimedBy)} has it</span>
                          )
                        ) : !i.checked ? (
                          <button className="claim claim-offer" onClick={() => onSetClaim(i, true)}>
                            I've got it
                          </button>
                        ) : null
                      ) : null}
                      {editingId !== i.id ? (
                        <button
                          className="item-x"
                          onClick={() => {
                            setEditingId(i.id);
                            setEditText(i.text);
                          }}
                          aria-label={`Edit ${i.text}`}
                          title="Edit"
                        >
                          <Pencil />
                        </button>
                      ) : null}
                      <button className="item-x" onClick={() => onRemoveItem(i)} aria-label={`Remove ${i.text}`} title="Remove">
                        ×
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="section" style={{ marginTop: 26 }}>
        <button className="btn btn-sm" onClick={onDuplicate} title="A fresh private copy — everything unchecked, every claim released">
          New list from this one
        </button>
        <p className="hint" style={{ marginTop: 8 }}>
          Lists remember: next trip, start from this one — everything unchecked, claims released.
        </p>
      </div>

      <div className="danger-zone">
        {confirmRemove ? (
          <>
            <p className="hint">
              {shared
                ? "This list is shared — removing it removes it for everyone packing it. It can't be undone."
                : "This removes the list and everything on it. It can't be undone."}
            </p>
            <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>Keep it</button>
              <button className="btn btn-danger" onClick={onRemoveList}>Remove this list</button>
            </div>
          </>
        ) : (
          <button className="linklike danger" onClick={() => setConfirmRemove(true)}>
            Remove this list
          </button>
        )}
      </div>
    </>
  );
}
