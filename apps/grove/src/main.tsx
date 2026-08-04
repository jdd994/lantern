import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useRegisterSW } from "virtual:pwa-register/react";
import { I18nProvider } from "@lingui/react";
import { UpdateToast } from "@lantern/ui";
import { i18n } from "./lib/i18n";
import App from "./App";
import "@lantern/ui/styles.css";
import "./styles.css";

// A new deploy parks behind the service worker (vite-pwa "prompt" mode) until
// the person says Refresh — the shared UpdateToast is the whole ceremony.
// Mounted beside App, not inside it: the toast is fixed-position chrome that
// should be offerable on every screen, whichever branch App is showing.
function UpdateOffer() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // A tab left open for days should still learn about new builds.
      if (registration) setInterval(() => void registration.update(), 60 * 60_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <UpdateToast
      appName="Grove"
      onRefresh={() => void updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App />
      <UpdateOffer />
    </I18nProvider>
  </StrictMode>
);
