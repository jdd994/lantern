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
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Almanac",
        short_name: "Almanac",
        description: "The book of what's coming. Shows, gatherings, plans — kept with the people going, end-to-end encrypted.",
        theme_color: "#F4EFE2",
        background_color: "#F4EFE2",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
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
        navigateFallback: "index.html",
      },
      devOptions: { enabled: true },
    }),
  ],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
