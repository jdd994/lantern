// DeviceList.tsx — your lights, with quick controls. On/off is always there;
// brightness and color show only for devices that support them. Controls act
// optimistically (the hook updates state first, then reaches the bulb).
import type { Device, LightState } from "../lib/connectors";
import { hexToRgb, rgbToHex } from "../lib/color";

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

            {(d.canBrightness || d.canColor) && (
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
