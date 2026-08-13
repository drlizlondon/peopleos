import type { PeopleOsDatabase } from "../data/database";
import { compareContactMethodsForAction } from "../domain/contactMethodPolicy";
import type { ContactMethod, Person } from "../domain/schema";
import {
  formatPhoneNumberForDisplay,
  normalizeEmailAddress,
  normalizePhoneNumber
} from "../integrations/contactValues";

export type ContactNowChannel = "phone_call" | "email";

export type ContactNowTarget = {
  id: string;
  channel: ContactNowChannel;
  contactMethodId: string;
  label: string;
  familiarValue: string;
  canonicalValue: string;
  isPreferred: boolean;
};

export type ContactNowProjection = {
  targets: ContactNowTarget[];
  hasActivePhone: boolean;
};

/**
 * Exported for search, which needs only to know whether a Person has any usable
 * contact method. Sharing this predicate rather than reimplementing it keeps
 * "missing contact details" defined in exactly one place.
 */
export function isValidCurrentMethod(method: ContactMethod, displayRegion: string): boolean {
  if (method.archivedAt) return false;
  try {
    if (method.kind === "phone") {
      return normalizePhoneNumber(method.canonicalValue, displayRegion).canonicalValue
        === method.canonicalValue;
    }
    return normalizeEmailAddress(method.rawValue).canonicalValue === method.canonicalValue;
  } catch {
    return false;
  }
}

function targetForMethod(method: ContactMethod, displayRegion: string): ContactNowTarget {
  if (method.kind === "phone") {
    return {
      id: `phone_call:${method.id}`,
      channel: "phone_call",
      contactMethodId: method.id,
      label: method.label?.trim() || "Phone",
      familiarValue: formatPhoneNumberForDisplay(method.canonicalValue, displayRegion),
      canonicalValue: method.canonicalValue,
      isPreferred: method.isPreferred
    };
  }
  return {
    id: `email:${method.id}`,
    channel: "email",
    contactMethodId: method.id,
    label: method.label?.trim() || "Email",
    familiarValue: method.rawValue,
    canonicalValue: method.canonicalValue,
    isPreferred: method.isPreferred
  };
}

/**
 * Resolve validated contact targets without choosing how a phone number will
 * be handed off. Today can use the same phone target for Call or a WhatsApp
 * draft while keeping validation and ordering in one place.
 */
export function resolveContactNowTargets(
  contactMethods: readonly ContactMethod[],
  displayRegion: string
): ContactNowProjection {
  const current = contactMethods
    .filter((method) => isValidCurrentMethod(method, displayRegion))
    .sort(compareContactMethodsForAction);
  return {
    targets: current.map((method) => targetForMethod(method, displayRegion)),
    hasActivePhone: current.some((method) => method.kind === "phone")
  };
}

export function contactNowTargetHref(target: ContactNowTarget, draft?: string): string {
  if (target.channel === "phone_call") return `tel:${target.canonicalValue}`;
  const address = encodeURIComponent(target.canonicalValue).replace(/%40/gi, "@");
  const body = draft?.trim();
  return `mailto:${address}${body ? `?body=${encodeURIComponent(body)}` : ""}`;
}

/**
 * Build a WhatsApp handoff for a validated phone target. This only opens a
 * draft: the user still chooses whether to press Send in WhatsApp.
 */
export function whatsappTargetHref(target: ContactNowTarget, draft?: string): string {
  if (target.channel !== "phone_call") throw new Error("WhatsApp requires a phone number.");
  const number = target.canonicalValue.replace(/\D/g, "");
  const text = draft?.trim();
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function activePerson(person: Person | undefined): person is Person {
  return Boolean(person && !person.archivedAt && person.identityStatus !== "merged");
}

/** Read the latest methods and Settings together before presenting targets. */
export async function getContactNowProjection(
  db: PeopleOsDatabase,
  personId: string
): Promise<ContactNowProjection> {
  const tx = db.transaction(["people", "contactMethods", "appSettings"], "readonly");
  const [person, methods, settings] = await Promise.all([
    tx.objectStore("people").get(personId),
    tx.objectStore("contactMethods").index("by-person").getAll(personId),
    tx.objectStore("appSettings").get("app")
  ]);
  await tx.done;
  if (!activePerson(person) || !settings) return { targets: [], hasActivePhone: false };
  return resolveContactNowTargets(methods, settings.defaultPhoneRegion);
}

/**
 * Re-read and revalidate a selected method immediately before external launch.
 * A missing return value means the sheet/card must refresh and nothing opens.
 */
export async function revalidateContactNowTarget(
  db: PeopleOsDatabase,
  personId: string,
  selectedTarget: ContactNowTarget
): Promise<ContactNowTarget | undefined> {
  const projection = await getContactNowProjection(db, personId);
  return projection.targets.find((target) =>
    target.id === selectedTarget.id
    && target.contactMethodId === selectedTarget.contactMethodId
    && target.channel === selectedTarget.channel
    && target.canonicalValue === selectedTarget.canonicalValue
  );
}
