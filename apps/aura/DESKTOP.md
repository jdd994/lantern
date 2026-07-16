# Aura for desktop — install & use

Aura sets the atmosphere of your space: control your smart lights, save **scenes**
(a vibe you recall in one tap), group lights into **rooms**, run gentle
**automations** (like "lights up at sunset"), and let the room follow a **vibe**.

The desktop app exists for one reason the website can't manage: **Philips Hue**.
A web browser can't talk to a Hue bridge on your home network (security rules block
it). The desktop app can — so Hue only appears here, not on the website.

> Everything runs on your machine. There's no account and no Aura server; your
> bridge key, devices, scenes, and automations never leave your computer.

---

## 1. Get the app

Download the build for your computer from the project's **GitHub → Actions →
"Aura desktop build"** (open the latest successful run and grab the artifact), or
from a Releases page if one is published:

| Your computer | File to download |
|---|---|
| **Mac (Apple Silicon / M1–M4)** | `aura-macos-latest-…` → `.dmg` |
| **Mac (Intel)** | `aura-macos-13-…` → `.dmg` |
| **Windows** | `aura-windows-latest` → `.msi` or `.exe` |
| **Linux** | `aura-ubuntu-…` → `.AppImage` or `.deb` |

These are **unsigned test builds**, so your OS will warn you the first time. That's
expected — here's how to open them.

### Opening on macOS
1. Open the `.dmg` and drag **Aura** to Applications.
2. The first time, **right-click the app → Open** (don't double-click), then click
   **Open** in the dialog. You only do this once.
3. If macOS still refuses ("damaged / can't be opened"), open **Terminal** and run:
   ```
   xattr -dr com.apple.quarantine /Applications/Aura.app
   ```
   then open it normally.

### Opening on Windows
Double-click the installer. On the blue "Windows protected your PC" screen, click
**More info → Run anyway**.

### Opening on Linux
For the `.AppImage`: `chmod +x Aura_*.AppImage` then run it. Or install the `.deb`
with `sudo dpkg -i aura_*.deb`.

---

## 2. Connect your Hue lights

1. Open Aura and click **Connect lights**.
2. Choose **Philips Hue**.
3. Click **Find my bridge** — Aura looks for it on your network and fills in its
   address. (If it isn't found, type the bridge's IP address; the Hue app shows it
   under Settings → My Hue System → your bridge.)
4. **Press the round button on top of the Hue bridge**, then within 30 seconds click
   **Press link button, then Pair**.
5. Your lights appear. That's it — Aura remembers the bridge from now on.

> No Hue gear handy? Choose **Demo room** instead — four make-believe lights you can
> control, group, and save scenes with, to try everything before wiring up real ones.

---

## 3. Using Aura

- **Lights** — tap a light to toggle it; drag for brightness; tap the swatch for
  color.
- **Rooms** — tap **Rooms** to group lights by place (Living room, Backyard). Each
  room gets its own **All on / All off**.
- **Scenes** — set your lights how you like them, then **Save current** as a scene
  (per room, or "Whole home"). One tap later brings the whole vibe back.
- **Vibe** — the row at the top sets a mood across everything in one tap
  (Candlelight, Calm, Sunset, Focus, Daylight, Wind-down).
- **Auto… (Read the room)** — from the Vibe row, open the ambient panel: it can set
  the vibe from what it hears, dialed in by the time of day. Listening is on your
  device only — nothing is recorded or sent. (Simulate mode lets you try it without
  a mic.)
- **Automations (⏱)** — "when sunset, apply Evening", "at 11pm, all off", or "when
  the hall sensor sees motion, …". Note: the desktop app must be running for these
  to fire.
- **Menu bar / tray** — Aura sits in your menu bar: click it for **All lights off**
  or to bring the window back, without opening the app.

---

## 4. If something's off

- **"No bridges found"** — type the bridge IP by hand (Hue app → Settings → My Hue
  System). Make sure you're on the same wifi as the bridge.
- **"Press the link button"** error — you have ~30 seconds after pressing the
  bridge button; press it and click Pair again.
- **Lights don't respond** — reconnect from **Settings → Disconnect**, then pair
  again. Confirm the lights work in the Hue app first.
- **Microphone does nothing** — grant mic permission when asked; it's experimental
  and only reads loudness/liveliness (it doesn't yet tell music from birdsong).

---

## For developers — run & build from source

From the monorepo root:

```bash
npm ci                      # install everything (workspaces)

# Run the desktop app in dev (hot-reloading web UI inside the native shell):
npm run tauri -w aura -- dev

# Build installers for THIS machine:
npm run tauri -w aura -- build
# → apps/aura/src-tauri/target/release/bundle/
```

Prerequisites: Node 20+, Rust (stable), and the Tauri system deps for your OS
(see tauri.app → Prerequisites). The plain web app still runs with `npm run dev -w
aura` and has no Rust requirement — Hue is simply hidden there.

**Cross-platform installers** are produced by CI (`.github/workflows/aura-desktop.yml`):
run it from the Actions tab, or push a tag `aura-v*`. It builds macOS (Apple Silicon
+ Intel), Windows, and Linux and attaches the installers to the run.

The desktop shell is deliberately thin: it's the same web build, plus a native HTTP
client so the UI can reach the Hue bridge. See `src/lib/platform.ts` and
`src-tauri/`.
