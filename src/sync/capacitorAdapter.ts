import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PeopleOSCloudSyncAdapter } from "./types";

const nativePlugin = registerPlugin<PeopleOSCloudSyncAdapter>("PeopleOSCloudSync");

export function isCloudSyncSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function getCloudSyncAdapter(): PeopleOSCloudSyncAdapter | undefined {
  return isCloudSyncSupported() ? nativePlugin : undefined;
}
