/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new build waits until the person says Refresh (UpdateToast in main.tsx).
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Grove",
        short_name: "Grove",
        description: "A family tree the family writes together.",
        theme_color: "#10150E",
        background_color: "#10150E",
        display: "standalone",
        start_url: "/",
        // SVG-only for now; render proper PNG + maskable icons before deploy.
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: "index.html",
      },
      devOptions: { enabled: true },
    }),
  ],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
