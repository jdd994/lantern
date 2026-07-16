// Welcome.tsx — the first-run screen. Aura has no account or unlock, so this is
// simply a warm hello that says what it is and offers the two ways in: your real
// lights, or the demo. Shown once (a localStorage flag), then never again.
export function Welcome({
  onConnect,
  onDemo,
  busy,
}: {
  onConnect: () => void;
  onDemo: () => void;
  busy: boolean;
}) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true" />
      <h1 className="welcome-title">
        Aura<span>.</span>
      </h1>
      <p className="welcome-lede">Set the atmosphere of your space.</p>
      <p className="welcome-body">
        Control your lights, save a look as a <em>scene</em>, and set the whole room to a{" "}
        <em>vibe</em> in one tap. Calm at any hour.
      </p>
      <p className="welcome-body welcome-soft">
        Everything stays on this device — no account, no cloud, nothing watching.
      </p>

      <div className="welcome-actions">
        <button className="btn btn-primary" onClick={onConnect}>
          Connect your lights
        </button>
        <button className="btn btn-ghost" onClick={onDemo} disabled={busy}>
          {busy ? "Opening…" : "Explore the demo"}
        </button>
      </div>
    </div>
  );
}
