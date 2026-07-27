/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Aura",
        short_name: "Aura",
        description: "Set the atmosphere of your space.",
        theme_color: "#14100A",
        background_color: "#14100A",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the shell so it opens offline. Device states are never cached —
        // a stale "on" shown as current would be worse than an honest reload.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // The voice model + its WASM runtime (~100MB) must not ride the
        // precache — installing Aura should never force that download on
        // someone who never taps to speak. voice-assets.mjs's output lives
        // under voice/ (globPatterns already omits .wasm/.onnx, but ignore
        // the whole tree to be explicit); the lazy transformers.js chunk
        // Vite discovers on its own is a normal .js file that would
        // otherwise match globPatterns despite only ever being reached from
        // the dynamic import in voice-source.ts, so it's excluded by name
        // too. Cached on first use instead, below.
        globIgnores: ["voice/**", "assets/transformers.web-*.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && (url.pathname.startsWith("/voice/") || /transformers\.web-.*\.js$/.test(url.pathname)),
            handler: "CacheFirst",
            options: {
              cacheName: "voice-engine",
              expiration: { maxEntries: 16 },
            },
          },
        ],
        navigateFallback: "index.html",
      },
      devOptions: { enabled: true },
    }),
  ],
});
