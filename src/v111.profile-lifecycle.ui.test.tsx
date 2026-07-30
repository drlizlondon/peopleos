import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as personLifecycle from "./application/personLifecycle";
import * as peopleQueries from "./application/peopleQueries";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import {
  DATABASE_NAME,
  type ContactMethod,
  type FollowUp,
  type Interaction,
  type MemoryFact,
  type OrganisationAffiliation,
  type Person,
  type ReachOutEntry
} from "./domain/schema";

const now = "2026-07-23T12:00:00.000Z";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: ["fellowship"],
    createdAt: "2022-01-01T12:00:00.000Z",
    updatedAt: "2022-01-01T12:00:00.000Z",
    ...overrides
  };
}

async function seedPerson(record = person()): Promise<Person> {
  await createRepositories(await getDatabase()).people.create(record);
  return record;
}

async function seedCompleteProfile() {
  const savedPerson = await seedPerson();
  const repositories = createRepositories(await getDatabase());
  const contactMethods: ContactMethod[] = [
    {
      id: "phone-personal",
      revision: 1,
      personId: savedPerson.id,
      kind: "phone",
      label: "Personal mobile",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: "2023-01-01T12:00:00.000Z",
      updatedAt: "2023-01-01T12:00:00.000Z"
    },
    {
      id: "phone-work",
      revision: 1,
      personId: savedPerson.id,
      kind: "phone",
      label: "Work mobile",
      rawValue: "07911 123456",
      canonicalValue: "+447911123456",
      region: "GB",
      isPreferred: false,
      createdAt: "2023-02-01T12:00:00.000Z",
      updatedAt: "2023-02-01T12:00:00.000Z"
    },
    {
      id: "email-personal",
      revision: 1,
      personId: savedPerson.id,
      kind: "email",
      label: "Personal email",
      rawValue: "sarah@personal.example",
      canonicalValue: "sarah@personal.example",
      isPreferred: true,
      createdAt: "2023-03-01T12:00:00.000Z",
      updatedAt: "2023-03-01T12:00:00.000Z"
    },
    {
      id: "email-work",
      revision: 1,
      personId: savedPerson.id,
      kind: "email",
      label: "NHS email",
      rawValue: "sarah@nhs.example",
      canonicalValue: "sarah@nhs.example",
      isPreferred: false,
      createdAt: "2023-04-01T12:00:00.000Z",
      updatedAt: "2023-04-01T12:00:00.000Z"
    }
  ];
  for (const contactMethod of contactMethods) await repositories.contactMethods.create(contactMethod);

  const affiliation: OrganisationAffiliation = {
    id: "affiliation-current",
    revision: 1,
    personId: savedPerson.id,
    organisationName: "NHS England",
    role: "Clinical fellow",
    isCurrent: true,
    createdAt: "2023-05-01T12:00:00.000Z",
    updatedAt: "2023-05-01T12:00:00.000Z"
  };
  await repositories.affiliations.create(affiliation);

  const interactions: Interaction[] = Array.from({ length: 6 }, (_, index) => ({
    id: `interaction-${index + 1}`,
    revision: 1,
    personId: savedPerson.id,
    kind: index % 2 === 0 ? "meeting" : "email",
    occurredAt: `202${index + 1}-06-01T12:00:00.000Z`,
    summary: `Conversation ${index + 1}`,
    createdAt: `202${index + 1}-06-01T12:00:00.000Z`,
    updatedAt: `202${index + 1}-06-01T12:00:00.000Z`
  }));
  for (const interaction of interactions) await repositories.interactions.create(interaction);

  const facts: MemoryFact[] = [
    ["fact-seeking", "seeking", "Looking for pilot sites", true],
    ["fact-interest", "interest", "Interested in simulation", false],
    ["fact-location", "location", "Based in Bristol", false],
    ["fact-family", "family", "Has three children", false],
    ["fact-other", "other", "Met through the fellowship", false]
  ].map(([id, kind, value, showAsMemoryCue], index) => ({
    id: String(id),
    revision: 1,
    personId: savedPerson.id,
    kind: kind as MemoryFact["kind"],
    value: String(value),
    showAsMemoryCue: Boolean(showAsMemoryCue),
    createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
  }));
  for (const fact of facts) await repositories.memoryFacts.create(fact);

  const followUp: FollowUp = {
    id: "follow-up-pilot",
    revision: 1,
    personId: savedPerson.id,
    dueDate: "2026-07-23",
    reason: "Send the pilot update",
    actionType: "send_update",
    status: "pending",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z"
  };
  await repositories.followUps.create(followUp);

  const reachOut: ReachOutEntry = {
    id: "reach-out-sarah",
    revision: 1,
    personId: savedPerson.id,
    reason: "Reconnect after the fellowship",
    intendedActionType: "message",
    intentStatus: "active",
    contextIds: [],
    addedAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z"
  };
  await repositories.reachOutEntries.create(reachOut);
  return { savedPerson, contactMethods, affiliation, interactions, facts, followUp, reachOut };
}

