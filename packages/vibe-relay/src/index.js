// index.js — the vibe relay: broadcast whatever JSON one connected client sends to
// every other connected client. Nothing more. No auth, no storage, no interpretation
// of the message — it doesn't need to know what a "vibe" is, only that lantern apps
// on this machine want to hear each other's. Bound to localhost only, on purpose:
// this must never be reachable from the network. Keep PORT in sync with
// VIBE_RELAY_PORT in packages/core/src/vibe-relay.ts.
import { WebSocketServer } from "ws";

const PORT = 51774;
const HOST = "127.0.0.1";

const wss = new WebSocketServer({ port: PORT, host: HOST });

wss.on("connection", (client) => {
  client.on("message", (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return; // not JSON — drop it silently, the relay stays dumb but not gullible
    }
    const payload = JSON.stringify(parsed);
    for (const other of wss.clients) {
      if (other !== client && other.readyState === other.OPEN) other.send(payload);
    }
  });
});

wss.on("listening", () => {
  console.log(`lantern vibe relay listening on ws://${HOST}:${PORT} (local only)`);
});

wss.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} is already in use — a vibe relay is probably already running. Nothing to do.`);
    process.exit(0);
  }
  console.error("vibe relay error:", err);
  process.exit(1);
});
