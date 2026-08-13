import { describe, expect, it } from "vitest";
import {
  appAssetPath,
  applicationBasePath,
  browserPathForLogicalPath,
  logicalPathFromBrowserPath
} from "./platformRouting";

describe("platform application routes", () => {
  it("publishes the browser product below /app", () => {
    expect(applicationBasePath(false)).toBe("/app");
    expect(browserPathForLogicalPath("/", false)).toBe("/app");
    expect(browserPathForLogicalPath("/people/person-1", false)).toBe("/app/people/person-1");
    expect(logicalPathFromBrowserPath("/app", false)).toBe("/");
    expect(logicalPathFromBrowserPath("/app/reach-out", false)).toBe("/reach-out");
    expect(appAssetPath("peopleos-mark.svg", false)).toBe("/app/peopleos-mark.svg");
  });

  it("keeps the Capacitor product at its packaged root", () => {
    expect(applicationBasePath(true)).toBe("");
    expect(browserPathForLogicalPath("/", true)).toBe("/");
    expect(browserPathForLogicalPath("/people/person-1", true)).toBe("/people/person-1");
    expect(logicalPathFromBrowserPath("/settings", true)).toBe("/settings");
    expect(appAssetPath("peopleos-mark.svg", true)).toBe("/peopleos-mark.svg");
  });
});
