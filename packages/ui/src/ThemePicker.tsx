// ThemePicker — a grid of vibe swatches. App-agnostic: each app passes its own
// presets (id + name + a preview bg/ink/accent). Presets now; a deeper "make it
// your own" customization can grow on top of this later.
export type ThemeOption = {
  id: string;
  name: string;
  desc?: string;
  bg: string;
  ink: string;
  accent: string;
};

export function ThemePicker({
  options,
  current,
  onSelect,
}: {
  options: ThemeOption[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="l-theme-grid">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={"l-theme-swatch" + (current === o.id ? " active" : "")}
          aria-pressed={current === o.id}
          onClick={() => onSelect(o.id)}
          style={{ background: o.bg, color: o.ink }}
        >
          <span className="l-theme-top">
            <span className="l-theme-dot" style={{ background: o.accent }} />
            <span className="l-theme-name">{o.name}</span>
          </span>
          {o.desc ? <span className="l-theme-desc">{o.desc}</span> : null}
        </button>
      ))}
    </div>
  );
}
