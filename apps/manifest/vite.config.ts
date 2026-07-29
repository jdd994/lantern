/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Manifest",
        short_name: "Manifest",
        description: "The list of what you carry. Checked at the door, shared with the people you travel with — end-to-end encrypted.",
        theme_color: "#0D131A",
        background_color: "#0D131A",
        display: "standalone",
        start_url: "/",
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
