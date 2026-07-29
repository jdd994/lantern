// SettingsSheet.tsx — the app's own vibe, your connected brands, and a plain word
// on how Aura works. No account, no vault: Aura is a controller for your lights.
import { useEffect, useRef, useState } from "react";
import { CapabilityLedger, Sheet, ThemePicker, type ThemeOption } from "@lantern/ui";
import { connectorFor, tierWording, type Device } from "../lib/connectors";
import type { StoredSource } from "../lib/db";
import { appVersion, isTauri } from "../lib/platform";
import { TransferPanel } from "./TransferPanel";

const DEFAULT_ACCENT = "#E7B75A";
const EXPORT_ACCOUNTS_KEY = "aura-export-include-accounts";

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
  mirrorVibes: boolean;
  onMirrorVibes: (on: boolean) => void;
  onExport: (includeAccounts?: boolean, compact?: boolean) => string;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string; summary?: string }>;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ioNote, setIoNote] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  // Persisted, not just component state — this toggle living only in memory
  // meant closing and reopening Settings between "turn it on" and "tap
  // Export" silently reset it back off, with no visible sign it had.
  const [includeAccounts, setIncludeAccounts] = useState(() => {
    try {
      return localStorage.getItem(EXPORT_ACCOUNTS_KEY) === "1";
    } catch {
      return false;
    }
  });
  function setIncludeAccountsPersisted(v: boolean) {
    setIncludeAccounts(v);
    try {
      localStorage.setItem(EXPORT_ACCOUNTS_KEY, v ? "1" : "0");
    } catch {
      /* private mode — it'll just default off next time */
    }
  }
  // Desktop only — a plain way to confirm you're on the build you think
  // you're on, since Windows/macOS installers don't always show this.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    appVersion().then(setVersion);
  }, []);

  // Desktop only: start-at-login. null until the shell answers (or forever, in
  // the browser) — the toggle simply doesn't render until there's a real state
  // to show, rather than guessing and flickering.
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/plugin-autostart").then(async ({ isEnabled }) => {
      try {
        setAutostart(await isEnabled());
      } catch {
        /* leave the toggle unrendered rather than lie about the state */
      }
    });
  }, []);
  async function toggleAutostart() {
    try {
      const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
      if (autostart) await disable();
      else await enable();
      setAutostart(await isEnabled());
    } catch {
      /* the OS said no — the toggle stays showing the real state */
    }
  }

  // The actual friction in "move a file to your other device" was never the
  // JSON — it's getting that file across, which used to mean emailing it to
  // yourself or hunting for a cloud drive. Every phone already has a fast,
  // native answer to that (AirDrop, Nearby Share, Windows Share) reachable
  // from the browser as navigator.share() with a file attached — so try that
  // first, and only fall back to a plain download where it isn't supported
  // (most desktop browsers today).
  async function exportSetup() {
    const filename = `aura-setup-${new Date().toISOString().slice(0, 10)}.json`;
    const text = onExport(includeAccounts);
    const file = new File([text], filename, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Aura setup" });
        setIoNote("Setup shared.");
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return; // you backed out — no note needed
        // any other share failure falls through to the plain download below
      }
    }
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setIoNote("Setup exported.");
  }

  async function copyAsText() {
    try {
      await navigator.clipboard.writeText(onExport(includeAccounts));
      setIoNote("Setup copied — paste it anywhere you'd move text.");
    } catch {
      setIoNote("Couldn't copy — try Export setup instead.");
    }
  }

  async function importSetup(file: File) {
    const text = await file.text();
    const res = await onImport(text);
    // A generic "Setup imported." says nothing about what actually happened
    // — summary spells out counts and account status, so an empty or
    // partial file doesn't read as a silent no-op.
    setIoNote(res.ok ? (res.summary ?? "Setup imported.") : (res.error ?? "Import failed."));
  }

  async function importPastedText() {
    const res = await onImport(pasteText);
    setIoNote(res.ok ? (res.summary ?? "Setup imported.") : (res.error ?? "Import failed."));
    if (res.ok) {
      setPasting(false);
      setPasteText("");
    }
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
        <span className="label">Move to another device</span>
        <p className="hint">
          {transferring
            ? null
            : "Scan a code between two devices — no server, no account, nothing but the two of you."}
        </p>
        {transferring ? (
          <TransferPanel
            onExport={onExport}
            onImport={onImport}
            onClose={() => setTransferring(false)}
          />
        ) : (
          <button className="btn btn-sm" onClick={() => setTransferring(true)}>
            Move with a code
          </button>
        )}
      </div>

      <div className="set-section">
        <span className="label">Export / Import</span>
        <p className="hint">
          Move your rooms, scenes, and vibes another way — a file, or copied text, instead of a scan.
        </p>
        <div className="adaptive-row">
          <span className="hint">Include your connected accounts (Govee, Home Assistant…)</span>
          <button
            className="toggle sm"
            role="switch"
            aria-checked={includeAccounts}
            aria-label="Include connected accounts in export"
            onClick={() => setIncludeAccountsPersisted(!includeAccounts)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="hint">
          {includeAccounts
            ? "This file can control your lights too — only send it somewhere you trust."
            : "Off (default): the file holds no keys — you re-pair your lights on the other device, and everything else lines back up."}
        </p>
        <div className="io-row">
          <button className="btn btn-sm" onClick={exportSetup}>
            Export setup
          </button>
          <button className="btn btn-sm" onClick={copyAsText}>
            Copy as text
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Import setup
          </button>
          <button className="btn btn-sm" onClick={() => setPasting((v) => !v)}>
            Paste text
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
        {pasting && (
          <div className="paste-row">
            <textarea
              className="note-input"
              rows={3}
              placeholder="Paste a copied setup here"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button className="btn btn-sm" disabled={!pasteText.trim()} onClick={importPastedText}>
              Import pasted text
            </button>
          </div>
        )}
        {ioNote && <p className="hint io-note">{ioNote}</p>}
      </div>

      {isTauri() && (
        <div className="set-section">
          <span className="label">Desktop</span>
          <p className="hint">
            Closing the window keeps Aura running in the tray, so automations and the day rhythm
            carry on. Quit from the tray icon when you want it fully stopped.
          </p>
          {autostart !== null && (
            <div className="adaptive-row">
              <span className="hint">Start quietly in the tray when you log in</span>
              <button
                className="toggle sm"
                role="switch"
                aria-checked={autostart}
                aria-label="Start Aura when you log in"
                onClick={toggleAutostart}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="set-section">
        <span className="label">How Aura works</span>
        <p className="hint">
          Aura runs entirely on this device and talks straight to each brand's own service. It has no
          account, and your keys, devices, and scenes never leave here. The only exception is a note you
          choose to send from Help — that's the one thing that ever reaches a server of ours.
        </p>
        {version && <p className="hint io-note">Aura desktop v{version}</p>}
      </div>
    </Sheet>
  );
}
