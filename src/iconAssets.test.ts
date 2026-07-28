import { describe, expect, it } from "vitest";
import mark from "../public/peopleos-mark.svg?raw";
import icon192 from "../public/icon-192.png?url";
import icon512 from "../public/icon-512.png?url";
import touch from "../public/apple-touch-icon.png?url";

describe("PeopleOS app identity assets", () => {
  it("uses the raspberry mark and includes required web icon sizes", () => {
    expect(mark).toContain("#A61E4D");
    expect(mark).not.toMatch(/#173d36|green/i);
    expect(icon192).toContain("icon-192.png");
    expect(icon512).toContain("icon-512.png");
    expect(touch).toContain("apple-touch-icon.png");
  });
});
