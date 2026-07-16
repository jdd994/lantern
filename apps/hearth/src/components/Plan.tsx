// Plan.tsx
// The week ahead: what you mean to cook, and when. A PULL surface — you look at
// it when you want to. It never notifies, never scores you, and a day with
// nothing planned (or planned and not cooked) is just a day, not a failure. The
// numbers are information, shown calmly.
//
// Cooking a planned meal logs it through the ordinary food-log path, so the plan
// and the log stay one story rather than two.

import { useState } from "react";
import {
  MEAL_SLOTS, SLOT_LABEL, entriesForDay, plannedDayTotal, plannedNutrients,
  startOfDay, weekDays, type MealSlot, type PlanContent, type PlanEntry,
} from "../lib/mealplan";
import type { Recipe } from "../lib/nutrition";

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

export function Plan({
  plans, recipes, busy, weekOf, onWeek, onCook, onRemove, onAdd,
}: {
  plans: PlanEntry[];
  recipes: Recipe[];
  busy: boolean;
  weekOf: number;
  onWeek: (ms: number) => void;
  onCook: (e: PlanEntry) => void;
  onRemove: (id: string) => void;
  onAdd: (day: number) => void;
}) {
  const days = weekDays(weekOf);
  const today = startOfDay(Date.now());
  const shift = (weeks: number) => {
    const d = new Date(weekOf);
    d.setDate(d.getDate() + weeks * 7);
    onWeek(d.getTime());
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">The week ahead</h2>
        <div className="plan-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)} title="Previous week">‹</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onWeek(Date.now())}>This week</button>
          <button className="btn btn-ghost btn-sm" onClick={() => shift(1)} title="Next week">›</button>
        </div>
      </div>

      {recipes.length === 0 ? (
        <div className="empty">
          Save a recipe first — then you can plan it into a day, and cooking it logs itself.
        </div>
      ) : (
        days.map((day) => {
          const entries = entriesForDay(plans, day);
          const total = plannedDayTotal(plans, day, recipes);
          return (
            <div className={"plan-day" + (day === today ? " is-today" : "")} key={day}>
              <div className="plan-day-head">
                <span className="plan-day-name">
                  {dayLabel(day)}
                  {day === today ? <span className="plan-today"> today</span> : null}
                </span>
                {entries.length > 0 ? (
                  <span className="plan-day-total">{Math.round(total.kcal)} kcal planned</span>
                ) : null}
                <button className="btn btn-ghost btn-sm" onClick={() => onAdd(day)} title="Plan a meal">+</button>
              </div>

              {entries.length === 0 ? (
                <div className="plan-none">Nothing planned</div>
              ) : (
                entries.map((e) => {
                  const nut = plannedNutrients(e, recipes);
                  return (
                    <div className={"plan-entry" + (e.cookedAt ? " is-cooked" : "")} key={e.id}>
                      <span className="plan-slot">{SLOT_LABEL[e.slot]}</span>
                      <span className="plan-name">{e.name}</span>
                      <span className="plan-kcal">{nut ? `${Math.round(nut.kcal)} kcal` : "—"}</span>
                      {e.cookedAt ? (
                        <span className="plan-cooked">Cooked</span>
                      ) : (
                        <button className="btn btn-sm" disabled={busy} onClick={() => onCook(e)} title="Cook it and log it">
                          Cook
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => onRemove(e.id)} title="Remove">×</button>
                    </div>
                  );
                })
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

export function AddPlan({
  day, recipes, onAdd, onClose,
}: {
  day: number;
  recipes: Recipe[];
  onAdd: (content: PlanContent, at: number) => Promise<void>;
  onClose: () => void;
}) {
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [servings, setServings] = useState(1);
  const [busy, setBusy] = useState(false);

  async function save() {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    setBusy(true);
    await onAdd(
      { slot, kind: "recipe", recipeId: recipe.id, name: recipe.name, servings: Math.max(1, servings) },
      day
    );
    setBusy(false);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Plan for {dayLabel(day)}</h3>

        <label className="field">
          <span className="label">Meal</span>
          <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
            {MEAL_SLOTS.map((s) => (
              <option key={s} value={s}>{SLOT_LABEL[s]}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="label">Recipe</span>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="label">Servings</span>
          <input
            type="number"
            min={1}
            max={20}
            value={servings}
            onChange={(e) => setServings(Number(e.target.value) || 1)}
          />
        </label>

        <p className="hint">
          Planning a plain food (not a recipe) is coming — for now, plan the things you cook.
        </p>

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !recipeId} onClick={() => void save()}>
            Add to plan
          </button>
        </div>
      </div>
    </div>
  );
}
