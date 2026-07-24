// RoomsSheet.tsx — organize your lights by the place they're in. Make rooms, name
// them, and drop each light into one. Mostly flat — a light is in one room or
// none — with one exception: a "combo" room that shares another room's lights,
// for spatially-open areas (an open kitchen/living/dining) you sometimes want
// to control together and sometimes separately. See lib/rooms.ts.
import { useState } from "react";
import { Sheet } from "@lantern/ui";
import type { Device } from "../lib/connectors";
import { comboLabel, isCombo, type Room } from "../lib/rooms";

export function RoomsSheet({
  rooms,
  devices,
  onCreate,
  onRename,
  onDelete,
  onAssign,
  onCreateCombo,
  onClose,
}: {
  rooms: Room[];
  devices: Device[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAssign: (deviceId: string, roomId: string | null) => void;
  onCreateCombo: (name: string, memberRoomIds: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [comboName, setComboName] = useState("");
  const [comboMembers, setComboMembers] = useState<string[]>([]);
  const literalRooms = rooms.filter((r) => !isCombo(r));
  const roomOf = (deviceId: string) => rooms.find((r) => r.deviceIds.includes(deviceId))?.id ?? "";

  function add() {
    if (!name.trim()) return;
    onCreate(name);
    setName("");
  }

  function toggleComboMember(id: string) {
    setComboMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addCombo() {
    if (!comboName.trim() || comboMembers.length < 2) return;
    onCreateCombo(comboName, comboMembers);
    setComboName("");
    setComboMembers([]);
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
                {isCombo(r) ? (
                  <div className="room-combo-row">
                    <input
                      className="room-rename"
                      defaultValue={r.name}
                      aria-label={`Rename ${r.name}`}
                      onBlur={(e) => e.target.value.trim() && onRename(r.id, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    <span className="hint room-combo-note">Combo of {comboLabel(r, rooms)}</span>
                  </div>
                ) : (
                  <input
                    className="room-rename"
                    defaultValue={r.name}
                    aria-label={`Rename ${r.name}`}
                    onBlur={(e) => e.target.value.trim() && onRename(r.id, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => onDelete(r.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {literalRooms.length > 1 && (
        <div className="set-section">
          <span className="label">Combine rooms</span>
          <p className="hint">
            For an open space — pick two or more rooms to control together, without changing them on
            their own. To change which rooms it combines later, delete it and make it again.
          </p>
          <div className="combo-picker">
            {literalRooms.map((r) => (
              <label className="combo-check" key={r.id}>
                <input
                  type="checkbox"
                  checked={comboMembers.includes(r.id)}
                  onChange={() => toggleComboMember(r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
          <div className="scene-save">
            <input
              className="field-input"
              placeholder="Name this combo — Open concept, Downstairs…"
              value={comboName}
              onChange={(e) => setComboName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCombo()}
            />
            <div className="sheet-actions">
              <button className="btn btn-sm" onClick={addCombo} disabled={!comboName.trim() || comboMembers.length < 2}>
                Create combo
              </button>
            </div>
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <div className="set-section">
          <span className="label">Assign lights</span>
          {literalRooms.length === 0 ? (
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
                    {literalRooms.map((r) => (
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
