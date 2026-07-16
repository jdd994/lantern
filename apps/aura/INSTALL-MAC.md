# Install Aura on your Mac

Aura lets you control your Philips Hue lights, save **scenes** and **vibes**, group
lights into **rooms**, and set gentle **automations** — all from your Mac, with
nothing leaving your computer (no account, no cloud).

Takes about two minutes. There's **one** extra click the first time (because this is
a free test build, not one bought from Apple's store) — it's noted below.

---

## 1. Download

Open the latest release and grab the Mac file:

**→ https://github.com/jdd994/lantern/releases/latest**

Under **Assets**, download the one for your Mac:

- **`Aura_…_aarch64.dmg`** — for Apple Silicon Macs (M1, M2, M3, M4). *This is almost
  certainly you* if your Mac is from late 2020 or newer.
- **`Aura_…_x64.dmg`** — only for older **Intel** Macs.

> Not sure? Apple menu () → **About This Mac**. If it says "Chip: Apple M…", use
> the `aarch64` file. If it says "Processor: Intel", use the `x64` file.

## 2. Install

1. Double-click the downloaded `.dmg`.
2. Drag the **Aura** icon into the **Applications** folder.

## 3. Open it (the one-time step)

Because this is a free test build, macOS will ask you to confirm the first time:

1. Open your **Applications** folder.
2. **Right-click** (or Control-click) **Aura → Open**.
3. In the dialog, click **Open**.

That's it — from now on you can open Aura normally.

> If macOS says *"Aura is damaged and can't be opened"*, open the **Terminal** app
> and paste this line, then press Return, and try opening again:
> ```
> xattr -dr com.apple.quarantine /Applications/Aura.app
> ```

## 4. Connect your Hue lights

1. Click **Connect lights**.
2. Choose **Philips Hue**.
3. Click **Find my bridge** (make sure your Mac is on the same Wi-Fi as the Hue
   bridge). If it doesn't find it, type the bridge's IP address — the Hue app shows
   it under **Settings → My Hue System**.
4. **Press the round button on top of the Hue bridge**, then click **Press link
   button, then Pair** within 30 seconds.
5. Your lights appear. Done — Aura remembers the bridge next time.

> **No lights to test with?** Choose **Demo room** instead of Hue — four pretend
> lights you can play with to see how everything works.

---

## Using Aura

- **Tap a light** to turn it on/off; **drag** for brightness; **tap the color
  swatch** to change color.
- **Vibe** (top row) — one tap sets a mood across everything (Candlelight, Calm,
  Sunset, Focus, Daylight, Wind-down). Tap **+ New** to make your own.
- **Scenes** — set the lights how you like, then **Save current**. One tap brings
  that whole look back later.
- **Rooms** — group lights by place, each with its own **All on / All off**.
- **Auto…** (on the Vibe row) — let Aura set the vibe from the room's sound + the
  time of day. Listening happens only on your Mac; nothing is recorded or sent.
- **⏱ Automations** — e.g. "at sunset, apply Evening." (Aura needs to be open for
  these to run.)

## Anything weird?

- **Won't open / "unidentified developer"** → use the right-click → **Open** step
  above (step 3). It's expected for a free test build.
- **"No bridges found"** → type the bridge IP by hand (Hue app → Settings → My Hue
  System), and check you're on the same Wi-Fi.
- **"Press the link button" error** → you have ~30 seconds after pressing the
  bridge's button; press it and click Pair again.
- **Lights don't respond** → Settings → **Disconnect**, then pair again. Make sure
  they work in the official Hue app first.

Thanks for testing it 🙏 — tell me what feels good and what doesn't.
