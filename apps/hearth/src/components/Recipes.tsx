// Recipes.tsx
// A recipe is a named ingredient list split into servings. Cooking one is a
// one-tap log of a serving — no re-entering what's in it.
//
// THE CAPTURE RULE (2026-08-07). Writing a recipe down costs one text box. You
// type the meal the way you'd say it out loud — "olive oil, two onions, the rest
// of the chickpeas" — and it saves. Nothing is required except a name and some
// words. Costing (matching a line to a food and giving it an amount) is CURATION
// YOU MAY DO LATER, per line, or never; a recipe that stays loose forever is a
// finished recipe, not a chore left undone.
//
// This inverts the old sheet, which made you search and weigh every ingredient
// before you could save at all — so the meals people actually cook, the
// thrown-together ones, never got written down.
//
// Two rules hold everywhere below:
//   - Never invent a number. An uncosted line shows its words, never an estimate.
//   - Never nag. "3 of 6 costed" is a fact offered, and no screen ever implies
//     you owe the app the other three.

import { useEffect, useMemo, useRef, useState } from "react";
import { searchFoods, foodDbReady } from "../lib/fooddata";
import { shrinkPhoto } from "../lib/photo";
import {
  recipePerServing, recipeServingGrams, recipeCoverage, recipeHasNumbers,
  parseIngredientLines, searchHintFor,
  type Food, type Recipe, type RecipeContent, type RecipeIngredient,
} from "../lib/nutrition";

// One honest sentence about how much of a recipe has numbers behind it. Stated
// the same way everywhere, so partial nutrients are never mistaken for a total.
function CoverageNote({ recipe }: { recipe: RecipeContent }) {
  const { costed, total, complete } = recipeCoverage(recipe);
  if (total === 0 || complete) return null;
  const per = recipePerServing(recipe);
  return (
    <p className="hint recipe-partial">
      {costed === 0 ? (
        <>Written down, not costed — add amounts whenever you feel like it.</>
      ) : (
        <>
          {costed} of {total} ingredients costed, so the {Math.round(per.kcal)} kcal below counts those only.
        </>
      )}
    </p>
  );
}

export function Recipes({
  recipes, busy, onCook, onOpen, onRemove,
}: {
  recipes: Recipe[];
  busy: boolean;
  onCook: (r: Recipe) => void;
  onOpen: (r: Recipe) => void;
  onRemove: (id: string) => void;
}) {
  if (recipes.length === 0) {
    return (
      <div className="empty">
        No recipes yet.
        <br />
        Jot down something you made — just the words is plenty.
      </div>
    );
  }
  return (
    <div>
      {recipes.map((r) => {
        const per = recipePerServing(r);
        const { costed, total } = recipeCoverage(r);
        const cookable = recipeHasNumbers(r);
        return (
          <div className="recipe" key={r.id}>
            {r.photo ? <img className="recipe-thumb" src={r.photo} alt="" /> : null}
            <button type="button" className="recipe-main" onClick={() => onOpen(r)}>
              <div className="recipe-name">{r.name}</div>
              <div className="recipe-meta">
                {r.servings === 1 ? "1 serving" : `${r.servings} servings`}
                {cookable ? (
                  <>
                    {" · "}
                    {Math.round(per.kcal)} kcal · {per.protein.toFixed(1)}g protein per serving
                    {costed < total ? (
                      <span className="recipe-partial-tag"> · from {costed} of {total} ingredients</span>
                    ) : null}
                  </>
                ) : (
                  <> · {total === 1 ? "1 ingredient" : `${total} ingredients`}, no amounts yet</>
                )}
              </div>
            </button>
            {cookable ? (
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onCook(r)} title="Log one serving">
                Cook
              </button>
            ) : (
              // Cooking an uncosted recipe would log zeros — "you ate nothing" —
              // so the offer is to cost it instead. Not a scold: one tap, and
              // only if you want the numbers.
              <button className="btn btn-sm btn-ghost" onClick={() => onOpen(r)} title="Add amounts to log it">
                Add amounts
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onRemove(r.id)} title="Remove">×</button>
          </div>
        );
      })}
    </div>
  );
}

