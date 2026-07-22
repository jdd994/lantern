// DeviceList.tsx — your lights, with quick controls. On/off is always there;
// brightness and color show only for devices that support them. Controls act
// optimistically (the hook updates state first, then reaches the bulb).
import { useState } from "react";
import type { Device, LightState } from "../lib/connectors";
import { hexToRgb, rgbToHex } from "../lib/color";

// RoomDots — a collapsed room's whole state at a glance: one small dot per
// light, lit with its actual color when it has one, a warm glow for a
// kelvin-only bulb that's on, and dim when it's off. No numbers, no sliders —
// just enough to see the room's mood without expanding it.
export function RoomDots({
  devices,
  states,
}: {
  devices: Device[];
  states: Record<string, LightState>;
}) {
  return (
    <div className="room-dots">
      {devices.map((d) => {
        const st = states[d.id];
        const color = !st?.on ? "var(--off)" : st.color ? `rgb(${st.color.r}, ${st.color.g}, ${st.color.b})` : "var(--glow)";
        return <span className="room-dot" key={d.id} style={{ background: color }} title={d.name} />;
      })}
    </div>
  );
}

export function DeviceList({
  devices,
  states,
  onSet,
  onIdentify,
  identifying,
  onRename,
}: {
  devices: Device[];
  states: Record<string, LightState>;
  onSet: (id: string, patch: Partial<LightState>) => void;
  // Optional — a room-scoped list may not want it, or a caller with no need
  // for it can simply not pass it. When present: a quick blink so you can see
  // which physical light this row actually is.
  onIdentify?: (id: string) => void;
  identifying?: string | null;
  // Optional — your own name for this light, shown everywhere from here on.
  // Never touches the brand's own name; an empty rename resets back to it.
  onRename?: (id: string, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  function commitRename(id: string, value: string) {
    onRename?.(id, value);
    setEditingId(null);
  }

  return (
    <div className="devices">
      {devices.map((d) => {
        const st = states[d.id] ?? { on: false };
        const editing = editingId === d.id;
        return (
          <div className={"device" + (st.on ? " is-on" : "")} key={d.id}>
            <div className="device-head">
              {editing ? (
                <input
                  className="device-name-input"
                  defaultValue={d.name}
                  autoFocus
                  aria-label={`Rename ${d.name}`}
                  onBlur={(e) => commitRename(d.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <span className="device-name">{d.name}</span>
              )}
              <div className="device-head-actions">
                {onRename && !editing && (
                  <button
                    type="button"
                    className="identify-btn"
                    aria-label={`Rename ${d.name}`}
                    title="Rename this light"
                    onClick={() => setEditingId(d.id)}
                  >
                    ✎
                  </button>
                )}
                {onIdentify && (
                  <button
                    type="button"
                    className="identify-btn"
                    aria-label={`Identify ${d.name}`}
                    title="Blink to see which light this is"
                    disabled={identifying === d.id}
                    onClick={() => onIdentify(d.id)}
                  >
                    ◎
                  </button>
                )}
                <button
                  className="toggle"
                  role="switch"
                  aria-checked={st.on}
                  onClick={() => onSet(d.id, { on: !st.on })}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            {(d.canBrightness || d.canColor || d.canColorTemp) && (
              <div className="device-controls">
                {d.canBrightness && (
                  <input
                    className="dim"
                    type="range"
                    min={1}
                    max={100}
                    value={st.brightness ?? 100}
                    disabled={!st.on}
                    aria-label={`${d.name} brightness`}
                    onChange={(e) => onSet(d.id, { brightness: Number(e.target.value) })}
                  />
                )}
                {d.canColorTemp && (
                  <input
                    className="temp"
                    type="range"
                    min={2000}
                    max={6500}
                    step={100}
                    value={st.kelvin ?? 3500}
                    disabled={!st.on}
                    aria-label={`${d.name} white temperature`}
                    onChange={(e) => onSet(d.id, { kelvin: Number(e.target.value) })}
                  />
                )}
                {d.canColor && (
                  <input
                    className="swatch"
                    type="color"
                    value={rgbToHex(st.color)}
                    disabled={!st.on}
                    aria-label={`${d.name} color`}
                    onChange={(e) => onSet(d.id, { color: hexToRgb(e.target.value) })}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
