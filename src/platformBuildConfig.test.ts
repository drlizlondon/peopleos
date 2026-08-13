import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vercel from "../vercel.json";

describe("production platform routing", () => {
  it("keeps marketing routes at root and sends only /app product routes to the SPA", () => {
    expect(vercel.rewrites).toEqual(expect.arrayContaining([
      { source: "/app", destination: "/app/index" },
      { source: "/app/:path*", destination: "/app/index" },
      { source: "/privacy", destination: "/privacy/index" },
      { source: "/support", destination: "/support/index" },
      { source: "/download", destination: "/download/index" }
    ]));
    expect(vercel.rewrites.every((rewrite) => !rewrite.destination.endsWith(".html"))).toBe(true);
    expect(vercel.rewrites).not.toContainEqual(expect.objectContaining({ source: "/(.*)" }));
  });

  it("redirects legacy root product bookmarks below /app", () => {
    expect(vercel.redirects).toEqual(expect.arrayContaining([
      { source: "/people", destination: "/app/people", permanent: false },
      { source: "/people/:path*", destination: "/app/people/:path*", permanent: false },
      { source: "/reach-out", destination: "/app/reach-out", permanent: false },
      { source: "/reach-out/:path*", destination: "/app/reach-out/:path*", permanent: false },
      { source: "/settings", destination: "/app/settings", permanent: false },
      { source: "/settings/:path*", destination: "/app/settings/:path*", permanent: false },
      { source: "/upcoming", destination: "/app/upcoming", permanent: false },
      { source: "/follow-ups/:path*", destination: "/app/follow-ups/:path*", permanent: false }
    ]));
  });

  it("allows the application worker to control the canonical /app URL", () => {
    const workerHeaders = vercel.headers
      .find((entry) => entry.source === "/app/sw.js")
      ?.headers;

    expect(workerHeaders).toContainEqual({ key: "Service-Worker-Allowed", value: "/app" });
  });

  it("requires exact main provenance for CLI and Git production builds", () => {
    const buildGuard = readFileSync("scripts/vercel-build.mjs", "utf8");
    const deployCommand = readFileSync("scripts/production-deploy.mjs", "utf8");

    expect(buildGuard).toContain("PEOPLEOS_DEPLOY_BRANCH");
    expect(buildGuard).toContain("PEOPLEOS_DEPLOY_COMMIT");
    expect(buildGuard).toContain("branch !== \"main\"");
    expect(buildGuard).toContain("^[0-9a-f]{40}$");
    expect(deployCommand).toContain("PEOPLEOS_DEPLOY_BRANCH=main");
    expect(deployCommand).toContain("peopleosCommit");
  });

  it("keeps local tooling and generated/native output out of Vercel uploads", () => {
    const ignored = readFileSync(".vercelignore", "utf8").split(/\r?\n/);

    expect(ignored).toEqual(expect.arrayContaining([
      ".git",
      ".claude",
      ".vercel",
      "dist",
      "dist-app",
      "dist-native",
      "ios",
      "node_modules"
    ]));
  });

  it("keeps legacy installed root PWAs launching the product after one-time retirement", () => {
    const assembly = readFileSync("scripts/assemble-production.mjs", "utf8");

    expect(assembly).toContain('legacyStandalone && localStorage.getItem(migrationKey) === "done"');
    expect(assembly).toContain('window.location.replace("/app")');
  });
});
