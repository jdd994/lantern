// i18n.ts — the words, chosen at runtime.
//
// The modularity promise, kept structurally: English ships inside the app
// bundle, because English IS the app's words — choosing it costs nothing
// extra. Every other language is an optional pack: a separate lazy chunk,
// deliberately left out of the service worker's precache (see vite.config),
// fetched only when someone chooses that language and cached by the runtime
// route from then on. Nobody's device holds a language they never asked for.
import { i18n } from "@lingui/core";
import { messages as en } from "../locales/en.po";

export type LocaleOption = { id: string; label: string };

// Labels are each language's own name for itself — never translated, so the
// person who needs the language can always find it.
export const LOCALES: LocaleOption[] = [
  { id: "en", label: "English" },
  // The pseudo-accent: dev tooling that proves every string is extracted.
  ...(import.meta.env.DEV ? [{ id: "pseudo", label: "Ⓟśéûdó (dev)" }] : []),
];

// One entry per optional pack. English is absent on purpose — it's preloaded.
const packs: Record<string, () => Promise<{ messages: typeof en }>> = {
  pseudo: () => import("../locales/pseudo.po"),
};

i18n.load("en", en);
i18n.activate("en");

export { i18n };

export async function activateLocale(locale: string): Promise<void> {
  const pack = packs[locale];
  if (pack) {
    const { messages } = await pack();
    i18n.load(locale, messages);
  } else if (locale !== "en") {
    locale = "en"; // an unknown saved value falls back gracefully
  }
  i18n.activate(locale);
  // Screen readers and font selection follow the document language. The
  // pseudo-accent is still English underneath.
  document.documentElement.lang = locale === "pseudo" ? "en" : locale;
}
