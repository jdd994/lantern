/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Tauri's CLI sets this for every `tauri dev`/`tauri build` invocation of
// this app's own beforeDevCommand/beforeBuildCommand, so it's a reliable way
// to tell "this build is going inside the desktop shell" from "this build is
// auravibe.app in a browser" without any extra config on our end.
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Desktop already ships every asset in the installer — a Workbox cache
      // on top of that has no offline benefit and one real cost: WebView2's
      // cache/service-worker storage lives in a per-user folder that survives
      // an uninstall, so a stale cached build can keep serving itself forever
      // even after installing a newer version over it (this happened: v0.1.16
      // kept showing pre-transfer-feature UI after a clean reinstall).
      // selfDestroying ships a service worker whose only job is to unregister
      // itself, clear every cache, and reload — once a previously-registered
      // real one updates into this, the desktop app self-heals. Cheap enough
      // to just leave in place for every future Tauri build, so this class of
      // bug can't recur; the browser build below is untouched.
      ...(isTauriBuild ? { selfDestroying: true } : {}),
      // "prompt": a new build waits until the person says Refresh (the
      // UpdateToast in App.tsx), instead of silently swapping under them —
      // and instead of the old autoUpdate behavior where an installed PWA
      // only caught up after a couple of blind relaunches.
      registerType: "prompt",
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
        // The lazy transformers.js chunk (~560KB) must not ride the precache
        // — installing Aura should never pull that in for someone who never
        // taps to speak. It's a normal .js file that would otherwise match
        // globPatterns despite only ever being reached from the dynamic
        // import in voice-source.ts, so it's excluded by name. The voice
        // model itself (~65MB) lives on R2, not this origin, so it was never
        // a precache candidate in the first place. Both get cached on first
        // use instead, below.
        globIgnores: ["assets/transformers.web-*.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin && /transformers\.web-.*\.js$/.test(url.pathname)) ||
              url.origin === "https://pub-265b50abb06d41f9afcab96b2dee95ae.r2.dev",
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
