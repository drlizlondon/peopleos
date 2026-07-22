import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: () => undefined
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});
