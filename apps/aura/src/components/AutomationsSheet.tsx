// AutomationsSheet.tsx — "when <trigger>, do <action>." Calm and finite: a clock
// time or a sun event, then a scene / room / all-off. Sun triggers need your
// location once (for the maths); we ask only when you pick one. Honest note in the
// footer: these run while Aura is open — background firing arrives with the desktop
// app.
import { useMemo, useState } from "react";
import { Sheet } from "@lantern/ui";
import { nextFire, type Action, type Automation, type Coords, type Trigger } from "../lib/automations";
import type { StoredScene } from "../lib/db";
import type { Room } from "../lib/rooms";

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fmtMinutes = (min: number) => {
  const d = new Date();
  d.setHours(0, min, 0, 0);
  return fmtTime(d);
};
const parseHHMM = (v: string): number => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const offsetLabel = (o: number) => (o === 0 ? "" : o > 0 ? ` +${o}m` : ` −${Math.abs(o)}m`);

function describeTrigger(t: Trigger): string {
  if (t.kind === "time") return fmtMinutes(t.minutes);
  return (t.event === "sunset" ? "Sunset" : "Sunrise") + offsetLabel(t.offsetMin);
}
function describeAction(a: Action, scenes: StoredScene[], rooms: Room[]): string {
  if (a.kind === "allOff") return "All off";
  if (a.kind === "scene") return scenes.find((s) => s.id === a.sceneId)?.name ?? "Scene";
  const room = rooms.find((r) => r.id === a.roomId)?.name ?? "Room";
  return `${room} ${a.on ? "on" : "off"}`;
}
function describeNext(a: Automation, coords: Coords | null): string | null {
  const n = nextFire(a, new Date(), coords);
  if (!n) return null;
  const now = new Date();
  const sameDay = n.toDateString() === now.toDateString();
  const tom = new Date(now);
  tom.setDate(now.getDate() + 1);
  const when = sameDay ? "today" : n.toDateString() === tom.toDateString() ? "tomorrow" : "";
  return `Next: ${when} ${fmtTime(n)}`.replace("  ", " ");
}

type ActionChoice = "scene" | "roomOn" | "roomOff" | "allOff";

export function AutomationsSheet({
  automations,
  scenes,
  rooms,
  coords,
  onRequestLocation,
  onAdd,
  onToggle,
  onRemove,
  onClose,
}: {
  automations: Automation[];
  scenes: StoredScene[];
  rooms: Room[];
  coords: Coords | null;
  onRequestLocation: () => Promise<Coords | null>;
  onAdd: (name: string, trigger: Trigger, action: Action) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [triggerKind, setTriggerKind] = useState<"time" | "sunset" | "sunrise">("sunset");
  const [timeValue, setTimeValue] = useState("18:00");
  const [offsetMin, setOffsetMin] = useState(0);
  const [locating, setLocating] = useState(false);

  const actionChoices = useMemo<{ id: ActionChoice; label: string; disabled?: boolean }[]>(
    () => [
      { id: "scene", label: "Apply a scene", disabled: scenes.length === 0 },
      { id: "roomOff", label: "Turn a room off", disabled: rooms.length === 0 },
      { id: "roomOn", label: "Turn a room on", disabled: rooms.length === 0 },
      { id: "allOff", label: "All off" },
    ],
    [scenes.length, rooms.length]
  );
  const [actionKind, setActionKind] = useState<ActionChoice>(scenes.length ? "scene" : "allOff");
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? "");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");

  const needsLocation = triggerKind !== "time" && !coords;

  function buildTrigger(): Trigger {
    if (triggerKind === "time") return { kind: "time", minutes: parseHHMM(timeValue) };
    return { kind: "sun", event: triggerKind, offsetMin };
  }
  function buildAction(): Action {
    if (actionKind === "scene") return { kind: "scene", sceneId };
    if (actionKind === "allOff") return { kind: "allOff" };
    return { kind: "roomPower", roomId, on: actionKind === "roomOn" };
  }

  async function useLocation() {
    setLocating(true);
    await onRequestLocation();
    setLocating(false);
  }

  function add() {
    onAdd("", buildTrigger(), buildAction());
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Automations">
      <h3>Automations</h3>

      {automations.length > 0 && (
        <ul className="auto-list">
          {automations.map((a) => (
            <li className={"auto-row" + (a.enabled ? "" : " off")} key={a.id}>
              <div className="auto-main">
                <span className="auto-when">{describeTrigger(a.trigger)}</span>
                <span className="auto-arrow">→</span>
                <span className="auto-do">{describeAction(a.action, scenes, rooms)}</span>
                {a.enabled && describeNext(a, coords) && (
                  <span className="auto-next">{describeNext(a, coords)}</span>
                )}
              </div>
              <div className="auto-controls">
                <button
                  className="toggle sm"
                  role="switch"
                  aria-checked={a.enabled}
                  aria-label={a.enabled ? "Disable" : "Enable"}
                  onClick={() => onToggle(a.id)}
                >
                  <span className="toggle-knob" />
                </button>
                <button className="scene-x static" aria-label="Remove" onClick={() => onRemove(a.id)}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="set-section auto-new">
        <span className="label">New automation</span>

        <div className="seg">
          {(["sunset", "sunrise", "time"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="seg-btn"
              aria-pressed={triggerKind === k}
              onClick={() => setTriggerKind(k)}
            >
              {k === "time" ? "Clock" : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        {triggerKind === "time" ? (
          <label className="field">
            <span className="label">At</span>
            <input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span className="label">Offset (minutes, − for before)</span>
            <input
              type="number"
              step={5}
              value={offsetMin}
              onChange={(e) => setOffsetMin(Number(e.target.value) || 0)}
            />
            <span className="hint">
              e.g. −15 lights come up 15 min before {triggerKind}. 0 is right at {triggerKind}.
            </span>
          </label>
        )}

        {needsLocation && (
          <div className="loc-note">
            <p className="hint">Sun triggers need your location to know when {triggerKind} is.</p>
            <button className="btn btn-sm" onClick={useLocation} disabled={locating}>
              {locating ? "Locating…" : "Use my location"}
            </button>
          </div>
        )}

        <label className="field">
          <span className="label">Do</span>
          <select value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionChoice)}>
            {actionChoices.map((c) => (
              <option key={c.id} value={c.id} disabled={c.disabled}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {actionKind === "scene" && scenes.length > 0 && (
          <label className="field">
            <span className="label">Scene</span>
            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {(actionKind === "roomOn" || actionKind === "roomOff") && rooms.length > 0 && (
          <label className="field">
            <span className="label">Room</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={add} disabled={needsLocation}>
            Add automation
          </button>
        </div>
      </div>

      <p className="hint auto-foot">
        Automations run while Aura is open on this device. Reliable background timing —
        firing with the app closed — comes with the desktop app.
      </p>
    </Sheet>
  );
}
