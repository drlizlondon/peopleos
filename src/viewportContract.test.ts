import { describe, expect, it } from "vitest";
import styles from "./styles.css?raw";

describe("mobile viewport contract", () => {
  it("contains Today inside the dynamic safe viewport and reserves long-list scrolling for the screen", () => {
    expect(styles).toMatch(/\.today-screen\s*\{[^}]*height:\s*calc\(100dvh/);
    expect(styles).toMatch(/\.today-screen\s*\{[^}]*overflow-y:\s*auto/);
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("@media (max-height: 740px)");
  });

  it("contains data-entry screens without relying on permanent blank keyboard space", () => {
    expect(styles).toMatch(/\.form-screen\s*\{[^}]*height:\s*calc\(100dvh/);
    expect(styles).toMatch(/\.form-screen\s*\{[^}]*overflow-y:\s*auto/);
    expect(styles).toMatch(/\.edit-person-screen \.form-actions\s*\{[\s\S]*?position:\s*sticky/);
    expect(styles).toMatch(/bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it("keeps primary mobile controls at the accessible 44px floor", () => {
    expect(styles).toMatch(/Accessible control floor[\s\S]*?\.primary-action,[\s\S]*?min-height:\s*44px/);
    expect(styles).toMatch(/\.today-card-actions button,[\s\S]*?min-height:\s*44px/);
  });
});
