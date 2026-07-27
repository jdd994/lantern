import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@lantern/ui/styles.css";
import "./styles.css";

// A _headers-only deploy (CSP fixes, e.g.) changes zero bundled bytes, so the
// PWA service worker sees nothing to update and keeps serving the old CSP
// forever on an already-installed app — reopening alone can't fix it.
// console.log has an observable side effect, so minifiers can't dead-code
// eliminate it the way they did the first attempt at this (a bare unused
// const) — that's the actual reason this line exists, not the message
// itself. If you're bumping this for the same reason, just touch the number.
console.log("[aura] build 2");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
