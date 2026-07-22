// DeviceList.tsx — your lights, with quick controls. On/off is always there;
// brightness and color show only for devices that support them. Controls act
// optimistically (the hook updates state first, then reaches the bulb).
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
}: {
  devices: Device[];
  states: Record<string, LightState>;
  onSet: (id: string, patch: Partial<LightState>) => void;
}) {
  return (
    <div className="devices">
      {devices.map((d) => {
        const st = states[d.id] ?? { on: false };
        return (
          <div className={"device" + (st.on ? " is-on" : "")} key={d.id}>
            <div className="device-head">
              <span className="device-name">{d.name}</span>
              <button
                className="toggle"
                role="switch"
                aria-checked={st.on}
                onClick={() => onSet(d.id, { on: !st.on })}
              >
                <span className="toggle-knob" />
              </button>
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
