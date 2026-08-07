// HomesSheet.tsx — your homes, each a whole world: its own connected brands,
// rooms, scenes, automations, rhythm, and location. Switch by tapping; the home
// you leave keeps running in the background (the keeper — its automations fire
// on its own sunset, not yours). Erasing a home is a two-tap affair and only
// ever touches this device — the brands themselves never know.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Home } from "../lib/homes";

export function HomesSheet({
  homes,
  activeId,
  onSwitch,
  onAdd,
  onRename,
  onRemove,
  onClose,
}: {
  homes: Home[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  function add() {
    onAdd(newName);
    setNewName("");
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Homes">
      <h3>Homes</h3>
      <p className="hint">
        Each home is its own world — connections, rooms, scenes, automations, rhythm, and location.
        Homes you're not looking at keep running: their automations fire on their own sun.
        Exports and transfers cover the home you're in.
      </p>

      <ul className="home-list">
        {homes.map((h) => {
          const active = h.id === activeId;
          return (
            <li className={"home-row" + (active ? " active" : "")} key={h.id}>
              <button
                type="button"
                className="home-pick"
                aria-pressed={active}
                onClick={() => !active && onSwitch(h.id)}
              >
                <span className="home-dot" aria-hidden="true" />
                <span className="home-name-text">{h.name}</span>
                {active && <span className="home-here">here now</span>}
              </button>
              <input
                className="room-rename home-rename"
                defaultValue={h.name}
                aria-label={`Rename ${h.name}`}
                onBlur={(e) => e.target.value.trim() !== h.name && onRename(h.id, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {!active &&
                (confirming === h.id ? (
                  <button
                    className="btn btn-sm home-erase"
                    onClick={() => {
                      setConfirming(null);
                      onRemove(h.id);
                    }}
                  >
                    Erase "{h.name}"?
                  </button>
                ) : (
                  <button
                    className="scene-x static"
                    aria-label={`Remove ${h.name}`}
                    onClick={() => setConfirming(h.id)}
                  >
                    ×
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {confirming && (
        <p className="hint">
          Erasing removes that home's connections, rooms, scenes, and automations from this device
          only — the lights and your brand accounts are untouched.
        </p>
      )}

      <div className="set-section">
        <span className="label">Add a home</span>
        <div className="describe-row">
          <input
            type="text"
            placeholder="The cabin, the shop, mom's place…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn btn-sm" onClick={add}>
            Add
          </button>
        </div>
        <p className="hint">
          A new home starts empty — connect its lights from there. The same brand account can be
          connected in more than one home; each home just keeps the rooms that live there.
        </p>
      </div>
    </Sheet>
  );
}
