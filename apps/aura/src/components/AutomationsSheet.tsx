// AutomationsSheet.tsx — "when <trigger> [on <days>], do <these things>." Calm and
// finite: a clock time or a sun event, an optional weekday filter, and one or more
// actions (scene / room / all off). Sun triggers need your location once (asked only
// when you pick one). These run while Aura is open — background firing arrives with
// the desktop app.
import { useMemo, useState } from "react";
import { Sheet } from "@lantern/ui";
import {
  actionsOf,
  nextFire,
  type Action,
  type Automation,
  type Coords,
  type Trigger,
} from "../lib/automations";
import type { Sensor } from "../lib/connectors";
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
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeTrigger(t: Trigger, sensors: Sensor[]): string {
  if (t.kind === "time") return fmtMinutes(t.minutes);
  if (t.kind === "sensor") {
    return `Motion · ${sensors.find((s) => s.id === t.sensorId)?.name ?? "sensor"}`;
  }
  return (t.event === "sunset" ? "Sunset" : "Sunrise") + offsetLabel(t.offsetMin);
}
function describeAction(a: Action, scenes: StoredScene[], rooms: Room[]): string {
  if (a.kind === "allOff") return "All off";
  if (a.kind === "scene") return scenes.find((s) => s.id === a.sceneId)?.name ?? "Scene";
  if (a.kind === "fade") {
    const scope = a.roomId ? (rooms.find((r) => r.id === a.roomId)?.name ?? "a room") : "all lights";
    return a.toBrightness <= 0
      ? `Wind ${scope} down over ${a.minutes}m`
      : `Fade ${scope} to ${a.toBrightness}% over ${a.minutes}m`;
  }
  const room = rooms.find((r) => r.id === a.roomId)?.name ?? "Room";
  return `${room} ${a.on ? "on" : "off"}`;
}
function describeDays(days?: number[]): string {
  if (!days?.length) return "";
  const set = [...days].sort();
  if (set.length === 7) return "";
  if (set.join() === "1,2,3,4,5") return " · weekdays";
  if (set.join() === "0,6") return " · weekends";
  return " · " + set.map((d) => DAY_NAMES[d]).join(", ");
}
function describeNext(a: Automation, coords: Coords | null): string | null {
  const n = nextFire(a, new Date(), coords);
  if (!n) return null;
  const now = new Date();
  const tom = new Date(now);
  tom.setDate(now.getDate() + 1);
  const when =
    n.toDateString() === now.toDateString()
      ? "today"
      : n.toDateString() === tom.toDateString()
        ? "tomorrow"
        : DAY_NAMES[n.getDay()];
  return `Next: ${when} ${fmtTime(n)}`;
}

type ActionChoice = "scene" | "roomOn" | "roomOff" | "allOff" | "fade";
type ActionRow = {
  kind: ActionChoice;
  sceneId: string;
  roomId: string;
  fadeRoomId: string; // "" = all lights
  fadeTo: number;
  fadeMin: number;
};

