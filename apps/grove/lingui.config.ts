// lingui.config.ts — Grove is the family's i18n pilot. English is the source
// language and lives in the code itself; every other language is a catalog
// under src/locales/, compiled at build time into a lazy pack. "pseudo" is the
// dev-only accent that proves every string went through extraction.
import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "pseudo"],
  pseudoLocale: "pseudo",
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["src"],
    },
  ],
  format: "po",
});
