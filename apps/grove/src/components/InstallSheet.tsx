// InstallSheet.tsx — "how do I put this on my phone?", answered for everyone:
// the family member who installs apps for fun and the one who calls them
// programs. Detects the platform and leads with the steps that apply, keeps
// the rest one tap away, and says the reassuring thing out loud: it's the
// same Grove either way, nothing to download from a store, and the browser
// alone is always enough.
//
// Icons are inline SVG, never unicode glyphs (they tofu on system fonts —
// a family lesson).

import { useEffect, useState } from "react";
import { Sheet } from "@lantern/ui";

// Chrome/Edge fire this when Grove qualifies for a one-tap install. Captured
// at module load (the event often fires before any sheet opens) so the sheet
// can offer a real Install button instead of steps.
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
let deferredInstall: InstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPromptEvent;
  });
}

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const iPadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isInstalled(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// The iOS share glyph: a square with an arrow rising out of it.
function ShareIcon() {
  return (
    <svg className="step-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 v12" /><path d="M8 7 l4 -4 4 4" /><path d="M5 11 v9 h14 v-9" />
    </svg>
  );
}

// Android/Chrome's three-dot menu.
function DotsIcon() {
  return (
    <svg className="step-icon" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function IosSteps() {
  return (
    <ol className="steps">
      <li>Open <strong>grove.page</strong> in <strong>Safari</strong> — for this one step it has to be Safari, the compass icon that came with the phone.</li>
      <li>Tap the <strong>Share</strong> button <ShareIcon /> — the little square with an arrow pointing up, at the bottom of the screen (top right on an iPad).</li>
      <li>Scroll down the list and tap <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong>. Grove appears on your home screen like any other app.</li>
    </ol>
  );
}

function AndroidSteps() {
  return (
    <ol className="steps">
      <li>Open <strong>grove.page</strong> in <strong>Chrome</strong>.</li>
      <li>Tap the <strong>three dots</strong> <DotsIcon /> in the top-right corner.</li>
      <li>Tap <strong>Add to Home screen</strong> (on some phones it says <strong>Install app</strong>).</li>
      <li>Confirm. Grove appears on your home screen like any other app.</li>
    </ol>
  );
}

function DesktopSteps() {
  return (
    <ol className="steps">
      <li>Open <strong>grove.page</strong> in <strong>Chrome</strong> or <strong>Edge</strong>.</li>
      <li>Look at the right end of the address bar for a small <strong>install</strong> icon (a screen with a downward arrow), or open the browser menu and choose <strong>Install Grove…</strong></li>
      <li>Click <strong>Install</strong>. Grove opens in its own window from now on.</li>
    </ol>
  );
}

const TITLES: Record<Platform, string> = {
  ios: "On an iPhone or iPad",
  android: "On an Android phone",
  desktop: "On a computer",
};

export function InstallSheet({ onClose }: { onClose: () => void }) {
  const [platform] = useState<Platform>(detectPlatform);
  const [installed, setInstalled] = useState(isInstalled);
  const [canPrompt, setCanPrompt] = useState(() => deferredInstall !== null);

  useEffect(() => {
    const onChange = () => setInstalled(isInstalled());
    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);

  async function promptInstall() {
    if (!deferredInstall) return;
    await deferredInstall.prompt();
    deferredInstall = null;
    setCanPrompt(false);
  }

  const sections: Platform[] = [platform, ...(["ios", "android", "desktop"] as Platform[]).filter((p) => p !== platform)];
  const steps: Record<Platform, () => JSX.Element> = { ios: IosSteps, android: AndroidSteps, desktop: DesktopSteps };

  return (
    <Sheet onClose={onClose} ariaLabel="How to install Grove">
      <h3>Keep Grove close</h3>

      {installed ? (
        <p>You're already reading this from the installed app — nothing more to do. 🌱</p>
      ) : (
        <>
          <p>
            Grove can live on your home screen like any app — no app store, nothing to download.
            It's the very same Grove either way, and it always works right here in the browser
            too, so there's no wrong choice.
          </p>

          {canPrompt ? (
            <>
              <p className="hint">This browser can do it in one tap:</p>
              <button className="btn btn-primary" style={{ width: "100%", marginBottom: 18 }} onClick={() => void promptInstall()}>
                Install Grove
              </button>
            </>
          ) : null}

          {sections.map((p, i) => (
            <section className="set-section" key={p}>
              <h4 className="set-head">{TITLES[p]}{i === 0 ? " (this device)" : ""}</h4>
              {i === 0 ? steps[p]() : <details className="install-more"><summary>Show the steps</summary>{steps[p]()}</details>}
            </section>
          ))}

          <p className="hint">
            Installing doesn't move or copy anything — your tree stays where it is, and you open
            it with the same passphrase. If a relative gets stuck, the plain browser at{" "}
            <strong>grove.page</strong> is always enough.
          </p>
        </>
      )}

      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}
