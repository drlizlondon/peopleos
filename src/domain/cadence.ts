import type { ContactCadence, ContactCadenceUnit, Person } from "./schema";

export const MAX_CONTACT_CADENCE_DAYS = 3_650;

export const CONTACT_CADENCE_UNITS = ["days", "weeks", "months"] as const satisfies readonly ContactCadenceUnit[];

const UNIT_DAYS: Readonly<Record<ContactCadenceUnit, number>> = {
  days: 1,
  weeks: 7,
  months: 30
};

export function isContactCadenceUnit(value: unknown): value is ContactCadenceUnit {
  return typeof value === "string" && CONTACT_CADENCE_UNITS.includes(value as ContactCadenceUnit);
}

export function maxContactCadenceValue(unit: ContactCadenceUnit): number {
  return Math.floor(MAX_CONTACT_CADENCE_DAYS / UNIT_DAYS[unit]);
}

export function contactCadenceInDays(cadence: ContactCadence): number {
  if (!Number.isInteger(cadence.value) || cadence.value < 1 || !isContactCadenceUnit(cadence.unit)) {
    throw new RangeError("Contact cadence requires a positive whole number and a supported unit.");
  }
  const days = cadence.value * UNIT_DAYS[cadence.unit];
  if (days > MAX_CONTACT_CADENCE_DAYS) {
    throw new RangeError(`Contact cadence cannot exceed ${MAX_CONTACT_CADENCE_DAYS} days.`);
  }
  return days;
}

export function isValidContactCadence(value: unknown): value is ContactCadence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<ContactCadence>;
  if (!Number.isInteger(candidate.value) || Number(candidate.value) < 1 || !isContactCadenceUnit(candidate.unit)) return false;
  try {
    contactCadenceInDays(candidate as ContactCadence);
    return true;
  } catch {
    return false;
  }
}

export function contactCadenceOf(
  person: Pick<Person, "contactCadence" | "contactCadenceDays">
): ContactCadence | undefined {
  if (person.contactCadence !== undefined) return person.contactCadence;
  return person.contactCadenceDays === undefined
    ? undefined
    : { value: person.contactCadenceDays, unit: "days" };
}

export function contactCadencesEqual(
  left: ContactCadence | undefined,
  right: ContactCadence | undefined
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.value === right.value && left.unit === right.unit;
}

export function formatContactCadence(cadence: ContactCadence): string {
  const unit = cadence.value === 1 ? cadence.unit.slice(0, -1) : cadence.unit;
  return `${cadence.value} ${unit}`;
}