export function AutomationsSheet({
  automations,
  scenes,
  rooms,
  sensors,
  coords,
  onRequestLocation,
  onAdd,
  onToggle,
  onRemove,
  onSimulateMotion,
  onClose,
}: {
  automations: Automation[];
  scenes: StoredScene[];
  rooms: Room[];
  sensors: Sensor[];
  coords: Coords | null;
  onRequestLocation: () => Promise<Coords | null>;
  onAdd: (name: string, trigger: Trigger, actions: Action[], days: number[]) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onSimulateMotion: () => void;
  onClose: () => void;
}) {
  const [triggerKind, setTriggerKind] = useState<"time" | "sunset" | "sunrise" | "motion">("sunset");
  const [sensorId, setSensorId] = useState(sensors[0]?.id ?? "");
  const [timeValue, setTimeValue] = useState("18:00");
  const [offsetMin, setOffsetMin] = useState(0);
  const [days, setDays] = useState<number[]>([]);
  const [locating, setLocating] = useState(false);

  const choices = useMemo<{ id: ActionChoice; label: string; disabled?: boolean }[]>(
    () => [
      { id: "scene", label: "Apply a scene", disabled: scenes.length === 0 },
      { id: "fade", label: "Fade lights (wake / wind-down)" },
      { id: "roomOff", label: "Turn a room off", disabled: rooms.length === 0 },
      { id: "roomOn", label: "Turn a room on", disabled: rooms.length === 0 },
      { id: "allOff", label: "All off" },
    ],
    [scenes.length, rooms.length]
  );
  const blankRow = (): ActionRow => ({
    kind: "allOff",
    sceneId: scenes[0]?.id ?? "",
    roomId: rooms[0]?.id ?? "",
    fadeRoomId: "",
    fadeTo: 100,
    fadeMin: 20,
  });
  const [rows, setRows] = useState<ActionRow[]>([
    { ...blankRow(), kind: scenes.length ? "scene" : "allOff" },
  ]);

  const needsLocation = (triggerKind === "sunset" || triggerKind === "sunrise") && !coords;

  const buildTrigger = (): Trigger =>
    triggerKind === "time"
      ? { kind: "time", minutes: parseHHMM(timeValue) }
      : triggerKind === "motion"
        ? { kind: "sensor", sensorId }
        : { kind: "sun", event: triggerKind, offsetMin };

  const rowToAction = (r: ActionRow): Action =>
    r.kind === "scene"
      ? { kind: "scene", sceneId: r.sceneId }
      : r.kind === "allOff"
        ? { kind: "allOff" }
        : r.kind === "fade"
          ? {
              kind: "fade",
              ...(r.fadeRoomId ? { roomId: r.fadeRoomId } : {}),
              toBrightness: Math.max(0, Math.min(100, r.fadeTo)),
              minutes: Math.max(1, r.fadeMin),
            }
          : { kind: "roomPower", roomId: r.roomId, on: r.kind === "roomOn" };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const updateRow = (i: number, patch: Partial<ActionRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  async function useLocation() {
    setLocating(true);
    await onRequestLocation();
    setLocating(false);
  }
  function add() {
    onAdd("", buildTrigger(), rows.map(rowToAction), days);
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Automations">
      <h3>Automations</h3>

      {automations.length > 0 && (
        <ul className="auto-list">
          {automations.map((a) => (
            <li className={"auto-row" + (a.enabled ? "" : " off")} key={a.id}>
              <div className="auto-main">
                <span className="auto-when">
                  {describeTrigger(a.trigger, sensors)}
                  <span className="auto-days">{describeDays(a.days)}</span>
                </span>
                <span className="auto-arrow">→</span>
                <span className="auto-do">
                  {actionsOf(a).map((x) => describeAction(x, scenes, rooms)).join(" + ")}
                </span>
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
          {(["sunset", "sunrise", "time", ...(sensors.length ? (["motion"] as const) : [])] as const).map((k) => (
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

        {triggerKind === "motion" ? (
          <>
            <label className="field">
              <span className="label">When this sees motion</span>
              <select value={sensorId} onChange={(e) => setSensorId(e.target.value)}>
                {sensors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="hint">
                Fires the moment motion starts, then waits a minute before it can fire again.
              </span>
            </label>
            {sensors.some((s) => s.sourceId === "demo") && (
              <div className="sheet-actions" style={{ justifyContent: "flex-start" }}>
                <button className="btn btn-sm" onClick={onSimulateMotion}>
                  Simulate motion (demo)
                </button>
              </div>
            )}
          </>
        ) : triggerKind === "time" ? (
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

        <div className="field">
          <span className="label">On days (none = every day)</span>
          <div className="days">
            {DAY_LETTERS.map((letter, d) => (
              <button
                key={d}
                type="button"
                className="day"
                aria-pressed={days.includes(d)}
                aria-label={DAY_NAMES[d]}
                onClick={() => toggleDay(d)}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Do</span>
          {rows.map((row, i) => (
            <div className="action-row" key={i}>
              <select value={row.kind} onChange={(e) => updateRow(i, { kind: e.target.value as ActionChoice })}>
                {choices.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.disabled}>
                    {c.label}
                  </option>
                ))}
              </select>
              {row.kind === "scene" && scenes.length > 0 && (
                <select value={row.sceneId} onChange={(e) => updateRow(i, { sceneId: e.target.value })}>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {(row.kind === "roomOn" || row.kind === "roomOff") && rooms.length > 0 && (
                <select value={row.roomId} onChange={(e) => updateRow(i, { roomId: e.target.value })}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              {row.kind === "fade" && (
                <div className="fade-fields">
                  <select value={row.fadeRoomId} onChange={(e) => updateRow(i, { fadeRoomId: e.target.value })}>
                    <option value="">All lights</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <label className="mini">
                    to
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={row.fadeTo}
                      onChange={(e) => updateRow(i, { fadeTo: Number(e.target.value) })}
                    />
                    %
                  </label>
                  <label className="mini">
                    over
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={row.fadeMin}
                      onChange={(e) => updateRow(i, { fadeMin: Number(e.target.value) })}
                    />
                    min
                  </label>
                </div>
              )}
              {rows.length > 1 && (
                <button className="chip-tool static" aria-label="Remove action" onClick={() => removeRow(i)}>
                  ×
                </button>
              )}
            </div>
          ))}
          {rows.some((r) => r.kind === "fade") && (
            <p className="hint">Fade to 0% winds down and turns the lights off at the end.</p>
          )}
          <button className="btn btn-ghost btn-sm" onClick={addRow}>
            + Add action
          </button>
        </div>

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
