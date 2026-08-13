import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  platform: "ios",
  plugin: {
    pickContact: vi.fn(),
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
  isIPhoneContactsSupported,
  pickSingleIPhoneContact
} from "./capacitorAdapter";

describe("iPhone Contacts Capacitor adapter", () => {
  beforeEach(() => {
    native.isNative = true;
    native.platform = "ios";
    vi.clearAllMocks();
  });

  it("exposes the native plugin only in the native iOS build", () => {
    expect(isIPhoneContactsSupported()).toBe(true);
    expect(getIPhoneContactsAdapter()).toBe(native.plugin);
    expect(getIPhoneContactsAdapter()?.pickContact).toBe(native.plugin.pickContact);

    native.platform = "android";
    expect(isIPhoneContactsSupported()).toBe(false);
    expect(getIPhoneContactsAdapter()).toBeUndefined();

    native.platform = "ios";
    native.isNative = false;
    expect(isIPhoneContactsSupported()).toBe(false);
    expect(getIPhoneContactsAdapter()).toBeUndefined();
  });

  it("uses the single native picker when the installed plugin supports it", async () => {
    const result = { status: "cancelled" as const, contacts: [] as [] };
    native.plugin.pickContact.mockResolvedValueOnce(result);

    await expect(pickSingleIPhoneContact(native.plugin)).resolves.toEqual(result);
    expect(native.plugin.pickContacts).not.toHaveBeenCalled();
  });

  it("falls back to the older picker only when the installed plugin lacks the new method", async () => {
    const result = { status: "cancelled" as const, contacts: [] as [] };
    native.plugin.pickContact.mockRejectedValueOnce(Object.assign(new Error("not implemented"), {
      code: "UNIMPLEMENTED"
    }));
    native.plugin.pickContacts.mockResolvedValueOnce(result);

    await expect(pickSingleIPhoneContact(native.plugin)).resolves.toEqual(result);
    expect(native.plugin.pickContacts).toHaveBeenCalledOnce();
  });

  it("does not reopen Contacts after an ordinary picker error", async () => {
    const error = Object.assign(new Error("busy"), { code: "picker_busy" });
    native.plugin.pickContact.mockRejectedValueOnce(error);

    await expect(pickSingleIPhoneContact(native.plugin)).rejects.toBe(error);
    expect(native.plugin.pickContacts).not.toHaveBeenCalled();
  });
});
