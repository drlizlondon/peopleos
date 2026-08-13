import { describe, expect, it } from "vitest";
import { PEOPLEOS_BUILD_COMMIT } from "./buildMetadata";

describe("build metadata", () => {
  it("embeds a traceable source revision", () => {
    expect(PEOPLEOS_BUILD_COMMIT).toMatch(/^(?:[0-9a-f]{7,40}(?:-dirty)?|uncommitted)$/);
  });
});
