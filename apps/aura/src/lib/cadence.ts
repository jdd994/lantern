// cadence.ts — run a callback on a steady cadence that survives a hidden window.
//
// In the browser, setInterval is the whole story: Aura's engines only run while
// the tab is open, and the UI says exactly that. In the Tauri shell the window
// closes to the tray with the app still running — but a hidden webview's own
// timers get throttled (Chromium clamps a hidden page's timers, eventually
// toward once a minute), which would stretch a 20-minute wake-up fade and blunt
// motion triggers. IPC events are never throttled, so the Rust side emits a
// steady `aura://tick` heartbeat (src-tauri/src/lib.rs), and this helper runs
// the callback from whichever source fires first — guarded by a shared
// last-run stamp so the two sources can't double-run or, by being out of
// phase, quietly halve the cadence.
import { isTauri } from "./platform";

export function startCadence(ms: number, fn: () => void): () => void {
  let last = Date.now();
  const run = () => {
    last = Date.now();
    fn();
  };
  const id = setInterval(run, ms);
  let unlisten: (() => void) | undefined;
  let stopped = false;
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u = await listen("aura://tick", () => {
        // A little slack so a heartbeat landing just shy of the interval still
        // counts — but never so much that alternating sources speed things up.
        if (Date.now() - last >= ms - Math.min(2_500, ms * 0.2)) run();
      });
      if (stopped) u();
      else unlisten = u;
    });
  }
  return () => {
    stopped = true;
    clearInterval(id);
    unlisten?.();
  };
}
