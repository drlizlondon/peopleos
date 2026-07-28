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
        theme_color: "#ffffff",
        background_color: "#ffffff",
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
    css: true,
    // Browser-level tests intentionally exercise the single production DB name.
    fileParallelism: false,
    // The V1-R performance ratchet reports its measurements on stdout. Without
    // this, vitest buffers console output and only surfaces it around
    // failures — hiding the numbers on exactly the green runs where the
    // evidence of improvement matters.
    disableConsoleIntercept: true
  }
});
