// platform.ts — the one place that knows whether Aura is running inside the Tauri
// shell (desktop now, mobile later) or a plain browser. It matters for one reason:
// under Tauri, requests go through the native HTTP stack (Rust), which can reach a
// LAN device like a Hue bridge without the browser's CORS / mixed-content /
// self-signed-cert walls. In the browser we use the normal fetch. One codebase,
// both worlds.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// A fetch that uses Tauri's native HTTP when available, else the browser's — same
// shape as window.fetch, so callers never care which they got. (Accepting the Hue
// bridge's self-signed cert is configured on the Tauri side in Phase 2.)
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return window.fetch(input, init);
}
