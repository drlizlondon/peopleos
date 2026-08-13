import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PeopleOSCloudSyncAdapter } from "./types";

let nativePlugin: PeopleOSCloudSyncAdapter | undefined;

export function isCloudSyncSupported(): boolean {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === "ios"
    && Capacitor.isPluginAvailable("PeopleOSCloudSync");
}

export function getCloudSyncAdapter(): PeopleOSCloudSyncAdapter | undefined {
  if (!isCloudSyncSupported()) return undefined;
  nativePlugin ??= registerPlugin<PeopleOSCloudSyncAdapter>("PeopleOSCloudSync");
  return nativePlugin;
}
