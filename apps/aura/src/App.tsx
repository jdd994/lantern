import { useEffect, useRef, useState } from "react";
import { useTheme, useAccent, type ThemeOption } from "@lantern/ui";
import { isTauri } from "./lib/platform";
import { useAura } from "./hooks/useAura";
import { groupByRoom, type Room } from "./lib/rooms";
import type { CustomVibe } from "./lib/db";
import { ConnectSheet } from "./components/ConnectSheet";
import { DeviceList, RoomDots } from "./components/DeviceList";
import { Scenes } from "./components/Scenes";
import { RoomsSheet } from "./components/RoomsSheet";
import { AutomationsSheet } from "./components/AutomationsSheet";
import { Vibes } from "./components/Vibes";
import { CustomVibeSheet } from "./components/CustomVibeSheet";
import { VibePicker } from "./components/VibePicker";
import { AmbientSheet } from "./components/AmbientSheet";
import { Welcome } from "./components/Welcome";
import { HelpSheet } from "./components/HelpSheet";
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
  const { accent, setAccent, resetAccent } = useAccent("aura-accent");
  const aura = useAura();
  const [connecting, setConnecting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [managingRooms, setManagingRooms] = useState(false);
  const [automating, setAutomating] = useState(false);
  const [ambient, setAmbient] = useState(false);
  const [creatingVibe, setCreatingVibe] = useState(false);
  const [editingVibe, setEditingVibe] = useState<CustomVibe | null>(null);
  const [vibeRoom, setVibeRoom] = useState<Room | null>(null);
  // Which rooms are collapsed to a compact dot-row — expanded by default (today's
  // look, unchanged), so this only kicks in once someone actually wants it tidier.
  const [collapsedRooms, setCollapsedRooms] = useState<Record<string, boolean>>({});
  const [helping, setHelping] = useState(false);
  const [welcomed, setWelcomed] = useState(() => {
    try {
      return localStorage.getItem("aura-welcomed") === "1";
    } catch {
      return true;
    }
  });
  const sections = groupByRoom(aura.devices, aura.rooms);

  // The desktop tray's "All lights off" — a ref keeps the listener stable while
  // still acting on the current devices.
  const allOffRef = useRef<() => void>(() => {});
  allOffRef.current = () => aura.setRoomPower(aura.devices.map((d) => d.id), false);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisten = await listen("aura://all-off", () => allOffRef.current());
    });
    return () => unlisten?.();
  }, []);

  function dismissWelcome() {
    setWelcomed(true);
    try {
      localStorage.setItem("aura-welcomed", "1");
    } catch {
      /* private mode */
    }
  }

  if (!welcomed) {
    return (
      <div className="wrap">
        <Welcome
          busy={aura.busy}
          onConnect={() => {
            dismissWelcome();
            setConnecting(true);
          }}
          onDemo={async () => {
            dismissWelcome();
            await aura.connect("demo", "demo");
          }}
        />
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1 className="brand">
          Aura<span>.</span>
        </h1>
        <div className="top-actions">
          {aura.connected && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => aura.refresh()} disabled={aura.busy}>
                {aura.busy ? "…" : "Refresh"}
              </button>
              <button className="icon-btn" aria-label="Automations" onClick={() => setAutomating(true)}>
                ⏱
              </button>
            </>
          )}
          <button className="icon-btn" aria-label="Help" onClick={() => setHelping(true)}>
            ?
          </button>
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
          {aura.devices.length > 0 && (
            <Vibes
              busy={aura.busy}
              customVibes={aura.customVibes}
              onApply={(id) => aura.applyVibe(id)}
              onAuto={() => setAmbient(true)}
              onAddVibe={() => setCreatingVibe(true)}
              onEditVibe={(v) => setEditingVibe(v)}
              onRemoveVibe={aura.removeCustomVibe}
            />
          )}

          <section className="section">
            <div className="section-head">
              <h2>Lights</h2>
              <div className="head-actions">
                {aura.devices.length > 0 && (
                  <>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => aura.setRoomPower(aura.devices.map((d) => d.id), false)}
                    >
                      All off
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setManagingRooms(true)}>
                      Rooms
                    </button>
                  </>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setConnecting(true)}>
                  Add
                </button>
              </div>
            </div>

            {aura.devices.length === 0 ? (
              <p className="hint">No lights found on this account yet. Try Refresh.</p>
            ) : aura.rooms.length === 0 ? (
              <DeviceList devices={aura.devices} states={aura.states} onSet={aura.setDevice} />
            ) : (
              <div className="rooms">
                {sections.map((sec) => {
                  const key = sec.room?.id ?? "unassigned";
                  const collapsed = collapsedRooms[key] ?? false;
                  return (
                    <div className="room" key={key}>
                      <div className="room-head">
                        <button
                          type="button"
                          className="room-toggle"
                          aria-expanded={!collapsed}
                          onClick={() => setCollapsedRooms((prev) => ({ ...prev, [key]: !collapsed }))}
                        >
                          <span className={"room-chevron" + (collapsed ? "" : " is-open")} aria-hidden="true">
                            ▸
                          </span>
                          <h3 className="room-name">{sec.room?.name ?? "Other lights"}</h3>
                        </button>
                        {sec.devices.length > 0 && (
                          <div className="room-master">
                            {sec.room && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setVibeRoom(sec.room)}>
                                Vibe
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => aura.setRoomPower(sec.devices.map((d) => d.id), false)}
                            >
                              All off
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => aura.setRoomPower(sec.devices.map((d) => d.id), true)}
                            >
                              All on
                            </button>
                          </div>
                        )}
                      </div>
                      {sec.devices.length === 0 ? (
                        <p className="hint">No lights here yet — add some from Rooms.</p>
                      ) : collapsed ? (
                        <RoomDots devices={sec.devices} states={aura.states} />
                      ) : (
                        <>
                          <DeviceList devices={sec.devices} states={aura.states} onSet={aura.setDevice} />
                          {sec.room && (
                            <Scenes
                              compact
                              scenes={aura.scenes.filter((s) => s.roomId === sec.room!.id)}
                              busy={aura.busy}
                              canSave={sec.devices.length > 0}
                              onApply={aura.applyScene}
                              onSave={(n) => aura.saveScene(n, sec.room!.id)}
                              onRemove={aura.removeScene}
                              onRename={aura.renameScene}
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <Scenes
            title={aura.rooms.length > 0 ? "Whole home" : "Scenes"}
            scenes={aura.scenes.filter((s) => !s.roomId)}
            busy={aura.busy}
            canSave={aura.devices.length > 0}
            onApply={aura.applyScene}
            onSave={(n) => aura.saveScene(n)}
            onRemove={aura.removeScene}
            onRename={aura.renameScene}
          />
        </>
      )}

      {connecting && (
        <ConnectSheet onConnect={aura.connect} onClose={() => setConnecting(false)} />
      )}
      {managingRooms && (
        <RoomsSheet
          rooms={aura.rooms}
          devices={aura.devices}
          onCreate={aura.createRoom}
          onRename={aura.renameRoom}
          onDelete={aura.removeRoom}
          onAssign={aura.assignDevice}
          onClose={() => setManagingRooms(false)}
        />
      )}
      {automating && (
        <AutomationsSheet
          automations={aura.automations}
          scenes={aura.scenes}
          rooms={aura.rooms}
          sensors={aura.sensors}
          coords={aura.coords}
          onRequestLocation={aura.requestLocation}
          onAdd={aura.addAutomation}
          onToggle={aura.toggleAutomation}
          onRemove={aura.removeAutomation}
          onSimulateMotion={aura.simulateMotion}
          onClose={() => setAutomating(false)}
        />
      )}
      {(creatingVibe || editingVibe) && (
        <CustomVibeSheet
          initial={editingVibe ?? undefined}
          onSubmit={(label, rgb, brightness) =>
            editingVibe
              ? aura.updateCustomVibe(editingVibe.id, label, rgb, brightness)
              : aura.createCustomVibe(label, rgb, brightness)
          }
          onClose={() => {
            setCreatingVibe(false);
            setEditingVibe(null);
          }}
        />
      )}
      {vibeRoom && (
        <VibePicker
          title={vibeRoom.name}
          customVibes={aura.customVibes}
          onPick={(id) => aura.applyVibe(id, vibeRoom.id)}
          onClose={() => setVibeRoom(null)}
        />
      )}
      {ambient && (
        <AmbientSheet onApplyVibe={(id) => aura.applyVibe(id)} onClose={() => setAmbient(false)} />
      )}
      {helping && <HelpSheet onClose={() => setHelping(false)} />}
      {settings && (
        <SettingsSheet
          themes={THEMES}
          mood={mood}
          onMood={setMood}
          accent={accent}
          onAccent={setAccent}
          onResetAccent={resetAccent}
          sources={aura.sources}
          devices={aura.devices}
          onDisconnect={aura.disconnect}
          adaptive={aura.adaptive}
          onAdaptive={aura.setAdaptive}
          mirrorVibes={aura.mirrorVibes}
          onMirrorVibes={aura.setMirrorVibes}
          onExport={aura.exportSetup}
          onImport={aura.importSetup}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}
