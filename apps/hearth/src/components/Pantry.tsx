// Pantry.tsx
// What's in the cupboard, and what that means you can cook right now. All of it
// is answered offline from data you already own — nothing is asked of anyone.
//
// Tone: a recipe you can't quite make is not a failure, it's "you're one thing
// away". Nothing here is red, and there's no scolding about an empty cupboard.
import { useEffect, useMemo, useState } from "react";
import { searchFoods, foodDbReady } from "../lib/fooddata";
import { matchRecipes, recipeTags, type PantryItem } from "../lib/pantry";
import type { Recipe } from "../lib/nutrition";

export function Pantry({
  pantry, recipes, busy, onAdd, onRemove, onCook,
}: {
  pantry: PantryItem[];
  recipes: Recipe[];
  busy: boolean;
  onAdd: (foodId: string, name: string) => void;
  onRemove: (id: string) => void;
  onCook: (r: Recipe) => void;
}) {
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [mood, setMood] = useState<string | null>(null);
  useEffect(() => { void foodDbReady.then(() => setReady(true)); }, []);

  const results = useMemo(() => (query ? searchFoods(query, 6) : []), [query, ready]);
  const moods = useMemo(() => recipeTags(recipes), [recipes]);
  const matches = useMemo(() => matchRecipes(recipes, pantry, 2, mood ?? undefined), [recipes, pantry, mood]);

  // A mood that no longer exists (last tagged recipe deleted) shouldn't strand the list.
  useEffect(() => { if (mood && !moods.includes(mood)) setMood(null); }, [moods, mood]);

  function add(foodId: string, name: string) {
    onAdd(foodId, name);
    setQuery("");
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Pantry</h2>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add what you have — rice, onion, eggs…"
      />
      {results.length > 0 ? (
        <div className="results">
          {results.map((f) => (
            <button key={f.id} className="result" onClick={() => add(f.id, f.name)}>
              <span className="result-name">{f.name}</span>
              <span className="result-kcal">add</span>
            </button>
          ))}
        </div>
      ) : null}

      {pantry.length === 0 ? (
        <div className="empty">
          Nothing in the pantry yet. Add a few things you have, and Hearth will show what you can
          cook from them — all worked out on this device.
        </div>
      ) : (
        <div className="chips">
          {pantry.map((p) => (
            <span className="chip" key={p.id}>
              {p.name}
              <button className="chip-x" onClick={() => onRemove(p.id)} title={`Remove ${p.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {pantry.length > 0 ? (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2 className="section-title">What you can make</h2>
          </div>

          {moods.length > 0 ? (
            <div className="chips moods">
              <button
                className={"chip chip-btn" + (mood === null ? " is-on" : "")}
                onClick={() => setMood(null)}
              >
                Anything
              </button>
              {moods.map((t) => (
                <button
                  key={t}
                  className={"chip chip-btn" + (mood === t ? " is-on" : "")}
                  onClick={() => setMood(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}

          {matches.length === 0 ? (
            <div className="empty">
              {mood
                ? `Nothing tagged “${mood}” matches your pantry yet.`
                : "Nothing matches yet — add a few more things, or save a recipe you cook often."}
            </div>
          ) : (
            matches.map((m) => (
              <div className="recipe" key={m.recipe.id}>
                <div className="recipe-main">
                  <div className="recipe-name">{m.recipe.name}</div>
                  <div className="recipe-meta">
                    {m.missing.length === 0
                      ? "You have everything"
                      : `You're ${m.missing.length} away — ${m.missing.join(", ")}`}
                  </div>
                </div>
                {m.missing.length === 0 ? (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onCook(m.recipe)}>
                    Cook
                  </button>
                ) : null}
              </div>
            ))
          )}

          <p className="hint" style={{ marginTop: 10 }}>
            Worked out on this device from your own recipes — nothing is sent anywhere.
          </p>
        </>
      ) : null}
    </section>
  );
}
