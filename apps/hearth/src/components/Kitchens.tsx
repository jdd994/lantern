// Kitchens.tsx
// A shared kitchen: recipes you keep with the people you actually cook with.
//
// The copy matters here. This is the only place in Hearth another person can see,
// so it says plainly what is and isn't shared — and it never implies your log or
// your body are part of the deal.
import { useState } from "react";
import type { Kitchen } from "../lib/kitchen";
import type { Recipe } from "../lib/nutrition";

export function Kitchens({
  kitchens, recipes, account, busy, error, onCreate, onInvite, onShare, onCook, onRefresh,
}: {
  kitchens: Kitchen[];
  recipes: Recipe[]; // your own, to offer into a kitchen
  account: string | null;
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onInvite: (strandId: string, email: string) => Promise<string | null>;
  onShare: (strandId: string, recipe: Recipe) => void;
  onCook: (r: Recipe) => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  async function invite(strandId: string) {
    const err = await onInvite(strandId, email);
    setNote(err ?? `Invited ${email.trim()} — they'll see the kitchen next time they open Hearth.`);
    if (!err) { setEmail(""); setInviting(null); }
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Shared kitchens</h2>
        {account ? (
          <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {!account ? (
        <div className="empty">
          A kitchen is shared through an account, so connect one first. Only the recipes you put in a
          kitchen are shared — your log, your body metrics and your goals never are.
        </div>
      ) : (
        <>
          {error ? <div className="error">{error}</div> : null}
          {note ? <p className="hint">{note}</p> : null}

          {kitchens.length === 0 ? (
            <div className="empty">
              No shared kitchens yet. Make one for the people you cook with — recipes you add are
              encrypted with a key only its members hold.
            </div>
          ) : (
            kitchens.map((k) => (
              <div className="kitchen" key={k.strandId}>
                <div className="kitchen-head">
                  <span className="kitchen-name">{k.name}</span>
                  <span className="kitchen-role">{k.role}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setInviting(inviting === k.strandId ? null : k.strandId)}>
                    Invite
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSharing(sharing === k.strandId ? null : k.strandId)}>
                    Add a recipe
                  </button>
                </div>

                {inviting === k.strandId ? (
                  <div className="kitchen-row">
                    <input
                      type="email"
                      value={email}
                      placeholder="their email"
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void invite(k.strandId)}
                    />
                    <button className="btn btn-sm btn-primary" disabled={busy || !email.trim()} onClick={() => void invite(k.strandId)}>
                      Invite
                    </button>
                  </div>
                ) : null}

                {sharing === k.strandId ? (
                  recipes.length === 0 ? (
                    <p className="hint">Save a recipe of your own first, then you can put it in here.</p>
                  ) : (
                    <div className="chips">
                      {recipes.map((r) => (
                        <button key={r.id} className="chip chip-btn" disabled={busy} onClick={() => { onShare(k.strandId, r); setSharing(null); }}>
                          + {r.name}
                        </button>
                      ))}
                    </div>
                  )
                ) : null}

                {k.recipes.length === 0 ? (
                  <p className="hint">Nothing in this kitchen yet.</p>
                ) : (
                  k.recipes.map((r) => (
                    <div className="recipe" key={r.id}>
                      <div className="recipe-main">
                        <div className="recipe-name">{r.name}</div>
                        <div className="recipe-meta">
                          {r.servings} serving{r.servings === 1 ? "" : "s"} · shared
                        </div>
                      </div>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onCook(r)} title="Log one serving — privately">
                        Cook
                      </button>
                    </div>
                  ))
                )}
              </div>
            ))
          )}

          <div className="kitchen-row" style={{ marginTop: 12 }}>
            <input
              type="text"
              value={name}
              placeholder="New kitchen — Home, Sunday dinners…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && onCreate(name)}
            />
            <button className="btn btn-sm" disabled={busy || !name.trim()} onClick={() => { onCreate(name); setName(""); }}>
              Make a kitchen
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            Only what you put in a kitchen is shared, and only with its members — encrypted with a key
            the server never holds. Cooking something here logs it privately to you.
          </p>
        </>
      )}
    </section>
  );
}
