// SettingsSheet.tsx — the app's own vibe, your connected brands, and a plain word
// on how Aura works. No account, no vault: Aura is a controller for your lights.
import { useRef, useState } from "react";
import { CapabilityLedger, Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import { connectorFor, tierWording, type Device } from "../lib/connectors";
import type { StoredSource } from "../lib/db";

const DEFAULT_ACCENT = "#E7B75A";

export function SettingsSheet({
  themes,
  mood,
  onMood,
  accent,
  onAccent,
  onResetAccent,
  sources,
  devices,
  onDisconnect,
  adaptive,
  onAdaptive,
  mirrorVibes,
  onMirrorVibes,
  onExport,
  onImport,
  onClose,
}: {
  themes: ThemeOption[];
  mood: string;
  onMood: (id: string) => void;
  accent: string | null;
  onAccent: (hex: string) => void;
  onResetAccent: () => void;
  sources: StoredSource[];
  devices: Device[];
  onDisconnect: (sourceId: string) => void;
  adaptive: boolean;
  onAdaptive: (on: boolean) => void;
  mirrorVibes: boolean;
  onMirrorVibes: (on: boolean) => void;
  onExport: () => string;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ioNote, setIoNote] = useState<string | null>(null);

  function exportSetup() {
    const blob = new Blob([onExport()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura-setup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIoNote("Setup exported.");
  }

  async function importSetup(file: File) {
    const text = await file.text();
    const res = await onImport(text);
    setIoNote(res.ok ? "Setup imported." : (res.error ?? "Import failed."));
  }
  return (
    <Sheet onClose={onClose} ariaLabel="Settings">
      <h3>Settings</h3>

      <div className="set-section">
        <span className="label">Aura's vibe</span>
        <ThemePicker options={themes} current={mood} onSelect={onMood} />
      </div>

      <div className="set-section">
        <span className="label">Accent color</span>
        <div className="accent-row">
          <input
            className="swatch big"
            type="color"
            value={accent ?? DEFAULT_ACCENT}
            aria-label="Accent color"
            onChange={(e) => onAccent(e.target.value)}
          />
          <span className="hint">The signature glow — buttons, toggles, highlights.</span>
          {accent && (
            <button className="btn btn-ghost btn-sm" onClick={onResetAccent}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="set-section">
        <div className="adaptive-row">
          <div>
            <span className="label">Adaptive white</span>
            <p className="hint">Tunable-white bulbs follow the day — warm at dawn and dusk, cool at midday.</p>
          </div>
          <button
            className="toggle"
            role="switch"
            aria-checked={adaptive}
            aria-label="Adaptive white"
            onClick={() => onAdaptive(!adaptive)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      <div className="set-section">
        <div className="adaptive-row">
          <div>
            <span className="label">Mirror vibes</span>
            <p className="hint">
              When another lantern app on this computer sets a vibe, Aura's lights follow — and vice versa.
              Local only; nothing leaves this machine.
            </p>
          </div>
          <button
            className="toggle"
            role="switch"
            aria-checked={mirrorVibes}
            aria-label="Mirror vibes"
            onClick={() => onMirrorVibes(!mirrorVibes)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>

      {/* The capability ledger: everything you said yes to, what it costs, and
          the undo — right here, stated once, never a nag. Entries derive from
          what's actually connected, so this page can't drift from the truth. */}
      <div className="set-section">
        <span className="label">Connected</span>
        <CapabilityLedger
          entries={sources.map((s) => {
            const conn = connectorFor(s.id);
            const count = devices.filter((d) => d.sourceId === s.id).length;
            return {
              id: s.id,
              label: conn?.label ?? s.id,
              tier: conn?.descriptor.tier ?? 0,
              tierLabel: conn ? tierWording(conn.descriptor.tier) : undefined,
              discloses: conn?.descriptor.discloses ?? "",
              detail: `${count} ${count === 1 ? "light" : "lights"}`,
              since: s.connectedAt,
            };
          })}
          onRevoke={onDisconnect}
          revokeLabel="Disconnect"
          emptyText="No lights connected yet."
        />
      </div>

      <div className="set-section">
        <span className="label">Your setup</span>
        <p className="hint">
          Move your rooms, scenes, and vibes to another device. The file holds no keys — you re-pair
          your lights there, and everything lines back up.
        </p>
        <div className="io-row">
          <button className="btn btn-sm" onClick={exportSetup}>
            Export setup
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Import setup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSetup(f);
              e.target.value = "";
            }}
          />
        </div>
        {ioNote && <p className="hint io-note">{ioNote}</p>}
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
