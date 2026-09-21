/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { lingui } from "@lingui/vite-plugin";

export default defineConfig({
  plugins: [
    react({
      babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
    }),
    lingui(),
    VitePWA({
      // "prompt": a new build waits until the person says Refresh (UpdateToast in main.tsx).
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Grove",
        short_name: "Grove",
        description: "A family tree the family writes together.",
        theme_color: "#10150E",
        background_color: "#10150E",
        display: "standalone",
        start_url: "/",
        // Rendered from favicon.svg. The maskable one is full-bleed with the
        // art inside the safe circle, so Android can cut any shape from it.
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        // Language packs are optional by design: installing the PWA must not
        // pull every language onto the device. English lives in the main
        // bundle; other locales are fetched when chosen, then kept by the
        // runtime route below.
        globIgnores: ["**/assets/locales/**"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: /\/assets\/locales\/.*\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "grove-locales",
              expiration: { maxEntries: 8 },
            },
          },
        ],
      },
      devOptions: { enabled: true },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Locale packs get their own directory so the precache exclusion
        // above can name them without knowing the languages.
        chunkFileNames: (info) =>
          info.facadeModuleId?.includes("/locales/")
            ? "assets/locales/[name]-[hash].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
