import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getPersonHistory } from "./application/interactionQueries";
import * as interactionQueries from "./application/interactionQueries";
import { createInteraction } from "./application/interactions";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import {
  DATABASE_NAME,
  type OrganisationAffiliation,
  type Person,
  type RelationshipEvent
} from "./domain/schema";

const personCreatedAt = "2026-01-01T09:00:00.000Z";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

function person(id: string, displayName: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: personCreatedAt,
    updatedAt: personCreatedAt,
    ...overrides
  };
}

async function seedPerson(
  id = "person-sarah",
  displayName = "Sarah Jones",
  overrides: Partial<Person> = {}
): Promise<Person> {
  const record = person(id, displayName, overrides);
  await createRepositories(await getDatabase()).people.create(record);
  return record;
}

async function seedEvent(
  id: string,
  name: string,
  occurredOn?: string,
  location?: string
): Promise<RelationshipEvent> {
  const event: RelationshipEvent = {
    id,
    revision: 1,
    name,
    ...(occurredOn ? { occurredOn } : {}),
    ...(location ? { location } : {}),
    createdAt: personCreatedAt,
    updatedAt: personCreatedAt
  };
  await createRepositories(await getDatabase()).events.create(event);
  return event;
}

async function renderProfile(personId = "person-sarah") {
  window.history.replaceState({ fromPath: "/people" }, "", `/people/${personId}`);
  render(<App />);
  await screen.findByRole("heading", { name: "Sarah Jones" });
  await waitFor(() => expect(screen.queryByText("Loading recent history…")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("Loading memory…")).not.toBeInTheDocument());
}

function profileActions(): HTMLElement {
  return screen.getByLabelText("Person actions");
}

function interactionArticle(summary: string): HTMLElement {
  const article = screen.getByText(summary).closest("article");
  expect(article).not.toBeNull();
  return article!;
}

async function openProfileInteraction(user: ReturnType<typeof userEvent.setup>) {
  const opener = within(profileActions()).getByRole("button", { name: "Log interaction" });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Log interaction" });
  await waitFor(() => expect(within(dialog).getByLabelText(/^Interaction type/)).toHaveFocus());
  return {
    opener,
    dialog
  };
}

async function openProfileNote(user: ReturnType<typeof userEvent.setup>) {
  const opener = within(profileActions()).getByRole("button", { name: "Add memory" });
  await user.click(opener);
  const choices = await screen.findByLabelText("Choose memory type");
  await user.click(within(choices).getByRole("button", { name: "Note" }));
  const dialog = await screen.findByRole("dialog", { name: "Add note" });
  return { opener, dialog };
}

async function chooseNewEvent(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  occurredOn = "2026-02-10",
  location = "Bristol"
) {
  await user.click(screen.getByRole("button", { name: "Choose event" }));
  const selector = await screen.findByRole("dialog", { name: "Choose an event" });
  await user.type(within(selector).getByLabelText("Find or create event"), name);
  await user.click(within(selector).getByRole("button", { name: `Create “${name}”` }));
  const details = within(selector).getByLabelText("New event details");
  await waitFor(() => expect(within(details).getByLabelText(/^Event name/)).toHaveFocus());
  await user.type(within(details).getByLabelText(/^Event date/), occurredOn);
  await user.type(within(details).getByLabelText(/^Location/), location);
  await user.click(within(details).getByRole("button", { name: "Use this event" }));
  const editor = await screen.findByRole("dialog", { name: "Log interaction" });
  await waitFor(() => expect(within(editor).getByRole("button", { name: "Change" })).toHaveFocus());
}

