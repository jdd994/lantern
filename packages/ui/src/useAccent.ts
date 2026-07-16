// useAccent — "make it your own": a personal accent color that overrides the app's
// signature hue. Cross-app by design — it just sets the shared `--accent` custom
// property on <html>, so any app whose accent derives from `var(--accent)` picks it
// up everywhere (buttons, toggles, focus rings, the lot). Persisted in localStorage;
// resets back to the app's designed default. Cosmetic only — never touches content.
import { useCallback, useEffect, useState } from "react";

export function useAccent(storageKey: string) {
  const [accent, setAccentState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey) || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (accent) root.style.setProperty("--accent", accent);
    else root.style.removeProperty("--accent"); // fall back to the stylesheet default
  }, [accent]);

  const setAccent = useCallback(
    (hex: string) => {
      setAccentState(hex);
      try {
        localStorage.setItem(storageKey, hex);
      } catch {
        /* private mode — the choice just won't persist */
      }
    },
    [storageKey]
  );

  const resetAccent = useCallback(() => {
    setAccentState(null);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { accent, setAccent, resetAccent };
}
