// SettingsSheet.tsx — the app's own vibe, your connected brands, and a plain word
// on how Aura works. No account, no vault: Aura is a controller for your lights.
import { Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import { connectorFor, type Device } from "../lib/connectors";
import type { StoredSource } from "../lib/db";

export function SettingsSheet({
  themes,
  mood,
  onMood,
  sources,
  devices,
  onDisconnect,
  onClose,
}: {
  themes: ThemeOption[];
  mood: string;
  onMood: (id: string) => void;
  sources: StoredSource[];
  devices: Device[];
  onDisconnect: (sourceId: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} ariaLabel="Settings">
      <h3>Settings</h3>

      <div className="set-section">
        <span className="label">Aura's vibe</span>
        <ThemePicker options={themes} current={mood} onSelect={onMood} />
      </div>

      <div className="set-section">
        <span className="label">Connected</span>
        {sources.length === 0 ? (
          <p className="hint">No lights connected yet.</p>
        ) : (
          <ul className="source-list">
            {sources.map((s) => {
              const count = devices.filter((d) => d.sourceId === s.id).length;
              return (
                <li className="source-row" key={s.id}>
                  <span>
                    {connectorFor(s.id)?.label ?? s.id}
                    <span className="hint"> · {count} {count === 1 ? "light" : "lights"}</span>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => onDisconnect(s.id)}>
                    Disconnect
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="set-section">
        <span className="label">How Aura works</span>
        <p className="hint">
          Aura runs entirely on this device and talks straight to each brand's own service. It has no
          account and no server of its own — your keys, devices, and scenes never leave here.
        </p>
      </div>
    </Sheet>
  );
}
