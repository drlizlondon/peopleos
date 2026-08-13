import { Capacitor, registerPlugin } from "@capacitor/core";
import type { ContactPickerResult, PeopleOSContactsAdapter } from "./types";

const nativePlugin = registerPlugin<PeopleOSContactsAdapter>("PeopleOSContacts");

export function isIPhoneContactsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function getIPhoneContactsAdapter(): PeopleOSContactsAdapter | undefined {
  return isIPhoneContactsSupported() ? nativePlugin : undefined;
}

function isUnimplementedPluginMethod(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code).toUpperCase() : "";
  return code === "UNIMPLEMENTED";
}

/**
 * Prefer Apple's single-contact selection flow, while keeping installed native
 * shells from before `pickContact` was added usable until they are upgraded.
 * Capacitor proxies can expose a method that the installed plugin does not yet
 * implement, so capability fallback must also handle its runtime rejection.
 */
export async function pickSingleIPhoneContact(
  adapter: PeopleOSContactsAdapter
): Promise<ContactPickerResult> {
  if (!adapter.pickContact) return adapter.pickContacts();
  try {
    return await adapter.pickContact();
  } catch (error) {
    if (isUnimplementedPluginMethod(error)) return adapter.pickContacts();
    throw error;
  }
}
