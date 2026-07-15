// RoomsSheet.tsx — organize your lights by the place they're in. Make rooms, name
// them, and drop each light into one. Calm and flat: a light is in one room or
// none; no nesting, no drag-and-drop fuss.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Device } from "../lib/connectors";
import type { Room } from "../lib/rooms";

export function RoomsSheet({
  rooms,
  devices,
  onCreate,
  onRename,
  onDelete,
  onAssign,
  onClose,
}: {
  rooms: Room[];
  devices: Device[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAssign: (deviceId: string, roomId: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const roomOf = (deviceId: string) => rooms.find((r) => r.deviceIds.includes(deviceId))?.id ?? "";

  function add() {
    if (!name.trim()) return;
    onCreate(name);
    setName("");
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Rooms">
      <h3>Rooms</h3>

      <div className="scene-save">
        <input
          className="field-input"
          placeholder="New room — Living room, Backyard, Bedroom…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <div className="sheet-actions">
          <button className="btn btn-primary btn-sm" onClick={add} disabled={!name.trim()}>
            Add room
          </button>
        </div>
      </div>

      {rooms.length > 0 && (
        <div className="set-section">
          <span className="label">Your rooms</span>
          <ul className="source-list">
            {rooms.map((r) => (
              <li className="source-row" key={r.id}>
                <input
                  className="room-rename"
                  defaultValue={r.name}
                  aria-label={`Rename ${r.name}`}
                  onBlur={(e) => e.target.value.trim() && onRename(r.id, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => onDelete(r.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {devices.length > 0 && (
        <div className="set-section">
          <span className="label">Assign lights</span>
          {rooms.length === 0 ? (
            <p className="hint">Make a room above, then place each light in it.</p>
          ) : (
            <ul className="assign-list">
              {devices.map((d) => (
                <li className="assign-row" key={d.id}>
                  <span className="assign-name">{d.name}</span>
                  <select
                    className="assign-select"
                    value={roomOf(d.id)}
                    aria-label={`Room for ${d.name}`}
                    onChange={(e) => onAssign(d.id, e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