describe("V1-05 interactions and timeline UI", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("shows a creation-only Profile and derives Person creation in the full Timeline", async () => {
    await seedPerson();
    const user = userEvent.setup();
    await renderProfile();

    expect(screen.getByText("No meaningful contact recorded")).toBeInTheDocument();
    expect(await screen.findByText("No interactions recorded yet.")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).interactions).toEqual([]);

    await user.click(screen.getByRole("button", { name: "See full timeline" }));

    expect(window.location.pathname).toBe("/people/person-sarah/timeline");
    expect(await screen.findByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No interactions recorded yet." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 5, name: "Person created" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filter timeline" })).toBeInTheDocument();
  });

  it("logs a contact and a note while keeping system-owned kinds out of manual capture", async () => {
    await seedPerson();
    const user = userEvent.setup();
    await renderProfile();

    const { dialog } = await openProfileInteraction(user);
    const kind = within(dialog).getByLabelText(/^Interaction type/);
    await waitFor(() => expect(kind).toHaveFocus());
    const values = within(kind).getAllByRole("option").map((option) => option.getAttribute("value"));
    expect(values).toContain("phone_call");
    expect(values).toContain("introduction_received");
    expect(values).toContain("introduction_made");
    expect(values).not.toContain("contacted");
    expect(values).not.toContain("follow_up_completed");
    expect(values).not.toContain("note_added");

    await user.selectOptions(kind, "phone_call");
    expect(within(dialog).getByText("This will count as meaningful contact.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Summary"), "Discussed NHS AI pilot sites");
    await user.click(within(dialog).getByRole("button", { name: "Save interaction" }));

    expect(await screen.findByRole("heading", { level: 5, name: "Phone call" })).toBeInTheDocument();
    const lastContactRow = screen.getByText("Last meaningful contact").parentElement;
    expect(lastContactRow).not.toHaveTextContent("No meaningful contact recorded");
    const contactBeforeNote = lastContactRow?.textContent;

    const { dialog: noteDialog } = await openProfileNote(user);
    const note = within(noteDialog).getByLabelText("Note");
    await waitFor(() => expect(note).toHaveFocus());
    expect(note).toHaveAttribute("aria-required", "true");
    await user.click(within(noteDialog).getByRole("button", { name: "Save note" }));
    expect(await within(noteDialog).findByRole("alert")).toHaveTextContent("Add a note before saving.");
    await user.type(note, "Interested in simulation training");
    await user.click(within(noteDialog).getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("heading", { level: 5, name: "Note added" })).toBeInTheDocument();
    expect(screen.getByText("Last meaningful contact").parentElement?.textContent).toBe(contactBeforeNote);
    const data = await readAllData(await getDatabase());
    expect(data.interactions.map((record) => record.kind).sort()).toEqual(["note_added", "phone_call"]);
    expect(data.memoryFacts).toEqual([]);
    expect((await getPersonHistory(await getDatabase(), "person-sarah"))?.lastContact?.kind).toBe("phone_call");
  });

  it("requires introduction context and applies the two introduction contact semantics", async () => {
    await seedPerson();
    await seedPerson("person-aaron", "Aaron Patel");
    const user = userEvent.setup();
    await renderProfile();

    let opened = await openProfileInteraction(user);
    let kind = within(opened.dialog).getByLabelText(/^Interaction type/);
    await user.selectOptions(kind, "introduction_made");
    expect(within(opened.dialog).getByText("This adds context but will not count as contact.")).toBeInTheDocument();
    await user.click(within(opened.dialog).getByRole("button", { name: "Save interaction" }));
    expect(await within(opened.dialog).findByRole("alert")).toHaveTextContent("Choose the related person or add their name in the summary.");
    await user.selectOptions(within(opened.dialog).getByLabelText(/^Related person/), "person-aaron");
    await user.click(within(opened.dialog).getByRole("button", { name: "Save interaction" }));

    expect(await screen.findByRole("heading", { level: 5, name: "Introduction made" })).toBeInTheDocument();
    expect(screen.getByText("Last meaningful contact").parentElement).toHaveTextContent("No meaningful contact recorded");

    opened = await openProfileInteraction(user);
    kind = within(opened.dialog).getByLabelText(/^Interaction type/);
    await user.selectOptions(kind, "introduction_received");
    expect(within(opened.dialog).getByText("This will count as meaningful contact.")).toBeInTheDocument();
    await user.type(within(opened.dialog).getByLabelText("Summary"), "James introduced us at the fellowship");
    await user.click(within(opened.dialog).getByRole("button", { name: "Save interaction" }));

    await waitFor(() => expect(screen.getByText("Last meaningful contact").parentElement).not.toHaveTextContent("No meaningful contact recorded"));
    const interactions = (await readAllData(await getDatabase())).interactions;
    expect(interactions.find((record) => record.kind === "introduction_made")?.relatedPersonId).toBe("person-aaron");
    expect((await getPersonHistory(await getDatabase(), "person-sarah"))?.lastContact?.kind).toBe("introduction_received");
  });

  it("selects and creates explicit Events without persisting an unsaved Event on cancel", async () => {
    await seedPerson();
    await seedEvent("event-existing", "AI Fellowship", "2026-02-01", "London");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await renderProfile();

    let opened = await openProfileInteraction(user);
    await user.click(within(opened.dialog).getByRole("button", { name: "Choose event" }));
    const selector = await screen.findByRole("dialog", { name: "Choose an event" });
    await user.click(within(selector).getByRole("button", { name: /AI Fellowship/ }));
    opened.dialog = await screen.findByRole("dialog", { name: "Log interaction" });
    expect(within(opened.dialog).getByText("AI Fellowship")).toBeInTheDocument();
    await waitFor(() => expect(within(opened.dialog).getByRole("button", { name: "Change" })).toHaveFocus());
    await user.click(within(opened.dialog).getByRole("button", { name: "Save interaction" }));
    expect((await readAllData(await getDatabase())).interactions[0]?.eventId).toBe("event-existing");

    opened = await openProfileInteraction(user);
    await chooseNewEvent(user, "HealthTech Summit");
    await user.click(within(await screen.findByRole("dialog", { name: "Log interaction" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log interaction" })).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    expect((await readAllData(await getDatabase())).events.map((event) => event.name)).toEqual(["AI Fellowship"]);

    opened = await openProfileInteraction(user);
    await chooseNewEvent(user, "HealthTech Summit");
    await user.type(within(await screen.findByRole("dialog", { name: "Log interaction" })).getByLabelText("Summary"), "Met the programme team");
    await user.click(screen.getByRole("button", { name: "Save interaction" }));

    const data = await readAllData(await getDatabase());
    expect(data.events.map((event) => event.name).sort()).toEqual(["AI Fellowship", "HealthTech Summit"]);
    const created = data.events.find((event) => event.name === "HealthTech Summit");
    expect(data.interactions.find((record) => record.summary === "Met the programme team")?.eventId).toBe(created?.id);
  });

  it("restores focus across every Event-selector subview transition", async () => {
    await seedPerson();
    const user = userEvent.setup();
    await renderProfile();
    const { dialog } = await openProfileInteraction(user);
    const chooseEvent = within(dialog).getByRole("button", { name: "Choose event" });

    await user.click(chooseEvent);
    const selector = await screen.findByRole("dialog", { name: "Choose an event" });
    const search = within(selector).getByLabelText("Find or create event");
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveAttribute("maxlength", "120");
    await user.type(search, "Fellowship forum");
    await user.click(within(selector).getByRole("button", { name: "Create “Fellowship forum”" }));
    const details = within(selector).getByRole("group", { name: "New event details" });
    await waitFor(() => expect(within(details).getByLabelText(/^Event name/)).toHaveFocus());
    await user.click(within(details).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(selector).getByLabelText("Find or create event")).toHaveFocus());

    window.dispatchEvent(new PopStateEvent("popstate"));
    const returned = await screen.findByRole("dialog", { name: "Log interaction" });
    await waitFor(() => expect(within(returned).getByRole("button", { name: "Choose event" })).toHaveFocus());
  });

  it("offers an Event created concurrently without losing the Interaction draft", async () => {
    await seedPerson();
    const user = userEvent.setup();
    await renderProfile();
    const { dialog } = await openProfileInteraction(user);
    await user.type(within(dialog).getByLabelText("Summary"), "Met the programme director");
    await user.click(within(dialog).getByRole("button", { name: "Choose event" }));
    const selector = await screen.findByRole("dialog", { name: "Choose an event" });

    await seedEvent("event-concurrent", "Clinical AI Forum");
    await user.type(within(selector).getByLabelText("Find or create event"), "Clinical AI Forum");
    await user.click(within(selector).getByRole("button", { name: "Create “Clinical AI Forum”" }));
    await user.click(within(selector).getByRole("button", { name: "Use this event" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Log interaction" })).getByRole("button", { name: "Save interaction" }));

    const recoveredSelector = await screen.findByRole("dialog", { name: "Choose an event" });
    expect(within(recoveredSelector).getByRole("alert")).toHaveTextContent("already exists");
    await user.click(within(recoveredSelector).getByRole("button", { name: /^Clinical AI Forum$/ }));
    const recoveredEditor = await screen.findByRole("dialog", { name: "Log interaction" });
    await waitFor(() => expect(within(recoveredEditor).getByRole("button", { name: "Change" })).toHaveFocus());
    expect(within(recoveredEditor).getByLabelText("Summary")).toHaveValue("Met the programme director");
    await user.click(within(recoveredEditor).getByRole("button", { name: "Save interaction" }));

    expect((await readAllData(await getDatabase())).interactions).toMatchObject([{
      summary: "Met the programme director",
      eventId: "event-concurrent"
    }]);
  });

  it("edits and deletes an interaction with confirmation and recalculates last contact", async () => {
    await seedPerson();
    const db = await getDatabase();
    await createInteraction(db, {
      id: "interaction-phone",
      personId: "person-sarah",
      kind: "phone_call",
      occurredAt: "2026-02-01T09:00:00.000Z",
      summary: "Earlier phone call",
      createdAt: "2026-02-01T09:00:00.000Z",
      origin: "manual"
    }, "2026-03-02T09:00:00.000Z");
    await createInteraction(db, {
      id: "interaction-email",
      personId: "person-sarah",
      kind: "email",
      occurredAt: "2026-03-01T09:00:00.000Z",
      summary: "Newest email",
      createdAt: "2026-03-01T09:00:00.000Z",
      origin: "manual"
    }, "2026-03-02T09:00:00.000Z");
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    await renderProfile();
    const initialLastContact = screen.getByText("Last meaningful contact").parentElement?.textContent;

    await user.click(within(interactionArticle("Newest email")).getByRole("button", { name: "Edit interaction" }));
    let editor = await screen.findByRole("dialog", { name: "Edit interaction" });
    const occurred = within(editor).getByLabelText(/^Date and time/);
    fireEvent.change(occurred, { target: { value: "2026-01-15T09:00" } });
    const summary = within(editor).getByLabelText("Summary");
    await user.clear(summary);
    await user.type(summary, "Edited email");
    expect(summary).toHaveValue("Edited email");
    await user.click(within(editor).getByRole("button", { name: "Save interaction" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit interaction" })).not.toBeInTheDocument());
    expect(await screen.findByText("Edited email")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Last meaningful contact").parentElement?.textContent).not.toBe(initialLastContact));
    expect((await getPersonHistory(db, "person-sarah"))?.lastContact?.id).toBe("interaction-phone");

    await user.click(within(interactionArticle("Edited email")).getByRole("button", { name: "Edit interaction" }));
    editor = await screen.findByRole("dialog", { name: "Edit interaction" });
    confirm.mockReturnValueOnce(false);
    await user.click(within(editor).getByRole("button", { name: "Delete interaction" }));
    expect(screen.getByRole("dialog", { name: "Edit interaction" })).toBeInTheDocument();
    confirm.mockReturnValueOnce(true);
    await user.click(within(editor).getByRole("button", { name: "Delete interaction" }));

    await waitFor(() => expect(screen.queryByText("Edited email")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sarah Jones" })).toHaveFocus());
    expect(confirm).toHaveBeenCalledWith("Delete this interaction? It will be removed from the timeline. Last contact, relationship stage and Today may change.");
    expect((await readAllData(db)).interactions.map((record) => record.id)).toEqual(["interaction-phone"]);
  });

  it("shows derived history as unavailable instead of retaining stale contact data after refresh failure", async () => {
    await seedPerson();
    const db = await getDatabase();
    await createInteraction(db, {
      id: "interaction-to-delete",
      personId: "person-sarah",
      kind: "email",
      occurredAt: "2026-03-01T09:00:00.000Z",
      summary: "Contact that will be removed",
      createdAt: "2026-03-01T09:00:00.000Z",
      origin: "manual"
    }, "2026-03-02T09:00:00.000Z");
    const originalGetHistory = interactionQueries.getPersonHistory;
    vi.spyOn(interactionQueries, "getPersonHistory")
      .mockImplementationOnce(originalGetHistory)
      .mockRejectedValueOnce(new Error("injected history refresh failure"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await renderProfile();
    expect(screen.getByText("Last meaningful contact").parentElement).not.toHaveTextContent("Unavailable");

    await user.click(within(interactionArticle("Contact that will be removed")).getByRole("button", { name: "Edit interaction" }));
    const editor = await screen.findByRole("dialog", { name: "Edit interaction" });
    await user.click(within(editor).getByRole("button", { name: "Delete interaction" }));

    expect(await screen.findByText("PeopleOS could not load recent history.")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Last meaningful contact").parentElement).toHaveTextContent("Unavailable");
    expect(screen.queryByText("Contact that will be removed")).not.toBeInTheDocument();
  });

  it("filters the Timeline deterministically and preserves it across an application reload", async () => {
    await seedPerson();
    const db = await getDatabase();
    await createInteraction(db, {
      id: "interaction-contact",
      personId: "person-sarah",
      kind: "coffee",
      occurredAt: "2026-03-01T12:00:00.000Z",
      summary: "Coffee at the station",
      createdAt: "2026-03-01T12:00:00.000Z",
      origin: "manual"
    }, "2026-03-02T09:00:00.000Z");
    await createInteraction(db, {
      id: "interaction-note",
      personId: "person-sarah",
      kind: "note_added",
      occurredAt: "2026-03-02T08:00:00.000Z",
      summary: "Prefers early meetings",
      createdAt: "2026-03-02T08:00:00.000Z",
      origin: "note"
    }, "2026-03-02T09:00:00.000Z");
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/person-sarah/timeline");
    render(<App />);

    expect(await screen.findByText("Coffee at the station")).toBeInTheDocument();
    expect(screen.getByText("Prefers early meetings")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Contact" }));
    expect(screen.getByText("Coffee at the station")).toBeInTheDocument();
    expect(screen.queryByText("Prefers early meetings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("Prefers early meetings")).toBeInTheDocument();
    expect(screen.queryByText("Coffee at the station")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));

    cleanup();
    render(<App />);
    expect(await screen.findByText("Coffee at the station")).toBeInTheDocument();
    expect(screen.getByText("Prefers early meetings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 5, name: "Person created" })).toBeInTheDocument();
  });

  it("returns from Timeline to the existing Profile so its original Today origin is preserved", async () => {
    await seedPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/");
    window.history.pushState({ fromPath: "/" }, "", "/people/person-sarah");
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });

    await user.click(await screen.findByRole("button", { name: "See full timeline" }));
    expect(window.location.pathname).toBe("/people/person-sarah/timeline");
    await user.click(await screen.findByRole("button", { name: "← Person" }));
    await screen.findByRole("heading", { name: "Sarah Jones" });
    expect(window.location.pathname).toBe("/people/person-sarah");
    await user.click(screen.getByRole("button", { name: "← Today" }));
    expect(window.location.pathname).toBe("/");
  });

  it("logs through the global Add person picker and restores focus to Add", async () => {
    await seedPerson();
    await seedPerson("person-aaron", "Aaron Patel");
    const affiliation: OrganisationAffiliation = {
      id: "affiliation-aaron",
      revision: 1,
      personId: "person-aaron",
      organisationName: "Watford Health",
      role: "Digital lead",
      isCurrent: true,
      createdAt: personCreatedAt,
      updatedAt: personCreatedAt
    };
    await createRepositories(await getDatabase()).affiliations.create(affiliation);
    const user = userEvent.setup();
    render(<App />);

    const add = await screen.findByRole("button", { name: "Add" });
    await user.click(add);
    let sheet = await screen.findByRole("dialog", { name: "Add to PeopleOS" });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Close Add menu" })).toHaveFocus());
    await user.click(within(sheet).getByRole("button", { name: "Log interaction" }));
    sheet = await screen.findByRole("dialog", { name: "Choose a person" });
    let search = within(sheet).getByLabelText("Find a person");
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard("{Escape}");
    sheet = await screen.findByRole("dialog", { name: "Add to PeopleOS" });
    const logInteraction = within(sheet).getByRole("button", { name: "Log interaction" });
    await waitFor(() => expect(logInteraction).toHaveFocus());
    await user.click(logInteraction);
    sheet = await screen.findByRole("dialog", { name: "Choose a person" });
    search = within(sheet).getByLabelText("Find a person");
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, "aar");
    expect(within(sheet).queryByRole("button", { name: /Sarah Jones/ })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Aaron Patel.*Digital lead.*Watford Health/ }));

    const editor = await screen.findByRole("dialog", { name: "Log interaction" });
    await user.selectOptions(within(editor).getByLabelText(/^Interaction type/), "email");
    await user.type(within(editor).getByLabelText("Summary"), "Sent the fellowship agenda");
    await user.click(within(editor).getByRole("button", { name: "Save interaction" }));

    await waitFor(() => expect(add).toHaveFocus());
    expect((await readAllData(await getDatabase())).interactions).toMatchObject([{
      personId: "person-aaron",
      kind: "email",
      summary: "Sent the fellowship agenda"
    }]);
  });

  it("traps keyboard focus, announces validation, and restores focus after discarding", async () => {
    await seedPerson();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await renderProfile();
    const { opener, dialog } = await openProfileNote(user);
    const note = within(dialog).getByLabelText("Note");
    await waitFor(() => expect(note).toHaveFocus());
    const occurred = within(dialog).getByLabelText(/^Date and time/);
    const originalOccurred = (occurred as HTMLInputElement).value;
    fireEvent.change(occurred, { target: { value: "" } });
    await user.click(within(dialog).getByRole("button", { name: "Save note" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Choose a valid date and time.");
    expect(occurred).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(occurred, { target: { value: originalOccurred } });
    await user.click(within(dialog).getByRole("button", { name: "Save note" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Add a note before saving.");

    await user.type(note, "Unsaved but accessible note");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close interaction editor" })).toHaveFocus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add note" })).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    await waitFor(() => expect(opener).toHaveFocus());
    expect((await readAllData(await getDatabase())).interactions).toEqual([]);
  });
});
