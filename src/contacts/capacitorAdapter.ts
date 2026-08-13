import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PeopleOSContactsAdapter } from "./types";

const nativePlugin = registerPlugin<PeopleOSContactsAdapter>("PeopleOSContacts");

export function isIPhoneContactsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function getIPhoneContactsAdapter(): PeopleOSContactsAdapter | undefined {
  return isIPhoneContactsSupported() ? nativePlugin : undefined;
}
