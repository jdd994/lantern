import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@lantern/ui/styles.css";
import "./styles.css";

// A _headers-only deploy (CSP fixes, e.g.) changes zero bundled bytes, so the
// PWA service worker sees nothing to update and keeps serving the old CSP
// forever on an already-installed app — reopening alone can't fix it.
// Touching this file forces a real content-hash change so autoUpdate has
// something to actually detect. If you're bumping this for the same reason,
// just touch the number.
const BUILD_TOUCH = 1;
void BUILD_TOUCH;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
