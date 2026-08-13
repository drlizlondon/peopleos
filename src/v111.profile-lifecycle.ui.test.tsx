import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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
    relationshipMode: "personal",
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
  const savedPerson = await seedPerson(person({ contactCadence: { value: 2, unit: "weeks" } }));
  const repositories = createRepositories(await getDatabase());
  const contact: ContactMethod = {
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
  };
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
  const note: Interaction = {
    id: "interaction-note",
    revision: 1,
    personId: savedPerson.id,
    kind: "note_added",
    occurredAt: "2026-01-01T12:00:00.000Z",
    summary: "Ask about the fellowship",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z"
  };
  const fact: MemoryFact = {
    id: "fact-seeking",
    revision: 1,
    personId: savedPerson.id,
    kind: "seeking",
    value: "Looking for pilot sites",
    showAsMemoryCue: true,
    createdAt: "2026-01-02T12:00:00.000Z",
    updatedAt: "2026-01-02T12:00:00.000Z"
  };
  const followUp: FollowUp = {
    id: "follow-up-pilot",
    revision: 1,
    personId: savedPerson.id,
    dueDate: "2026-08-10",
    reason: "Send the pilot update",
    actionType: "send_update",
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  const reachOut: ReachOutEntry = {
    id: "reach-out-sarah",
    revision: 1,
    personId: savedPerson.id,
    reason: "Reconnect after the fellowship",
    intendedActionType: "message",
    intentStatus: "active",
    contextIds: [],
    addedAt: now,
    createdAt: now,
    updatedAt: now
  };
  await repositories.contactMethods.create(contact);
  await repositories.affiliations.create(affiliation);
  await repositories.interactions.create(note);
  await repositories.memoryFacts.create(fact);
  await repositories.followUps.create(followUp);
  await repositories.reachOutEntries.create(reachOut);
  return { savedPerson, contact, affiliation, note, fact, followUp, reachOut };
}

describe("simple Profile and Person lifecycle UI", () => {
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

  it("loads a direct Profile route with preferred contact, frequency, next date and Notes only", async () => {
    await seedCompleteProfile();
    window.history.replaceState({}, "", "/people/person-sarah");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    const details = screen.getByRole("region", { name: "Person details" });
    expect(within(details).getByText(/07900|\+44 7900/)).toBeInTheDocument();
    expect(within(details).getByText("2 weeks")).toBeInTheDocument();
    expect(within(details).getByText(/Aug 10, 2026/)).toBeInTheDocument();
    expect(await screen.findByText("Ask about the fellowship")).toBeInTheDocument();
    expect(screen.queryByText("Looking for pilot sites")).not.toBeInTheDocument();
    expect(screen.queryByText("Send the pilot update")).not.toBeInTheDocument();
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

  it("edits name, relationship and frequency while preserving hidden stored preferences", async () => {
    const original = await seedPerson(person({ importance: "high", tags: ["mentor"] }));
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const name = await screen.findByLabelText(/Display name/);
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a name or description");
    await user.type(name, "Sarah Ahmed");
    await user.click(screen.getByRole("button", { name: "Professional" }));
    await user.selectOptions(screen.getByLabelText("How often do you want to contact them?"), "2-weeks");
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "Sarah Ahmed" })).toBeInTheDocument();
    const saved = await (await getDatabase()).get("people", original.id);
    expect(saved).toMatchObject({
      id: original.id,
      displayName: "Sarah Ahmed",
      relationshipMode: "professional",
      importance: "high",
      tags: ["mentor"],
      contactCadence: { value: 2, unit: "weeks" }
    });
    const data = await readAllData(await getDatabase());
    expect(data.followUps).toHaveLength(1);
    expect(data.followUpEvents).toHaveLength(1);
    expect(data.interactions).toHaveLength(0);
  });

  it("takes a no-contact Profile directly to the retained Contact Methods route", async () => {
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add contact details" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/people/${original.id}/contact-methods`));
    expect(await screen.findByRole("button", { name: "Add email" })).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).contactMethods).toHaveLength(0);
  });

  it("protects an unsaved plain note from navigation", async () => {
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Note"), "Ask about the garden");
    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    expect(window.location.pathname).toBe(`/people/${original.id}`);
    expect(screen.getByLabelText("Note")).toHaveValue("Ask about the garden");
  });

  it("keeps the Notes editor scrollable and dismissible when the iPhone keyboard is open", async () => {
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    viewport.height = 400;
    viewport.offsetTop = 0;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const original = await seedPerson();
    window.history.replaceState({}, "", `/people/${original.id}`);
    const view = render(<App />);
    try {
      const note = await screen.findByLabelText("Note");
      const scrollIntoView = vi.fn();
      Object.defineProperty(note, "scrollIntoView", { configurable: true, value: scrollIntoView });
      vi.spyOn(note, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 360,
        top: 360,
        right: 300,
        bottom: 470,
        left: 0,
        width: 300,
        height: 110,
        toJSON: () => ({})
      });
      note.focus();
      viewport.dispatchEvent(new Event("resize"));

      await waitFor(() => {
        expect(document.documentElement).toHaveAttribute("data-keyboard-open", "true");
        expect(scrollIntoView).toHaveBeenCalled();
      });
      expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByRole("button", { name: "Done" })
      );
      expect(note).not.toHaveFocus();
    } finally {
      view.unmount();
      if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });

  it("archives and restores only the Person while every child record remains unchanged", async () => {
    const seeded = await seedCompleteProfile();
    window.history.replaceState({}, "", `/people/${seeded.savedPerson.id}`);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Archive person" }));

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();

    const restored = await readAllData(await getDatabase());
    expect(restored.people[0]).toMatchObject({ id: seeded.savedPerson.id, revision: 3 });
    expect(restored.people[0]?.archivedAt).toBeUndefined();
    expect(restored.contactMethods).toEqual([seeded.contact]);
    expect(restored.affiliations).toEqual([seeded.affiliation]);
    expect(restored.interactions).toEqual([seeded.note]);
    expect(restored.memoryFacts).toEqual([seeded.fact]);
    expect(restored.followUps).toEqual([seeded.followUp]);
    expect(restored.reachOutEntries).toEqual([seeded.reachOut]);
  });

  it("loads the Edit Person route directly and keeps an archived Person read-only", async () => {
    const archived = await seedPerson(person({ archivedAt: "2026-07-20T12:00:00.000Z" }));
    window.history.replaceState({ fromPath: "/people" }, "", `/people/${archived.id}/edit`);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Archived person" })).toBeInTheDocument();
    expect(screen.getByText(archived.displayName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore person" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("preserves People directory search and scroll after opening a Profile", async () => {
    await seedPerson();
    window.history.replaceState({}, "", "/people");
    const scrollTo = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    render(<App />);
    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "Sarah");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 190 });
    await user.click(await screen.findByRole("link", { name: /Sarah Jones/ }));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await user.click(screen.getByRole("button", { name: "← People" }));
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toHaveValue("Sarah");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 190, behavior: "instant" }));
  });
});
