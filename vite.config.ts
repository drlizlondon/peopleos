import { execFileSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function gitOutput(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function buildCommit(): string {
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.PEOPLEOS_DEPLOY_COMMIT?.trim();
  if (vercelCommit && /^[0-9a-f]{7,40}$/i.test(vercelCommit)) return vercelCommit.slice(0, 12).toLowerCase();
  const commit = gitOutput(["rev-parse", "--short=12", "HEAD"]);
  if (!commit) return "uncommitted";
  const dirty = gitOutput(["status", "--porcelain", "--untracked-files=normal"]);
  return `${commit}${dirty ? "-dirty" : ""}`;
}

export default defineConfig(({ mode }) => {
  const nativeBuild = mode === "native";
  const base = nativeBuild ? "/" : "/app/";
  const outDir = nativeBuild ? "dist-native" : "dist-app";

  return {
    base,
    publicDir: "public",
    define: {
      __PEOPLEOS_BUILD_COMMIT__: JSON.stringify(buildCommit())
    },
    build: {
      outDir,
      emptyOutDir: true
    },
    plugins: [
      react(),
      ...(nativeBuild ? [] : [
        VitePWA({
          registerType: "autoUpdate",
          scope: "/app",
          includeAssets: ["peopleos-mark.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
          manifest: {
            id: "/app",
            name: "PeopleOS",
            short_name: "PeopleOS",
            description: "A calm relationship operating system that helps you remember people.",
            theme_color: "#a61e4d",
            background_color: "#ffffff",
            display: "standalone",
            start_url: "/app",
            scope: "/app",
            icons: [
              { src: "icon-192.png?v=raspberry-2", sizes: "192x192", type: "image/png", purpose: "any" },
              { src: "icon-512.png?v=raspberry-2", sizes: "512x512", type: "image/png", purpose: "any maskable" },
              { src: "peopleos-mark.svg?v=raspberry-2", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
            ]
          },
          workbox: {
            cacheId: "peopleos-app-v1",
            globPatterns: ["**/*.{js,css,html,svg,png}"],
            navigateFallback: "/app/index.html"
          }
        })
      ])
    ],
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
      fileParallelism: false,
      disableConsoleIntercept: true
    }
  };
});
