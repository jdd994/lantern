// platform.ts — the one place that knows whether Aura is running inside the Tauri
// shell (desktop now, mobile later) or a plain browser. It matters for one reason:
// under Tauri, requests go through the native HTTP stack (Rust), which can reach a
// LAN device like a Hue bridge without the browser's CORS / mixed-content /
// self-signed-cert walls. In the browser we use the normal fetch. One codebase,
// both worlds.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// The desktop build's own version (from tauri.conf.json, baked in at build
// time) — null in the browser, where there's no installed build to name;
// auravibe.app is always whatever's currently deployed.
export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

// A fetch that uses Tauri's native HTTP when available, else the browser's — same
// shape as window.fetch, so callers never care which they got. (Accepting the Hue
// bridge's self-signed cert is configured on the Tauri side in Phase 2.)
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, {
      ...init,
      // The Hue bridge presents a self-signed cert on a LAN IP (its CN is the bridge
      // id, not the address), so both cert and hostname checks must be relaxed. This
      // path only ever reaches a local device the user paired themselves.
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
  }
  return window.fetch(input, init);
}
