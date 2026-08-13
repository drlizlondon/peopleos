import { describe, expect, it } from "vitest";
import documentSource from "../index.html?raw";
import mark from "../public/peopleos-mark.svg?raw";
import icon192 from "../public/icon-192.png?url";
import icon512 from "../public/icon-512.png?url";
import touch from "../public/apple-touch-icon.png?url";

describe("PeopleOS app identity assets", () => {
  it("uses the raspberry mark and includes required web icon sizes", () => {
    expect(mark).toContain("#A61E4D");
    expect(mark).not.toMatch(/#173d36|green/i);
    expect(mark.match(/<circle\b/g)).toHaveLength(2);
    expect(mark.match(/<path\b/g)).toHaveLength(2);
    expect(icon192).toContain("icon-192.png");
    expect(icon512).toContain("icon-512.png");
    expect(touch).toContain("apple-touch-icon.png");
  });

  it("keeps install icons and the iOS keyboard-safe viewport in the app document", () => {
    expect(documentSource).toContain("interactive-widget=resizes-content");
    expect(documentSource).toContain('href="%BASE_URL%icon-192.png?v=raspberry-2"');
    expect(documentSource).toContain('href="%BASE_URL%apple-touch-icon.png?v=raspberry-2"');
  });
});
