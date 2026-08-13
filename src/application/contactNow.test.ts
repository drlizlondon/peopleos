import { afterEach, describe, expect, it } from "vitest";
import {
  deletePeopleOsDatabase,
  openPeopleOsDatabase,
  type PeopleOsDatabase
} from "../data/database";
import type { ContactMethod, Person } from "../domain/schema";
import {
  contactNowTargetHref,
  getContactNowProjection,
  revalidateContactNowTarget,
  resolveContactNowTargets,
  whatsappTargetHref
} from "./contactNow";

const now = "2026-08-14T12:00:00.000Z";
const databaseNames: string[] = [];

const person: Person = {
  id: "person-sarah",
  revision: 1,
  displayName: "Sarah Ahmed",
  identityStatus: "confirmed",
  importance: "normal",
  tags: [],
  createdAt: now,
  updatedAt: now
};

function method(input: Partial<ContactMethod> & Pick<ContactMethod, "id" | "kind">): ContactMethod {
  const common = {
    id: input.id,
    revision: 1,
    personId: person.id,
    label: input.label,
    isPreferred: input.isPreferred ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...(input.archivedAt ? { archivedAt: input.archivedAt } : {})
  };
  return input.kind === "phone" ? {
    ...common,
    kind: "phone",
    rawValue: input.rawValue ?? "020 7946 0018",
    canonicalValue: input.canonicalValue ?? "+442079460018",
    region: "GB"
  } : {
    ...common,
    kind: "email",
    rawValue: input.rawValue ?? "Sarah@Example.com",
    canonicalValue: input.canonicalValue ?? "sarah@example.com"
  };
}

async function openDatabase(): Promise<PeopleOsDatabase> {
  const name = `peopleos-v110-contact-${crypto.randomUUID()}`;
  databaseNames.push(name);
  const db = await openPeopleOsDatabase(name, now);
  await db.put("people", person);
  return db;
}

afterEach(async () => {
  for (const name of databaseNames.splice(0)) await deletePeopleOsDatabase(name);
});

describe("V1-10 Contact now target projection", () => {
  it("filters unusable methods and orders labelled targets preferred-first, then createdAt and ID", () => {
    const records = [
      method({ id: "phone-other", kind: "phone", label: "Work mobile", createdAt: "2026-01-01T10:00:00.000Z" }),
      method({ id: "email-preferred", kind: "email", label: "NHS email", isPreferred: true, createdAt: "2026-01-02T10:00:00.000Z" }),
      method({ id: "phone-preferred", kind: "phone", label: "Mobile", isPreferred: true, createdAt: "2026-01-03T10:00:00.000Z" }),
      method({ id: "archived", kind: "email", archivedAt: now }),
      method({ id: "invalid", kind: "phone", canonicalValue: "+44123", rawValue: "123" })
    ];
    const projection = resolveContactNowTargets([...records].reverse(), "GB");
    expect(projection.hasActivePhone).toBe(true);
    expect(projection.targets.map((target) => target.id)).toEqual([
      "email:email-preferred",
      "phone_call:phone-preferred",
      "phone_call:phone-other"
    ]);
    expect(projection.targets[0]).toMatchObject({
      channel: "email",
      label: "NHS email",
      familiarValue: "Sarah@Example.com",
      canonicalValue: "sarah@example.com",
      isPreferred: true
    });
    expect(projection.targets[1]).toMatchObject({
      channel: "phone_call",
      label: "Mobile",
      familiarValue: "020 7946 0018",
      isPreferred: true
    });
  });

  it("uses kind fallbacks without inventing personal/work context and builds canonical handoff URIs", () => {
    const phone = resolveContactNowTargets([method({ id: "phone", kind: "phone" })], "GB").targets[0];
    const email = resolveContactNowTargets([method({ id: "email", kind: "email" })], "GB").targets[0];
    expect(phone.label).toBe("Phone");
    expect(email.label).toBe("Email");
    expect(contactNowTargetHref(phone)).toBe("tel:+442079460018");
    expect(contactNowTargetHref(email)).toBe("mailto:sarah@example.com");
    expect(contactNowTargetHref(email, "Hello Sarah & welcome")).toBe(
      "mailto:sarah@example.com?body=Hello%20Sarah%20%26%20welcome"
    );
    expect(contactNowTargetHref(email, "   ")).toBe("mailto:sarah@example.com");
    expect(whatsappTargetHref(phone, "Hello Sarah & welcome")).toBe("https://wa.me/442079460018?text=Hello%20Sarah%20%26%20welcome");
    expect(whatsappTargetHref(phone, "   ")).toBe("https://wa.me/442079460018");
    expect(() => whatsappTargetHref(email, "Hello Sarah")).toThrow("WhatsApp requires a phone number.");
    expect(contactNowTargetHref({
      ...email,
      familiarValue: "sarah+intro?private@example.com",
      canonicalValue: "sarah+intro?private@example.com"
    })).toBe("mailto:sarah%2Bintro%3Fprivate@example.com");
  });

  it("re-reads ownership and active state immediately before a target is launched", async () => {
    const db = await openDatabase();
    const phone = method({ id: "phone", kind: "phone", isPreferred: true });
    await db.put("contactMethods", phone);
    const initial = await getContactNowProjection(db, person.id);
    expect(initial.targets.map((target) => target.id)).toEqual(["phone_call:phone"]);
    await db.put("contactMethods", { ...phone, revision: 2, archivedAt: now, updatedAt: now });
    await expect(revalidateContactNowTarget(db, person.id, initial.targets[0])).resolves.toBeUndefined();
    db.close();
  });

  it("rejects a selected destination that changes under the same ContactMethod ID", async () => {
    const db = await openDatabase();
    const phone = method({ id: "phone", kind: "phone", isPreferred: true });
    await db.put("contactMethods", phone);
    const selected = (await getContactNowProjection(db, person.id)).targets[0];
    await db.put("contactMethods", {
      ...phone,
      revision: 2,
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      updatedAt: "2026-08-14T12:01:00.000Z"
    });
    await expect(revalidateContactNowTarget(db, person.id, selected)).resolves.toBeUndefined();
    db.close();
  });

  it("returns no executable target for an archived Person", async () => {
    const db = await openDatabase();
    await db.put("contactMethods", method({ id: "email", kind: "email" }));
    await db.put("people", { ...person, revision: 2, archivedAt: now, updatedAt: now });
    await expect(getContactNowProjection(db, person.id)).resolves.toEqual({
      targets: [],
      hasActivePhone: false
    });
    db.close();
  });
});
