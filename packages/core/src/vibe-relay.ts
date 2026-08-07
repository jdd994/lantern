// vibe-relay.ts — the local transport for the shared vibe (vibe.ts): a tiny
// same-machine WebSocket relay so one app's vibe pick can reach another's while
// both run on the same computer. Deliberately NOT the sync/account system
// (packages/server) — a vibe is an ephemeral, already-on-screen mood choice, not
// data worth an account or durability, and Aura has no account by design ("you
// shouldn't type a password to dim a lamp"). This stays outside that boundary on
// purpose. See VIBE_RELAY_PORT below — packages/vibe-relay must keep the same port.
//
// The relay process (packages/vibe-relay) is optional and unauthenticated: if it
// isn't running, every function here silently no-ops. Nothing is ever sent off
// the machine — connections are `ws://localhost` only.

export const VIBE_RELAY_PORT = 51774;

export type VibeRelayEvent = {
  vibeId: string;
  roomId?: string;
  source: string; // which app sent it, e.g. "aura", "hearth", "ballast"
  at: number;
};

const RECONNECT_DELAY_MS = 4000;

export type VibeRelayHandle = {
  publish: (event: Omit<VibeRelayEvent, "at" | "source">) => void;
  close: () => void;
};

// Connects to the local relay and calls onVibe for every event another app
// publishes (never our own — the relay excludes the sender). Reconnects quietly
// on a fixed delay if the relay isn't there yet or drops; never throws, never
// surfaces an error to the caller. Call close() to stop for good (e.g. on unmount
// or when a user turns a "mirror vibes" setting off).
export function connectVibeRelay(source: string, onVibe: (event: VibeRelayEvent) => void): VibeRelayHandle {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (closed) return;
    try {
      socket = new WebSocket(`ws://localhost:${VIBE_RELAY_PORT}`);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (data && typeof data.vibeId === "string" && typeof data.source === "string" && typeof data.at === "number") {
          onVibe(data as VibeRelayEvent);
        }
      } catch {
        // malformed message from a relay we don't control the version of — ignore
      }
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => socket?.close());
  }

  connect();

  return {
    publish(event) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ ...event, source, at: Date.now() }));
      }
      // relay not connected — the vibe just doesn't mirror this time, silently
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
