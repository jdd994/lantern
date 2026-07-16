// LogFood.tsx
// Search the bundled food database, pick a portion (or type grams), log it.
// Search is fully local — the provider-learns-nothing rung.
//
// Type a barcode instead and we ask Open Food Facts (tier 1). That's the one
// outbound food request the app makes, so it says so, right where it happens:
// OFF learns a barcode was looked up and nothing else. The camera/recognize seam
// (tier 2) is still empty by design.

import { useEffect, useMemo, useState } from "react";
import { searchFoods, foodDbReady } from "../lib/fooddata";
import { isBarcode, lookupBarcode } from "../lib/fooddata/off";
import { scale, type Food } from "../lib/nutrition";

export function LogFood({
  busy, onLog, onClose,
}: {
  busy: boolean;
  onLog: (food: Food, grams: number, note?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState<number>(100);
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => { void foodDbReady.then(() => setReady(true)); }, []);

  const results = useMemo(() => searchFoods(query), [query, ready]);

  // Barcode path (tier 1). Only fires for something that actually looks like a
  // barcode, so ordinary searching never touches the network.
  const scanning = isBarcode(query);
  const [offFood, setOffFood] = useState<Food | null>(null);
  const [offBusy, setOffBusy] = useState(false);
  const [offMiss, setOffMiss] = useState(false);
  const [offError, setOffError] = useState<string | null>(null);

  useEffect(() => {
    if (!scanning) { setOffFood(null); setOffMiss(false); setOffError(null); return; }
    const ac = new AbortController();
    setOffBusy(true);
    setOffMiss(false);
    setOffError(null);
    lookupBarcode(query, ac.signal)
      .then((f) => { setOffFood(f); setOffMiss(f === null); })
      .catch((e) => { if (!ac.signal.aborted) setOffError(e instanceof Error ? e.message : "Lookup failed."); })
      .finally(() => { if (!ac.signal.aborted) setOffBusy(false); });
    return () => ac.abort();
  }, [query, scanning]);

  function pick(food: Food) {
    setPicked(food);
    setGrams(food.portions[0]?.grams ?? 100);
  }

  const preview = picked ? scale(picked.per100g, grams) : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {!picked ? (
          <>
            <h3>What did you eat?</h3>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a food, or type a barcode"
              autoFocus
              inputMode="text"
            />
            {scanning ? (
              <div className="results">
                {offBusy ? <p className="hint" style={{ padding: "10px 2px" }}>Looking that barcode up…</p> : null}
                {offError ? <div className="error">{offError}</div> : null}
                {offFood ? (
                  <button className="result" onClick={() => pick(offFood)}>
                    <span className="result-name">
                      {offFood.name} <span className="tier-badge">Open Food Facts</span>
                    </span>
                    <span className="result-kcal">{Math.round(offFood.per100g.kcal)} kcal/100g</span>
                  </button>
                ) : null}
                {offMiss && !offBusy ? (
                  <p className="hint" style={{ padding: "10px 2px" }}>
                    Open Food Facts doesn't have that one — common for local products. Search for it
                    by name instead, and it'll log just the same.
                  </p>
                ) : null}
                <p className="hint" style={{ padding: "8px 2px" }}>
                  Barcodes are looked up at Open Food Facts, so they learn a barcode was looked up
                  (and your IP) — never who you are or what else you ate. Everything else in Hearth
                  stays on this device. Data © Open Food Facts contributors (ODbL).
                </p>
              </div>
            ) : (
            <div className="results">
              {query && results.length === 0 ? (
                <p className="hint" style={{ padding: "10px 2px" }}>
                  No matches — try a simpler or different name (e.g. "rice", "chicken breast").
                  For a packaged product, type its barcode instead.
                </p>
              ) : (
                results.map((f) => (
                  <button key={f.id} className="result" onClick={() => pick(f)}>
                    <span className="result-name">{f.name}</span>
                    <span className="result-kcal">{Math.round(f.per100g.kcal)} kcal/100g</span>
                  </button>
                ))
              )}
            </div>
            )}
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h3>{picked.name}</h3>

            <span className="label">How much?</span>
            <div className="portions">
              {picked.portions.map((p) => (
                <button
                  key={p.label}
                  className="portion"
                  aria-pressed={grams === p.grams}
                  onClick={() => setGrams(p.grams)}
                >
                  {p.label} · {p.grams}g
                </button>
              ))}
            </div>

            <label className="field">
              <span className="label">…or grams</span>
              <input
                type="number"
                min={1}
                value={grams}
                onChange={(e) => setGrams(Math.max(1, Number(e.target.value) || 0))}
              />
            </label>

            {preview ? (
              <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
                ≈ {Math.round(preview.kcal)} kcal · {preview.protein.toFixed(1)}g protein ·{" "}
                {preview.carbs.toFixed(1)}g carbs · {preview.fat.toFixed(1)}g fat
              </p>
            ) : null}

            <label className="field">
              <span className="label">Note (optional)</span>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="with breakfast…" />
            </label>

            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setPicked(null)}>Back</button>
              <button
                className="btn btn-primary"
                disabled={busy || grams < 1}
                onClick={async () => { await onLog(picked, grams, note.trim() || undefined); onClose(); }}
              >
                {busy ? "Logging…" : "Log it"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