function headingOrder(main: HTMLElement, names: string[]): number[] {
  const headings = within(main).getAllByRole("heading").map((heading) => heading.textContent ?? "");
  return names.map((name) => headings.indexOf(name));
}

function sortedById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => left.id.localeCompare(right.id, "en-US"));
}

async function chooseProfileAction(
  user: ReturnType<typeof userEvent.setup>,
  action: "Edit person" | "Relationship settings" | "Archive person",
  personName = "Sarah Jones"
) {
  const actions = await screen.findByRole("group", { name: "Person actions" });
  const opener = actions.querySelector("summary");
  expect(opener).toHaveAttribute("aria-label", `More actions for ${personName}`);
  await user.click(opener!);
  await user.click(screen.getByRole("menuitem", { name: action }));
}

describe("V1-11 complete Profile and Person lifecycle UI", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await resetDatabase();
  });

  it("loads a direct Profile route with the specified section hierarchy and preferred-only contact summary", async () => {
    const seeded = await seedCompleteProfile();
    await createRepositories(await getDatabase()).followUps.create({
      ...seeded.followUp,
      id: "follow-up-additional",
      reason: "Share the second update",
      createdAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z"
    });
    window.history.replaceState({}, "", "/people/person-sarah");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    await screen.findByRole("heading", { name: "Keep in touch" });
    await screen.findByText("Looking for pilot sites");
    const orderedSections = [
      "Relationship summary",
      "Keep in touch",
      "Reach Out",
      "Memory",
      "Recent timeline",
      "Contact details",
      "Affiliation"
    ];
    const positions = headingOrder(main, orderedSections);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(screen.queryByRole("heading", { name: "Current plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Why now")).not.toBeInTheDocument();

    const personActions = screen.getByRole("group", { name: "Person actions" });
    expect(within(personActions).getByRole("button", { name: "Contact now" })).toHaveTextContent("Contact");
    expect(within(personActions).getByRole("button", { name: "Log interaction" })).toHaveTextContent("Log");
    expect(personActions.querySelector("summary")).toHaveAttribute("aria-label", "More actions for Sarah Jones");
    expect(within(personActions).queryByRole("button", { name: "Plan follow-up" })).not.toBeInTheDocument();
    expect(within(personActions).queryByRole("button", { name: "Add memory" })).not.toBeInTheDocument();

    const header = screen.getByRole("heading", { name: "Sarah Jones" }).closest("header")!;
    expect(within(header).getByText(/Personal mobile: (?:07900|\+44 7900) 123456/)).toBeInTheDocument();
    expect(within(header).getByText(/Personal email: sarah@personal\.example/)).toBeInTheDocument();
    expect(within(header).queryByText(/07911 123456/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/sarah@nhs\.example/)).not.toBeInTheDocument();

    const contacts = screen.getByRole("heading", { name: "Contact details" }).closest("section")!;
    expect(within(contacts).getByText(/^(?:07900|\+44 7900) 123456$/)).toBeInTheDocument();
    expect(within(contacts).getByText("sarah@personal.example")).toBeInTheDocument();
    expect(within(contacts).queryByText("07911 123456")).not.toBeInTheDocument();
    expect(within(contacts).queryByText("sarah@nhs.example")).not.toBeInTheDocument();
    const relationshipSummary = screen.getByRole("heading", { name: "Relationship summary" }).closest("section")!;
    expect(within(relationshipSummary).getByText("Appears in").parentElement).toHaveTextContent("Personal");
    expect(within(relationshipSummary).getByText("Last logged interaction")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Memory" }).closest("section")!).getAllByRole("term")).toHaveLength(3);
    expect(within(screen.getByRole("heading", { name: "Recent timeline" }).closest("section")!).getAllByRole("listitem")).toHaveLength(5);
    expect((await readAllData(await getDatabase())).followUps).toHaveLength(2);
  });

  it("recovers from an initial Profile identity read failure without a page reload", async () => {
    const original = await seedPerson();
    const realGetPersonSummary = peopleQueries.getPersonSummary;
    vi.spyOn(peopleQueries, "getPersonSummary")
      .mockRejectedValueOnce(new Error("read failed"))
      .mockImplementation(realGetPersonSummary);
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PeopleOS could not load this person.");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
  });

  it("keeps identity details separate from relationship settings without changing stable identity", async () => {
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);
    await chooseProfileAction(user, "Edit person");

    expect(await screen.findByRole("heading", { name: "Edit person" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Professional" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Remind me to stay in touch" })).not.toBeInTheDocument();
    const name = screen.getByLabelText(/Display name/);
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a name or description so you can recognise this person.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toBeRequired();
    await waitFor(() => expect(name).toHaveFocus());

    await user.type(name, "Sarah Ahmed");
    await user.selectOptions(screen.getByLabelText("Importance"), "high");
    await user.clear(screen.getByLabelText(/Tags/));
    await user.type(screen.getByLabelText(/Tags/), "mentor, NHS");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "Sarah Ahmed" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/people/${original.id}`);
    await chooseProfileAction(user, "Relationship settings", "Sarah Ahmed");
    expect(await screen.findByRole("heading", { name: "Relationship settings" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Display name/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Professional" }));
    await user.click(screen.getByRole("checkbox", { name: "Remind me to stay in touch" }));
    await user.selectOptions(screen.getByLabelText("How often?"), "custom");
    const cadence = screen.getByLabelText("Days between reminders");
    await user.type(cadence, "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a whole number from 1 to 3650 days");
    expect(cadence).toHaveValue(0);
    await user.selectOptions(screen.getByLabelText("How often?"), "90");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Sarah Ahmed" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/people/${original.id}`);
    const saved = await (await getDatabase()).get("people", original.id);
    expect(saved).toMatchObject({
      id: original.id,
      revision: 4,
      createdAt: original.createdAt,
      displayName: "Sarah Ahmed",
      relationshipMode: "both",
      importance: "high",
      tags: ["mentor", "NHS"],
      contactCadenceDays: 90
    });
  });

  it("uses every active contact method for Profile Contact now while keeping only preferred values prominent", async () => {
    await seedCompleteProfile();
    window.history.replaceState({}, "", "/people/person-sarah");
    const user = userEvent.setup();
    render(<App />);

    const contactNow = await screen.findByRole("button", { name: "Contact now" });
    await user.click(contactNow);

    const dialog = await screen.findByRole("dialog", { name: "Contact Sarah Jones" });
    const methods = within(dialog).getByRole("list", { name: "Contact methods" });
    expect(within(methods).getByRole("button", { name: /Call · Personal mobile/ })).toBeInTheDocument();
    expect(within(methods).getByRole("button", { name: /Call · Work mobile/ })).toBeInTheDocument();
    expect(within(methods).getByRole("button", { name: /Email · Personal email/ })).toBeInTheDocument();
    expect(within(methods).getByRole("button", { name: /Email · NHS email/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(contactNow).toHaveFocus());
  });

  it("takes a no-contact Profile directly to Contact Methods without creating a draft row", async () => {
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);

    const personActions = await screen.findByRole("group", { name: "Person actions" });
    await user.click(within(personActions).getByRole("button", { name: "Add contact details" }));

    await waitFor(() => expect(window.location.pathname).toBe(`/people/${original.id}/contact-methods`));
    expect(await screen.findByRole("button", { name: "Add email" })).toBeInTheDocument();
    expect(screen.getByText("Add a phone number or email when you have one.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add contact detail" })).not.toBeInTheDocument();
    expect((await readAllData(await getDatabase())).contactMethods).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "← Person" }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/people/${original.id}`);
  });

  it("does not promote an invalid stored contact method as an actionable Profile contact", async () => {
    const original = await seedPerson();
    await (await getDatabase()).put("contactMethods", {
      id: "invalid-imported-email",
      revision: 1,
      personId: original.id,
      kind: "email",
      label: "Old email",
      rawValue: "not-an-email",
      canonicalValue: "not-an-email",
      isPreferred: true,
      createdAt: now,
      updatedAt: now
    });
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);

    const personActions = await screen.findByRole("group", { name: "Person actions" });
    expect(within(personActions).getByRole("button", { name: "Add contact details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sarah Jones" }).closest("header")).not.toHaveTextContent("not-an-email");

    await user.click(within(personActions).getByRole("button", { name: "Add contact details" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/people/${original.id}/contact-methods`));
    expect(await screen.findByText("not-an-email")).toBeInTheDocument();
  });

  it("cancels without persisting and retains an edit draft after a stale revision", async () => {
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<App />);
    await chooseProfileAction(user, "Edit person");
    const name = await screen.findByLabelText(/Display name/);
    await user.clear(name);
    await user.type(name, "Unsaved Sarah");
    await waitFor(() => expect(name).toHaveValue("Unsaved Sarah"));

    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Edit person" })).toBeInTheDocument();
    expect(name).toHaveValue("Unsaved Sarah");
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(await (await getDatabase()).get("people", original.id)).toEqual({ ...original, relationshipMode: "personal" });

    await chooseProfileAction(user, "Edit person");
    const staleDraft = await screen.findByLabelText(/Display name/);
    const db = await getDatabase();
    await createRepositories(db).people.update({ ...original, displayName: "Changed elsewhere" }, 1, "2026-07-23T12:01:00.000Z");
    await user.clear(staleDraft);
    await user.type(staleDraft, "My retained draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This changed elsewhere—reload and try again.");
    expect(staleDraft).toHaveValue("My retained draft");
    expect((await db.get("people", original.id))?.displayName).toBe("Changed elsewhere");
  });

  it("archives only the Person, makes the Profile read-only, and restores every child unchanged", async () => {
    const seeded = await seedCompleteProfile();
    window.history.replaceState({}, "", `/people/${seeded.savedPerson.id}`);
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<App />);
    await chooseProfileAction(user, "Edit person");
    const draftName = await screen.findByLabelText(/Display name/);
    await user.clear(draftName);
    await user.type(draftName, "Unsaved archived name");

    confirm.mockReturnValueOnce(false);
    await user.click(await screen.findByRole("button", { name: "Archive person" }));
    expect((await (await getDatabase()).get("people", seeded.savedPerson.id))?.archivedAt).toBeUndefined();
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("discard your unsaved edits"));
    expect(draftName).toHaveValue("Unsaved archived name");
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Archive person" }));

    expect(await screen.findByRole("heading", { name: "Archived person" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Person actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add another" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit interaction" })).not.toBeInTheDocument();

    const archivedData = await readAllData(await getDatabase());
    expect(archivedData.people[0]?.archivedAt).toBe(now);
    expect(sortedById(archivedData.contactMethods)).toEqual(sortedById(seeded.contactMethods));
    expect(archivedData.affiliations).toEqual([seeded.affiliation]);
    expect(sortedById(archivedData.interactions)).toEqual(sortedById(seeded.interactions));
    expect(sortedById(archivedData.memoryFacts)).toEqual(sortedById(seeded.facts));
    expect(archivedData.followUps).toEqual([seeded.followUp]);
    expect(archivedData.reachOutEntries).toEqual([seeded.reachOut]);

    await user.click(screen.getByRole("button", { name: "Archived details" }));
    expect(await screen.findByRole("heading", { name: "Archived person" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage contact methods" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore person" }));

    expect(await screen.findByRole("group", { name: "Person actions" })).toBeInTheDocument();
    const restoredData = await readAllData(await getDatabase());
    expect(restoredData.people[0]).toMatchObject({ id: seeded.savedPerson.id, revision: 3 });
    expect(restoredData.people[0]?.archivedAt).toBeUndefined();
    expect(sortedById(restoredData.contactMethods)).toEqual(sortedById(seeded.contactMethods));
    expect(restoredData.affiliations).toEqual([seeded.affiliation]);
    expect(sortedById(restoredData.interactions)).toEqual(sortedById(seeded.interactions));
    expect(sortedById(restoredData.memoryFacts)).toEqual(sortedById(seeded.facts));
    expect(restoredData.followUps).toEqual([seeded.followUp]);
    expect(restoredData.reachOutEntries).toEqual([seeded.reachOut]);
  });

  it("reuses archive and Profile-restore timestamps after an uncertain response", async () => {
    const original = await seedPerson();
    const realArchive = personLifecycle.archivePerson;
    const archiveSpy = vi.spyOn(personLifecycle, "archivePerson")
      .mockImplementationOnce(async (...args) => {
        await realArchive(...args);
        throw new Error("response lost");
      })
      .mockImplementation(realArchive);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);

    await chooseProfileAction(user, "Edit person");
    await user.click(await screen.findByRole("button", { name: "Archive person" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not save these changes");
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
    await user.click(screen.getByRole("button", { name: "Archive person" }));
    expect(await screen.findByRole("heading", { name: "Archived person" })).toBeInTheDocument();
    expect(archiveSpy.mock.calls[0]?.[1].occurredAt).toBe(archiveSpy.mock.calls[1]?.[1].occurredAt);

    archiveSpy.mockRestore();
    const realRestore = personLifecycle.restorePerson;
    const restoreSpy = vi.spyOn(personLifecycle, "restorePerson")
      .mockImplementationOnce(async (...args) => {
        await realRestore(...args);
        throw new Error("response lost");
      })
      .mockImplementation(realRestore);
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not save this yet");
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    expect(await screen.findByRole("group", { name: "Person actions" })).toBeInTheDocument();
    expect(restoreSpy.mock.calls[0]?.[1].occurredAt).toBe(restoreSpy.mock.calls[1]?.[1].occurredAt);
  });

  it("loads the Edit Person route directly and keeps an archived Person read-only", async () => {
    const archived = await seedPerson(person({ archivedAt: "2026-07-20T12:00:00.000Z" }));
    window.history.replaceState({ fromPath: "/people" }, "", `/people/${archived.id}/edit`);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Archived person" })).toBeInTheDocument();
    expect(screen.getByText(archived.displayName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore person" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive person" })).not.toBeInTheDocument();
  });

  it("completes a standalone provisional Person through the shared identity flow", async () => {
    const provisional = await seedPerson(person({
      displayName: "Chief Information Officer at Watford",
      identityStatus: "provisional"
    }));
    window.history.replaceState({ fromPath: "/people" }, "", `/people/${provisional.id}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Complete identity" }));
    expect(window.location.pathname).toBe(`/people/${provisional.id}/resolve`);
    const confirmedName = await screen.findByLabelText(/Confirmed display name/);
    await user.clear(confirmedName);
    await user.type(confirmedName, "Sarah Williams");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    expect(await screen.findByRole("heading", { name: "Sarah Williams" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/people/${provisional.id}`);
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ id: provisional.id, identityStatus: "confirmed", displayName: "Sarah Williams" });
  });

  it("returns a directly opened standalone resolver to its Person and then People", async () => {
    const provisional = await seedPerson(person({
      displayName: "Simon from the digital team",
      identityStatus: "provisional"
    }));
    window.history.replaceState({}, "", `/people/${provisional.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Complete identity" });
    await user.click(screen.getByRole("button", { name: "← Person" }));
    expect(await screen.findByRole("heading", { name: "Simon from the digital team" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
  });

  it("cancels a directly opened Reach Out resolver through Detail without inventing a history origin", async () => {
    const provisional = await seedPerson(person({
      displayName: "Hackathon organiser",
      identityStatus: "provisional"
    }));
    const entry: ReachOutEntry = {
      id: "reach-out-direct-cancel",
      revision: 1,
      personId: provisional.id,
      reason: "Reconnect after the hackathon",
      intendedActionType: "message",
      intentStatus: "active",
      contextIds: [],
      addedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await createRepositories(await getDatabase()).reachOutEntries.create(entry);
    window.history.replaceState({}, "", `/reach-out/${entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Complete identity" });
    await user.click(screen.getByRole("button", { name: "← Reach Out plan" }));
    expect(await screen.findByRole("heading", { name: "Outreach plan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Reach Out" }));
    await waitFor(() => expect(window.location.pathname).toBe("/reach-out"));
  });

  it("completes a directly opened Reach Out resolver through Detail without creating a loop", async () => {
    const provisional = await seedPerson(person({
      displayName: "Fellowship contact",
      identityStatus: "provisional"
    }));
    const entry: ReachOutEntry = {
      id: "reach-out-direct-complete",
      revision: 1,
      personId: provisional.id,
      reason: "Reconnect after the fellowship",
      intendedActionType: "message",
      intentStatus: "active",
      contextIds: [],
      addedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await createRepositories(await getDatabase()).reachOutEntries.create(entry);
    window.history.replaceState({}, "", `/reach-out/${entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);

    const confirmedName = await screen.findByLabelText(/Confirmed display name/);
    await user.clear(confirmedName);
    await user.type(confirmedName, "Alex Morgan");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    expect(await screen.findByRole("heading", { name: "Alex Morgan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back to Reach Out plan" }));
    expect(await screen.findByRole("heading", { name: "Outreach plan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Reach Out" }));
    await waitFor(() => expect(window.location.pathname).toBe("/reach-out"));
  });

  it("returns from a Person opened through Reach Out Detail to the existing plan entry", async () => {
    const seeded = await seedCompleteProfile();
    window.history.replaceState({ fromPath: "/reach-out" }, "", `/reach-out/${seeded.reachOut.id}`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Outreach plan" });
    await user.click(screen.getByRole("button", { name: "Open Person" }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back to Reach Out plan" }));

    await waitFor(() => expect(window.location.pathname).toBe(`/reach-out/${seeded.reachOut.id}`));
    expect(await screen.findByRole("heading", { name: "Outreach plan" })).toBeInTheDocument();
  });

  it("preserves the Reach Out stack while completing identity from Profile", async () => {
    const provisional = await seedPerson(person({
      displayName: "Hackathon organiser",
      identityStatus: "provisional"
    }));
    const reachOut: ReachOutEntry = {
      id: "reach-out-provisional-stack",
      revision: 1,
      personId: provisional.id,
      reason: "Reconnect after the hackathon",
      intendedActionType: "message",
      intentStatus: "active",
      contextIds: [],
      addedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await createRepositories(await getDatabase()).reachOutEntries.create(reachOut);
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open plan" }));
    await user.click(await screen.findByRole("button", { name: "Open Person" }));
    await user.click(await screen.findByRole("button", { name: "Complete identity" }));
    const confirmedName = await screen.findByLabelText(/Confirmed display name/);
    await user.clear(confirmedName);
    await user.type(confirmedName, "Alex Morgan");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    expect(await screen.findByRole("heading", { name: "Alex Morgan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Back to Reach Out plan" }));
    expect(await screen.findByRole("heading", { name: "Outreach plan" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Reach Out" }));
    await waitFor(() => expect(window.location.pathname).toBe("/reach-out"));
    expect(await screen.findByRole("button", { name: "Alex Morgan" })).toBeInTheDocument();
  });

  it("restores Upcoming filters and scroll after opening a Person", async () => {
    const savedPerson = await seedPerson();
    const future: FollowUp = {
      id: "follow-up-future",
      revision: 1,
      personId: savedPerson.id,
      dueDate: "2026-08-10",
      reason: "Arrange a future coffee",
      actionType: "arrange_meeting",
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    await createRepositories(await getDatabase()).followUps.create(future);
    window.history.replaceState({}, "", "/upcoming");
    const scrollTo = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Arrange a future coffee" });
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter follow-ups" });
    await user.selectOptions(within(dialog).getByLabelText("Date window"), "next_30_days");
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));
    expect(await screen.findByRole("button", { name: "Filter · 1" })).toBeInTheDocument();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 190 });
    await user.click(screen.getByRole("button", { name: "Sarah Jones" }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await user.click(screen.getByRole("button", { name: "← Upcoming" }));

    await waitFor(() => expect(window.location.pathname).toBe("/upcoming"));
    expect(await screen.findByRole("button", { name: "Filter · 1" })).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 190, behavior: "instant" }));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });
});
