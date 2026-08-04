// useLocale — the shared language preference, shaped like useTheme: a
// device-local localStorage choice that never touches vault content and never
// syncs. Until a choice is made, the browser's own language list decides —
// the person already told their device what they speak; we just listen.
import { useCallback, useState } from "react";

export function useLocale(storageKey: string, available: string[], fallback = "en") {
  const detect = (): string => {
    try {
      const saved = localStorage.getItem(storageKey) || "";
      if (available.includes(saved)) return saved;
    } catch {
      /* private mode — fall through to the browser's list */
    }
    for (const lang of navigator.languages ?? []) {
      const tag = lang.toLowerCase();
      if (available.includes(tag)) return tag;
      const base = tag.split("-")[0];
      if (available.includes(base)) return base;
    }
    return fallback;
  };

  const [locale, setLocaleState] = useState<string>(detect);

  const setLocale = useCallback(
    (l: string) => {
      setLocaleState(l);
      try {
        localStorage.setItem(storageKey, l);
      } catch {
        /* private mode — the preference just won't persist */
      }
    },
    [storageKey],
  );

  return { locale, setLocale };
}
