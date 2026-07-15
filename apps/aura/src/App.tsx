import { useState } from "react";
import { useTheme, type ThemeOption } from "@lantern/ui";
import { useAura } from "./hooks/useAura";
import { ConnectSheet } from "./components/ConnectSheet";
import { DeviceList } from "./components/DeviceList";
import { Scenes } from "./components/Scenes";
import { SettingsSheet } from "./components/SettingsSheet";

// Aura's own vibes — the app dogfoods the shared theme system. Each id maps to a
// `:root[data-mood="…"]` block in styles.css; the swatch preview mirrors it.
const THEMES: ThemeOption[] = [
  { id: "warmth", name: "Warmth", desc: "Balanced lamplight", bg: "#14100A", ink: "#F3E9D6", accent: "#E7B75A" },
  { id: "candlelight", name: "Candlelight", desc: "Deep and low", bg: "#0E0B07", ink: "#EAD9BC", accent: "#E0954B" },
  { id: "daylight", name: "Daylight", desc: "Bright and clear", bg: "#F6F1E7", ink: "#2A2118", accent: "#C98A2E" },
];

export default function App() {
  const { mood, setMood } = useTheme("aura-mood", THEMES.map((t) => t.id), "warmth");
  const aura = useAura();
  const [connecting, setConnecting] = useState(false);
  const [settings, setSettings] = useState(false);

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">
          Aura<span>.</span>
        </h1>
        <div className="top-actions">
          {aura.connected && (
            <button className="btn btn-ghost btn-sm" onClick={() => aura.refresh()} disabled={aura.busy}>
              {aura.busy ? "…" : "Refresh"}
            </button>
          )}
          <button className="icon-btn" aria-label="Settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
        </div>
      </header>

      {aura.error && <div className="error">{aura.error}</div>}

      {!aura.connected ? (
        <section className="section">
          <div className="empty">
            <p>Connect your lights to set the vibe of your space.</p>
            <button className="btn btn-primary" onClick={() => setConnecting(true)}>
              Connect lights
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2>Lights</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setConnecting(true)}>
                Add
              </button>
            </div>
            {aura.devices.length === 0 ? (
              <p className="hint">No lights found on this account yet. Try Refresh.</p>
            ) : (
              <DeviceList devices={aura.devices} states={aura.states} onSet={aura.setDevice} />
            )}
          </section>

          <Scenes
            scenes={aura.scenes}
            busy={aura.busy}
            canSave={aura.devices.length > 0}
            onApply={aura.applyScene}
            onSave={aura.saveScene}
            onRemove={aura.removeScene}
          />
        </>
      )}

      {connecting && (
        <ConnectSheet onConnect={aura.connect} onClose={() => setConnecting(false)} />
      )}
      {settings && (
        <SettingsSheet
          themes={THEMES}
          mood={mood}
          onMood={setMood}
          sources={aura.sources}
          devices={aura.devices}
          onDisconnect={aura.disconnect}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}
