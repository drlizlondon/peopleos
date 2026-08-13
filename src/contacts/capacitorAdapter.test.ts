import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  platform: "ios",
  plugin: {
    pickContacts: vi.fn(),
    createContact: vi.fn()
  }
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform
  },
  registerPlugin: vi.fn(() => native.plugin)
}));

import {
  getIPhoneContactsAdapter,
  isIPhoneContactsSupported
} from "./capacitorAdapter";

describe("iPhone Contacts Capacitor adapter", () => {
  beforeEach(() => {
    native.isNative = true;
    native.platform = "ios";
  });

  it("exposes the native plugin only in the native iOS build", () => {
    expect(isIPhoneContactsSupported()).toBe(true);
    expect(getIPhoneContactsAdapter()).toBe(native.plugin);

    native.platform = "android";
    expect(isIPhoneContactsSupported()).toBe(false);
    expect(getIPhoneContactsAdapter()).toBeUndefined();

    native.platform = "ios";
    native.isNative = false;
    expect(isIPhoneContactsSupported()).toBe(false);
    expect(getIPhoneContactsAdapter()).toBeUndefined();
  });
});
