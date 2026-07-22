import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["peopleos-mark.svg"],
      manifest: {
        id: "/",
        name: "PeopleOS",
        short_name: "PeopleOS",
        description:
          "A calm relationship operating system that helps you remember people.",
        theme_color: "#f4f6f1",
        background_color: "#f4f6f1",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "peopleos-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"]
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true
  }
});
