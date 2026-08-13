import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: true,
  platform: "ios",
  cloudPluginAvailable: false,
  plugin: {
    getAccountStatus: vi.fn(),
    pushOperations: vi.fn(),
    fetchChanges: vi.fn(),
    fetchAllRecords: vi.fn(),
    getSyncHealth: vi.fn()
  }
}));

const registerPlugin = vi.hoisted(() => vi.fn(() => native.plugin));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
    isPluginAvailable: (name: string) => name === "PeopleOSCloudSync" && native.cloudPluginAvailable
  },
  registerPlugin
}));

import { getCloudSyncAdapter, isCloudSyncSupported } from "./capacitorAdapter";

describe("iCloud Sync Capacitor adapter", () => {
  beforeEach(() => {
    native.isNative = true;
    native.platform = "ios";
    native.cloudPluginAvailable = false;
    registerPlugin.mockClear();
  });

  it("keeps a native iOS build local when the CloudKit plugin is deliberately absent", () => {
    expect(isCloudSyncSupported()).toBe(false);
    expect(getCloudSyncAdapter()).toBeUndefined();
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("exposes the adapter only when the production native plugin is registered", () => {
    native.cloudPluginAvailable = true;
    expect(isCloudSyncSupported()).toBe(true);
    expect(getCloudSyncAdapter()).toBe(native.plugin);
    expect(registerPlugin).toHaveBeenCalledOnce();

    native.cloudPluginAvailable = false;
    expect(isCloudSyncSupported()).toBe(false);
    expect(getCloudSyncAdapter()).toBeUndefined();
  });
});
