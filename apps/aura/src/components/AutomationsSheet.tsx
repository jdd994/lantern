// AutomationsSheet.tsx — "when <trigger> [on <days>], do <these things>." Calm and
// finite: a clock time or a sun event, an optional weekday filter, and one or more
// actions (vibe / scene / room / fade / all off). Sun triggers need your location
// once (asked only when you pick one). A few starters sit above the form — each
// one just fills the form in, so what you add is always something you've seen and
// could tweak. Tap an existing automation to edit it in the same form. These run
// while Aura is open — background firing arrives with the desktop app.
import { useMemo, useState } from "react";
import { Sheet } from "@lantern/ui";
import { VIBES, vibeById } from "@lantern/core";
import {
  actionsOf,
  nextFire,
  type Action,
  type Automation,
  type Coords,
  type Trigger,
} from "../lib/automations";
import type { Sensor } from "../lib/connectors";
import type { CustomVibe, StoredScene } from "../lib/db";
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
const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
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
function describeAction(
  a: Action,
  scenes: StoredScene[],
  rooms: Room[],
  customVibes: CustomVibe[]
): string {
  if (a.kind === "allOff") return "All off";
  if (a.kind === "scene") return scenes.find((s) => s.id === a.sceneId)?.name ?? "Scene";
  if (a.kind === "vibe") {
    const label =
      vibeById(a.vibeId)?.label ?? customVibes.find((v) => v.id === a.vibeId)?.label ?? "Vibe";
    const room = a.roomId ? rooms.find((r) => r.id === a.roomId)?.name : null;
    return room ? `${label} · ${room}` : label;
  }
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

type TriggerKind = "time" | "sunset" | "sunrise" | "motion";
type ActionChoice = "vibe" | "scene" | "roomOn" | "roomOff" | "allOff" | "fade";
type ActionRow = {
  kind: ActionChoice;
  vibeId: string;
  vibeRoomId: string; // "" = whole home
  sceneId: string;
  roomId: string;
  fadeRoomId: string; // "" = all lights
  fadeTo: number;
  fadeMin: number;
};

// Starters — ready automations that only ever fill the form in. Nothing is added
// until you've seen exactly what it will do and pressed the same button as always.
type Starter = {
  id: string;
  label: string;
  desc: string;
  triggerKind: TriggerKind;
  timeValue?: string;
  offsetMin?: number;
  days?: number[];
  rows: Partial<ActionRow>[];
};
const STARTERS: Starter[] = [
  {
    id: "sunset-lamplight",
    label: "Sunset lamplight",
    desc: "A little before sunset, the whole home eases into warm calm.",
    triggerKind: "sunset",
    offsetMin: -15,
    rows: [{ kind: "vibe", vibeId: "calm" }],
  },
  {
    id: "evening-embers",
    label: "Evening embers",
    desc: "Half an hour after sunset, sink into low wind-down light.",
    triggerKind: "sunset",
    offsetMin: 30,
    rows: [{ kind: "vibe", vibeId: "wind-down" }],
  },
  {
    id: "gentle-wake",
    label: "Gentle wake",
    desc: "Weekday mornings fade the lights up slowly, like a sunrise indoors.",
    triggerKind: "time",
    timeValue: "07:00",
    days: [1, 2, 3, 4, 5],
    rows: [{ kind: "fade", fadeTo: 70, fadeMin: 20 }],
  },
  {
    id: "wind-down-dark",
    label: "Wind down to dark",
    desc: "Late evening, everything fades gently to off over half an hour.",
    triggerKind: "time",
    timeValue: "21:30",
    rows: [{ kind: "fade", fadeTo: 0, fadeMin: 30 }],
  },
  {
    id: "midnight-off",
    label: "Midnight all off",
    desc: "Whatever was left on goes off at midnight.",
    triggerKind: "time",
    timeValue: "00:00",
    rows: [{ kind: "allOff" }],
  },
];

export function AutomationsSheet({
  automations,
  scenes,
  rooms,
  sensors,
  customVibes,
  coords,
  onRequestLocation,
  onAdd,
  onUpdate,
  onToggle,
  onRemove,
  onSimulateMotion,
  onClose,
}: {
  automations: Automation[];
  scenes: StoredScene[];
  rooms: Room[];
  sensors: Sensor[];
  customVibes: CustomVibe[];
  coords: Coords | null;
  onRequestLocation: () => Promise<Coords | null>;
  onAdd: (name: string, trigger: Trigger, actions: Action[], days: number[]) => void;
  onUpdate: (id: string, name: string, trigger: Trigger, actions: Action[], days: number[]) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onSimulateMotion: () => void;
  onClose: () => void;
}) {
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("sunset");
  const [sensorId, setSensorId] = useState(sensors[0]?.id ?? "");
  const [timeValue, setTimeValue] = useState("18:00");
  const [offsetMin, setOffsetMin] = useState(0);
  const [days, setDays] = useState<number[]>([]);
  const [locating, setLocating] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [starterNote, setStarterNote] = useState<string | null>(null);

  const choices = useMemo<{ id: ActionChoice; label: string; disabled?: boolean }[]>(
    () => [
      { id: "vibe", label: "Set a vibe" },
      { id: "scene", label: "Apply a scene", disabled: scenes.length === 0 },
      { id: "fade", label: "Fade lights (wake / wind-down)" },
      { id: "roomOff", label: "Turn a room off", disabled: rooms.length === 0 },
      { id: "roomOn", label: "Turn a room on", disabled: rooms.length === 0 },
      { id: "allOff", label: "All off" },
    ],
    [scenes.length, rooms.length]
  );
  const blankRow = (): ActionRow => ({
    kind: "vibe",
    vibeId: "calm",
    vibeRoomId: "",
    sceneId: scenes[0]?.id ?? "",
    roomId: rooms[0]?.id ?? "",
    fadeRoomId: "",
    fadeTo: 100,
    fadeMin: 20,
  });
  const [rows, setRows] = useState<ActionRow[]>([blankRow()]);

  const needsLocation = (triggerKind === "sunset" || triggerKind === "sunrise") && !coords;

  const buildTrigger = (): Trigger =>
    triggerKind === "time"
      ? { kind: "time", minutes: parseHHMM(timeValue) }
      : triggerKind === "motion"
        ? { kind: "sensor", sensorId }
        : { kind: "sun", event: triggerKind, offsetMin };

  const rowToAction = (r: ActionRow): Action =>
    r.kind === "vibe"
      ? { kind: "vibe", vibeId: r.vibeId, ...(r.vibeRoomId ? { roomId: r.vibeRoomId } : {}) }
      : r.kind === "scene"
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

  const rowFromAction = (a: Action): ActionRow => {
    const base = blankRow();
    if (a.kind === "vibe") return { ...base, kind: "vibe", vibeId: a.vibeId, vibeRoomId: a.roomId ?? "" };
    if (a.kind === "scene") return { ...base, kind: "scene", sceneId: a.sceneId };
    if (a.kind === "allOff") return { ...base, kind: "allOff" };
    if (a.kind === "fade")
      return { ...base, kind: "fade", fadeRoomId: a.roomId ?? "", fadeTo: a.toBrightness, fadeMin: a.minutes };
    return { ...base, kind: a.on ? "roomOn" : "roomOff", roomId: a.roomId };
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const updateRow = (i: number, patch: Partial<ActionRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  function applyStarter(s: Starter) {
    setEditing(null);
    setTriggerKind(s.triggerKind);
    if (s.timeValue) setTimeValue(s.timeValue);
    setOffsetMin(s.offsetMin ?? 0);
    setDays(s.days ?? []);
    setRows(s.rows.map((r) => ({ ...blankRow(), ...r })));
    setStarterNote(s.desc);
  }

  function startEdit(a: Automation) {
    const t = a.trigger;
    if (t.kind === "time") {
      setTriggerKind("time");
      setTimeValue(toHHMM(t.minutes));
    } else if (t.kind === "sensor") {
      setTriggerKind("motion");
      setSensorId(t.sensorId);
    } else {
      setTriggerKind(t.event);
      setOffsetMin(t.offsetMin);
    }
    setDays(a.days ?? []);
    const acts = actionsOf(a);
    setRows(acts.length ? acts.map(rowFromAction) : [blankRow()]);
    setStarterNote(null);
    setEditing(a);
  }

  function resetForm() {
    setEditing(null);
    setTriggerKind("sunset");
    setTimeValue("18:00");
    setOffsetMin(0);
    setDays([]);
    setRows([blankRow()]);
    setStarterNote(null);
  }

  async function useLocation() {
    setLocating(true);
    await onRequestLocation();
    setLocating(false);
  }
  function save() {
    const trigger = buildTrigger();
    const actions = rows.map(rowToAction);
    // The name writes itself from what the automation does — nothing to type,
    // and exports/sorting still read sensibly.
    const name = `${describeTrigger(trigger, sensors)} · ${actions
      .map((a) => describeAction(a, scenes, rooms, customVibes))
      .join(" + ")}`;
    if (editing) {
      onUpdate(editing.id, name, trigger, actions, days);
      resetForm();
    } else {
      onAdd(name, trigger, actions, days);
      setStarterNote(null);
    }
  }

  return (
    <Sheet onClose={onClose} ariaLabel="Automations">
      <h3>Automations</h3>

      {automations.length > 0 && (
        <ul className="auto-list">
          {automations.map((a) => (
            <li
              className={"auto-row" + (a.enabled ? "" : " off") + (editing?.id === a.id ? " editing" : "")}
              key={a.id}
            >
              <button
                type="button"
                className="auto-main"
                title="Tap to edit"
                onClick={() => startEdit(a)}
              >
                <span className="auto-when">
                  {describeTrigger(a.trigger, sensors)}
                  <span className="auto-days">{describeDays(a.days)}</span>
                </span>
                <span className="auto-arrow">→</span>
                <span className="auto-do">
                  {actionsOf(a).map((x) => describeAction(x, scenes, rooms, customVibes)).join(" + ")}
                </span>
                {a.enabled && describeNext(a, coords) && (
                  <span className="auto-next">{describeNext(a, coords)}</span>
                )}
              </button>
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
        <span className="label">{editing ? "Edit automation" : "New automation"}</span>

        {!editing && (
          <div className="auto-starters">
            <div className="vibes">
              {STARTERS.map((s) => (
                <button key={s.id} type="button" className="vibe" title={s.desc} onClick={() => applyStarter(s)}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="hint">
              {starterNote ?? "Tap a starter to fill the form in, tweak anything, then add — or build from scratch below."}
            </p>
          </div>
        )}

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
              {row.kind === "vibe" && (
                <div className="fade-fields">
                  <select value={row.vibeId} onChange={(e) => updateRow(i, { vibeId: e.target.value })}>
                    <optgroup label="Vibes">
                      {VIBES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </optgroup>
                    {customVibes.length > 0 && (
                      <optgroup label="Your vibes">
                        {customVibes.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <select value={row.vibeRoomId} onChange={(e) => updateRow(i, { vibeRoomId: e.target.value })}>
                    <option value="">Whole home</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
          {editing && (
            <button className="btn" onClick={resetForm}>
              Cancel
            </button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={needsLocation}>
            {editing ? "Save changes" : "Add automation"}
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
