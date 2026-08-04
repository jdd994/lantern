// time.ts — relative time labels with the words supplied by Intl, not by us.
// Every app had hand-rolled its own English for these ("3m ago", "Yesterday",
// "5 minutes ago"), each with its own plural bugs waiting for translation.
// Intl.RelativeTimeFormat already says them in the user's language, with plural
// rules no ternary can match — so the apps ask it, and never spell out "ago".

const DAY_MS = 86_400_000;

// "now", "5 minutes ago", "3 hours ago", "12 days ago" — falling back to a
// short calendar date once "ago" phrasing stops helping. `style` picks the
// register: "narrow" for tight stamps next to numbers, "long" for prose.
export function relativeLabel(
  at: number,
  opts: { style?: Intl.RelativeTimeFormatStyle; maxDays?: number; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: opts.style ?? "long" });
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return rtf.format(0, "second");
  const mins = Math.round(secs / 60);
  if (mins < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < (opts.maxDays ?? 30)) return rtf.format(-days, "day");
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "Today" / "Yesterday" in the user's language, or null once a calendar date
// serves better. Capitalized, because it's used as a heading.
export function namedDay(ts: number, now = Date.now()): string | null {
  const startOf = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round((startOf(now) - startOf(ts)) / DAY_MS);
  if (diff !== 0 && diff !== 1) return null;
  const label = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-diff, "day");
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}