// ---- the photo control -----------------------------------------------------
// Shared by capture and curation. The file never leaves the device: it's
// downscaled and re-encoded in the page (which also drops EXIF/GPS), then sealed
// with the rest of the recipe. See lib/photo.ts.
function PhotoField({
  photo, onPhoto,
}: {
  photo: string | undefined;
  onPhoto: (p: string | undefined) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file twice still fires
    if (!file) return;
    setError(null);
    setWorking(true);
    try {
      onPhoto(await shrinkPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo couldn't be added.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="field">
      <span className="label">Photo (optional)</span>
      {photo ? (
        <div className="photo-preview">
          <img src={photo} alt="Your photo of this recipe" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPhoto(undefined)}>
            Remove photo
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" disabled={working} onClick={() => fileRef.current?.click()}>
          {working ? "Shrinking…" : "Add a photo"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void pick(e)}
      />
      {error ? <div className="error">{error}</div> : null}
      <span className="hint">
        Shrunk on this device and encrypted with the recipe. Nothing looks at it — no recognition,
        no guessing what's on the plate. It's a photo you keep.
      </span>
    </div>
  );
}

// ---- capture ---------------------------------------------------------------

export function AddRecipe({
  onAdd, onClose,
}: {
  onAdd: (c: RecipeContent) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [blob, setBlob] = useState("");
  const [servings, setServings] = useState(2);
  const [tags, setTags] = useState("");
  const [method, setMethod] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(() => parseIngredientLines(blob), [blob]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name — anything you'll recognise later.");
    if (lines.length === 0) return setError("Write what went in, even roughly.");
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    await onAdd({
      name: name.trim(),
      servings: Math.max(1, servings),
      ingredients: lines.map((text): RecipeIngredient => ({ text })),
      ...(tagList.length ? { tags: tagList } : {}),
      ...(method.trim() ? { method: method.trim() } : {}),
      ...(photo ? { photo } : {}),
    });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Write down a meal</h3>
        <form onSubmit={save}>
          {error ? <div className="error">{error}</div> : null}

          <div className="row">
            <label className="field">
              <span className="label">Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday chickpea thing" autoFocus />
            </label>
            <label className="field">
              <span className="label">Servings</span>
              <input type="number" min={1} value={servings} onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          </div>

          <label className="field">
            <span className="label">What went in</span>
            <textarea
              rows={5}
              value={blob}
              onChange={(e) => setBlob(e.target.value)}
              placeholder={"olive oil, two onions\nthe rest of the chickpeas\na big spoon of harissa\nlemon"}
            />
            <span className="hint">
              However you'd say it out loud — one per line, or separated by commas. Amounts are
              welcome but never needed. You can add them later, or not at all.
            </span>
          </label>

          {lines.length > 0 ? (
            <div className="ingredients">
              {lines.map((l, i) => (
                <div className="ingredient" key={i}>
                  <span>{l}</span>
                </div>
              ))}
              <p className="hint">
                {lines.length === 1 ? "1 ingredient" : `${lines.length} ingredients`} — that's a
                recipe. Numbers are optional.
              </p>
            </div>
          ) : null}

          <PhotoField photo={photo} onPhoto={setPhoto} />

          <label className="field">
            <span className="label">How you made it (optional)</span>
            <textarea rows={3} value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Fried the onions, dumped everything in, 20 min." />
          </label>

          <label className="field">
            <span className="label">Moods (optional)</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="quick, comfort" />
            <span className="hint">
              Comma-separated, and entirely yours — used to find “something quick” from what's in
              your pantry. Nothing is inferred about you.
            </span>
          </label>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- curation --------------------------------------------------------------
// Opening a saved recipe. Every part of it is editable, and costing an
// ingredient is one tap: pick the food, say roughly how much. The line's own
// words seed the search, so "the rest of the chickpeas" looks up "chickpea".

function CostLine({
  ingredient, onCost, onClear, onClose,
}: {
  ingredient: RecipeIngredient;
  onCost: (c: NonNullable<RecipeIngredient["cost"]>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(() => searchHintFor(ingredient));
  const [pending, setPending] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const [ready, setReady] = useState(false);
  useEffect(() => { void foodDbReady.then(() => setReady(true)); }, []);
  const results = useMemo(() => searchFoods(query), [query, ready]);

  return (
    <div className="cost-line">
      <div className="cost-line-head">
        <strong>{ingredient.text}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
      </div>
      {!pending ? (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a food…"
            autoFocus
          />
          <div className="results" style={{ marginTop: 6 }}>
            {results.length === 0 ? (
              <p className="hint" style={{ padding: "8px 2px" }}>
                No matches — try a simpler word. It's fine to leave this one as words.
              </p>
            ) : (
              results.slice(0, 8).map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className="result"
                  onClick={() => { setPending(f); setGrams(f.portions[0]?.grams ?? 100); }}
                >
                  <span className="result-name">{f.name}</span>
                  <span className="result-kcal">{Math.round(f.per100g.kcal)} kcal/100g</span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field">
            <span className="label">{pending.name} — roughly how much?</span>
            <input
              type="number"
              min={1}
              value={grams}
              autoFocus
              onChange={(e) => setGrams(Math.max(1, Number(e.target.value) || 0))}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: "0 0 auto" }}
            onClick={() => onCost({ foodId: pending.id, name: pending.name, grams, per100g: pending.per100g })}
          >
            Set
          </button>
          <button type="button" className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => setPending(null)}>
            Back
          </button>
        </div>
      )}
      {ingredient.cost ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Back to just words
        </button>
      ) : null}
    </div>
  );
}

export function EditRecipe({
  recipe, onSave, onClose,
}: {
  recipe: Recipe;
  onSave: (id: string, c: RecipeContent) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(recipe.name);
  const [servings, setServings] = useState(recipe.servings);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(recipe.ingredients);
  const [tags, setTags] = useState((recipe.tags ?? []).join(", "));
  const [method, setMethod] = useState(recipe.method ?? "");
  const [photo, setPhoto] = useState<string | undefined>(recipe.photo);
  const [adding, setAdding] = useState("");
  const [costing, setCosting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft: RecipeContent = { name, servings, ingredients };
  const { costed, total } = recipeCoverage(draft);

  const setIngredient = (idx: number, next: RecipeIngredient) =>
    setIngredients((prev) => prev.map((it, i) => (i === idx ? next : it)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name — anything you'll recognise later.");
    if (ingredients.length === 0) return setError("A recipe needs at least a word about what's in it.");
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    await onSave(recipe.id, {
      name: name.trim(),
      servings: Math.max(1, servings),
      ingredients,
      ...(tagList.length ? { tags: tagList } : {}),
      ...(method.trim() ? { method: method.trim() } : {}),
      ...(photo ? { photo } : {}),
    });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{recipe.name}</h3>
        <form onSubmit={save}>
          {error ? <div className="error">{error}</div> : null}

          <div className="row">
            <label className="field">
              <span className="label">Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Servings</span>
              <input type="number" min={1} value={servings} onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          </div>

          <div className="field">
            <span className="label">What went in</span>
            <div className="ingredients">
              {ingredients.map((ing, idx) =>
                costing === idx ? (
                  <CostLine
                    key={idx}
                    ingredient={ing}
                    onCost={(cost) => { setIngredient(idx, { ...ing, cost }); setCosting(null); }}
                    onClear={() => { setIngredient(idx, { text: ing.text }); setCosting(null); }}
                    onClose={() => setCosting(null)}
                  />
                ) : (
                  <div className="ingredient" key={idx}>
                    <input
                      className="ingredient-text"
                      type="text"
                      value={ing.text}
                      onChange={(e) => setIngredient(idx, { ...ing, text: e.target.value })}
                    />
                    {ing.cost ? (
                      <button type="button" className="ing-g ing-costed" onClick={() => setCosting(idx)} title={ing.cost.name}>
                        {ing.cost.grams} g
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCosting(idx)}>
                        Add amount
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setIngredients((p) => p.filter((_, i) => i !== idx))}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                )
              )}
            </div>
            <div className="row" style={{ alignItems: "flex-end", marginTop: 6 }}>
              <input
                type="text"
                value={adding}
                placeholder="Something else that went in…"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const more = parseIngredientLines(adding);
                  if (!more.length) return;
                  setIngredients((p) => [...p, ...more.map((text) => ({ text }))]);
                  setAdding("");
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: "0 0 auto" }}
                onClick={() => {
                  const more = parseIngredientLines(adding);
                  if (!more.length) return;
                  setIngredients((p) => [...p, ...more.map((text) => ({ text }))]);
                  setAdding("");
                }}
              >
                Add
              </button>
            </div>
          </div>

          <CoverageNote recipe={draft} />
          {recipeHasNumbers(draft) ? (
            <p className="hint">
              Per serving ≈ {Math.round(recipePerServing(draft).kcal)} kcal ·{" "}
              {recipePerServing(draft).protein.toFixed(1)}g protein ·{" "}
              {Math.round(recipeServingGrams(draft))} g
              {costed < total ? " (from what's costed)" : ""}
            </p>
          ) : null}

          <PhotoField photo={photo} onPhoto={setPhoto} />

          <label className="field">
            <span className="label">How you made it (optional)</span>
            <textarea rows={3} value={method} onChange={(e) => setMethod(e.target.value)} />
          </label>

          <label className="field">
            <span className="label">Moods (optional)</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="quick, comfort" />
          </label>

          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
