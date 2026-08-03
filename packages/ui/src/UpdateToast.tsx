// UpdateToast — the quiet "a newer build is waiting" note, shared chrome for
// every PWA in the family. The app renders it only when its service worker has
// a new version parked (vite-pwa "prompt" mode): one line, one Refresh, one
// dismiss. Never a modal, never a nag — dismissing just waits for the next
// natural launch to offer again. Styling reads each app's own tokens
// (styles.css), so it looks native wherever it appears.
export function UpdateToast({
  appName,
  onRefresh,
  onDismiss,
}: {
  appName: string;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="l-update" role="status">
      <span className="l-update-text">A new {appName} is ready.</span>
      <button className="l-update-refresh" onClick={onRefresh}>
        Refresh
      </button>
      <button className="l-update-dismiss" aria-label="Not now" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
