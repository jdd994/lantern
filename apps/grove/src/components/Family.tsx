// Family.tsx — the shared tree. One co-authored family tree: every member
// reads and writes every record, attribution is a byline, never a score.
// Inviting is by an address you already know — there's no directory, no
// suggestions, no graph. That's the point.

import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { SharedTree } from "../hooks/useGrove";

export function Family({
  account,
  tree,
  treeBusy,
  treeError,
  onCreate,
  onInvite,
  onLeave,
  onRefresh,
  onOpenSync,
  onClose,
}: {
  account: string | null;
  tree: SharedTree | null;
  treeBusy: boolean;
  treeError: string | null;
  onCreate: (title: string) => Promise<string | null>;
  onInvite: (email: string) => Promise<string | null>;
  onLeave: () => Promise<string | null>;
  onRefresh: () => Promise<void>;
  onOpenSync: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const err = await onCreate(title);
    if (err) setError(err);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const em = email.trim();
    if (!em) return;
    const err = await onInvite(em);
    if (err) setError(err);
    else {
      setNotice(`Invited ${em} — the tree will be there next time they open Grove.`);
      setEmail("");
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Family tree">
      <h3>The family tree</h3>

      {!account ? (
        <>
          <p>
            A shared tree travels through your account — the server relays encrypted records it
            can't read, wrapped keys it can't open.
          </p>
          <p className="hint">Connect Sync first, then come back here to plant it.</p>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => { onClose(); onOpenSync(); }}>Open Sync</button>
          </div>
        </>
      ) : !tree ? (
        <>
          <p>
            One tree, written together. Everyone you invite reads and writes every person, bond,
            and keepsake — the way a family actually remembers. Your whole tree here becomes the
            starting point.
          </p>
          <p className="hint">
            Each record carries whose hand last touched it — a byline for stories, never a score.
          </p>
          <form onSubmit={create}>
            {error ? <div className="error">{error}</div> : null}
            {treeError ? <div className="error">{treeError}</div> : null}
            <label className="field">
              <span className="label">What should it be called?</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Hale tree" autoFocus />
            </label>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={treeBusy}>
                {treeBusy ? "Planting…" : "Plant the shared tree"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <p>
            <strong>{tree.title}</strong> — shared with the family. What anyone adds, everyone
            keeps: family records also back up under your own account, encrypted.
          </p>

          {tree.members.length ? (
            <section className="set-section">
              <h4 className="set-head">Who's in it</h4>
              {tree.members.map((m) => (
                <div key={m.userId} className="member-row">
                  <span className="member-email">{m.email}</span>
                  <span className="member-role">{m.role}</span>
                </div>
              ))}
            </section>
          ) : null}

          <section className="set-section">
            <h4 className="set-head">Invite family</h4>
            <p className="hint">
              By an address you already know. Their copy of the tree's key is wrapped so only they
              can open it — the server just carries the envelope.
            </p>
            <form onSubmit={invite}>
              {notice ? <p className="hint">{notice}</p> : null}
              {error ? <div className="error">{error}</div> : null}
              {treeError ? <div className="error">{treeError}</div> : null}
              <div className="row">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="them@example.com"
                />
                <button type="submit" className="btn" disabled={treeBusy || !email.trim()}>
                  {treeBusy ? "Inviting…" : "Invite"}
                </button>
              </div>
            </form>
          </section>

          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={() => void onRefresh()} disabled={treeBusy}>
              {treeBusy ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>

          <div className="danger-zone">
            {confirmLeave ? (
              <>
                <p className="hint">
                  Leaving stops sharing from this account. Everything already on this device stays
                  — the family's copy stays with the family.
                </p>
                <div className="sheet-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmLeave(false)}>Stay</button>
                  <button
                    className="btn btn-danger"
                    onClick={async () => {
                      const err = await onLeave();
                      if (err) setError(err);
                      else setConfirmLeave(false);
                    }}
                  >
                    Leave the shared tree
                  </button>
                </div>
              </>
            ) : (
              <button className="linklike danger" onClick={() => setConfirmLeave(true)}>
                Leave the shared tree
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
