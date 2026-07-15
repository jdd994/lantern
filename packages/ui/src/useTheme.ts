// useTheme — the shared vibe mechanism. Moods are defined in each app's CSS as
// `:root[data-mood="<id>"] { --token: … }` blocks (the palette = the app's taste);
// this hook just toggles the `data-mood` attribute on <html> and remembers the
// choice in localStorage. Cosmetic only — never touches vault content.
import { useCallback, useEffect, useState } from "react";

export function useTheme(storageKey: string, moodIds: string[], defaultMood: string) {
  const read = (): string => {
    try {
      const m = localStorage.getItem(storageKey) || "";
      return moodIds.includes(m) ? m : defaultMood;
    } catch {
      return defaultMood;
    }
  };

  const [mood, setMoodState] = useState<string>(read);

  useEffect(() => {
    document.documentElement.setAttribute("data-mood", mood);
  }, [mood]);

  const setMood = useCallback((m: string) => {
    setMoodState(m);
    try {
      localStorage.setItem(storageKey, m);
    } catch {
      /* private mode — the preference just won't persist */
    }
  }, []);

  return { mood, setMood };
}
