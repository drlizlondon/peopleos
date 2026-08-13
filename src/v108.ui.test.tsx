import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as reachOutIdentityActions from "./application/reachOutIdentity";
import * as reachOutQueryActions from "./application/reachOutQueries";
import {
  createReachOut,
  moveReachOutToDormant,
  prepareCreateReachOutCommand,
  prepareReachOutStatusCommand
} from "./application/reachOut";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import {
  DATABASE_NAME,
  type ContactMethod,
  type LocalDate,
  type OrganisationAffiliation,
  type Person
} from "./domain/schema";
import { validatePeopleOsData } from "./domain/validation";
import { OPEN_TODAY_FROM_NOTIFICATION_EVENT } from "./notifications/service";

function today(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(overrides: Partial<Person> = {}): Promise<Person> {
  const now = new Date().toISOString();
  const person: Person = {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  await createRepositories(await getDatabase()).people.create(person);
  return person;
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

describe("V1-08 Reach Out UI", () => {
  beforeEach(async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("adds a new confirmed Person with one optional note and no follow-up", async () => {
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    expect(screen.getByText("People you mean to contact.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Add someone" }));

    const dialog = await screen.findByRole("dialog", { name: "Add someone" });
    const identity = await within(dialog).findByLabelText(/^Person/, {}, { timeout: 10_000 });
    expect(identity).toHaveAttribute("maxLength", "120");
    expect(identity).not.toHaveFocus();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close Reach Out" })).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a person");
    await user.type(identity, "Simon");
    expect(within(dialog).queryByText(/temporary description/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "+ Add Simon" }));

    const addPerson = within(dialog).getByRole("group", { name: "Add someone" });
    expect(within(addPerson).getByLabelText(/^Name/)).toHaveValue("Simon");
    const lists = within(addPerson).getByRole("group", { name: "Lists" });
    expect(within(lists).getByRole("checkbox", { name: "Personal" })).toBeChecked();
    await user.click(within(lists).getByRole("checkbox", { name: "Professional" }));
    await user.click(within(addPerson).getByRole("button", { name: "Add person" }));

    expect(await within(dialog).findByText("Selected")).toBeInTheDocument();
    expect(within(dialog).getByText("Simon")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Note/), "Catch up about fellowship");
    expect(within(dialog).queryByLabelText(/Reminder date|Intended next action|Context|Action type/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/More details|Tomorrow|No reminder/)).not.toBeInTheDocument();

    const form = within(dialog).getByRole("button", { name: "Save" }).closest("form");
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(async () => {
      expect((await readAllData(await getDatabase())).reachOutEntries).toHaveLength(1);
    });

    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ displayName: "Simon", identityStatus: "confirmed", relationshipMode: "both" });
    expect(data.reachOutEntries).toEqual([expect.objectContaining({ reason: "Catch up about fellowship", intentStatus: "active" })]);
    expect(data.followUps).toHaveLength(0);
    expect(data.reachOutContexts).toHaveLength(0);
    expect(validatePeopleOsData(data)).toBeTruthy();
  });

  it("keeps a dirty Reach Out draft when a Today notification is declined", async () => {
    window.history.replaceState({}, "", "/reach-out");
    const confirm = vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    const dialog = await screen.findByRole("dialog", { name: "Add someone" });
    await user.type(await within(dialog).findByLabelText(/^Person/), "Dr Smith");
    window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));

    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    expect(window.location.pathname).toBe("/reach-out");
    expect(screen.getByRole("dialog", { name: "Add someone" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Person/)).toHaveValue("Dr Smith");

    confirm.mockReturnValue(true);
    await user.click(within(dialog).getByRole("button", { name: "Close Reach Out" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("selects an existing Person without making a duplicate", async () => {
    await seedPerson();
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Reach Out" });

    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    const editor = await screen.findByRole("dialog", { name: "Add someone" });
    await user.type(await within(editor).findByLabelText(/^Person/), "Sarah");
    const matches = await within(editor).findByRole("list", { name: "Matching people" });
    expect(within(matches).getByRole("button", { name: /Sarah Jones/ })).toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "+ Add Sarah" })).not.toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: /Sarah Jones/ }));
    await user.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      expect((await readAllData(await getDatabase())).reachOutEntries).toHaveLength(1);
    });
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.reachOutEntries).toHaveLength(1);
    expect(data.followUps).toHaveLength(0);
  });

  it("shows only the note and contact actions, then Done removes the item but retains the Person", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Catch up about fellowship",
      intendedActionType: "send_update",
      actionDetail: "Legacy action detail",
      notes: "Legacy extra notes",
      reminderDate: today(),
      newContexts: [{ kind: "fellowship", label: "Legacy fellowship" }]
    }, { localDate: today(), idFactory: sequence("complete") }));
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    const list = await screen.findByRole("list", { name: "Reach Out list" });
    const card = within(list).getByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByText("Catch up about fellowship")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Message" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(within(card).queryByText(/Legacy action detail|Legacy extra notes|Legacy fellowship|Waiting|Planned/)).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Done" }));
    await waitFor(async () => {
      expect((await readAllData(await getDatabase())).reachOutEntries).toEqual([
        expect.objectContaining({ id: created.entry.id, intentStatus: "completed" })
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toEqual([expect.objectContaining({ id: person.id, displayName: person.displayName })]);
    expect(data.reachOutEntries).toEqual([expect.objectContaining({ id: created.entry.id, intentStatus: "completed" })]);
    expect(data.followUps).toEqual([expect.objectContaining({ id: created.followUp!.id, status: "completed" })]);
    expect(data.interactions).toEqual([expect.objectContaining({ kind: "follow_up_completed" })]);
    expect(data.reachOutEvents.filter((event) => event.kind === "completed")).toHaveLength(1);
  });

  it("offers a dormant legacy entry as a simple Add back action", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Reconnect later",
      reminderDate: addDaysToLocalDate(today(), 5)
    }, { localDate: today(), idFactory: sequence("dormant") }));
    const dormant = await moveReachOutToDormant(await getDatabase(), prepareReachOutStatusCommand(
      created.entry,
      person,
      created.followUp,
      "moved_to_dormant",
      { idFactory: sequence("dormant-status") }
    ));
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    const dialog = await screen.findByRole("dialog", { name: "Add someone" });
    await user.type(await within(dialog).findByLabelText(/^Person/), "Sarah");
    await user.click(await within(dialog).findByRole("button", { name: /Sarah Jones/ }));
    expect(await within(dialog).findByText(/Add them back to your Reach Out list/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add back" }));

    await waitFor(async () => {
      expect(await (await getDatabase()).get("reachOutEntries", created.entry.id)).toMatchObject({ intentStatus: "active" });
    });
    const data = await readAllData(await getDatabase());
    expect(data.reachOutEntries).toEqual([expect.objectContaining({
      id: dormant.entry.id,
      intentStatus: "active",
      reason: "Reconnect later"
    })]);
    expect(data.followUps).toEqual([expect.objectContaining({ id: created.followUp!.id, status: "cancelled" })]);
    expect(data.people).toHaveLength(1);
  });

  it("completes a provisional identity in place from the Reach Out plan", async () => {
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person: { provisionalLabel: "Chief Information Officer at Watford" }
    }, { localDate: today(), idFactory: sequence("resolve") }));
    window.history.replaceState({}, "", `/reach-out/${created.entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);
    const heading = await screen.findByRole("heading", { name: "Complete identity" });
    expect(heading).toBeInTheDocument();
    const input = screen.getByLabelText(/^Confirmed display name/);
    await user.clear(input);
    await user.type(input, "Alex Morgan");
    await user.click(screen.getByRole("button", { name: "Add email" }));
    await user.type(screen.getByLabelText("Email address"), "alex@watford.example");
    await user.type(screen.getByLabelText("Organisation"), "Watford Health");
    await user.type(screen.getByLabelText("Role or job title"), "Chief Information Officer");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    expect(await screen.findByRole("heading", { name: "Alex Morgan" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/people/${created.person.id}`);
    expect(await (await getDatabase()).get("people", created.person.id)).toMatchObject({
      id: created.person.id,
      displayName: "Alex Morgan",
      identityStatus: "confirmed"
    });
    expect((await (await getDatabase()).getAllFromIndex("contactMethods", "by-person", created.person.id))[0])
      .toMatchObject({ canonicalValue: "alex@watford.example", kind: "email" });
    expect((await (await getDatabase()).getAllFromIndex("affiliations", "by-person", created.person.id))[0])
      .toMatchObject({ organisationName: "Watford Health", role: "Chief Information Officer" });

  });

  it("shows an accessible resolver load error and retries in place", async () => {
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person: { provisionalLabel: "Potential mentor" }
    }, { localDate: today(), idFactory: sequence("resolver-load") }));
    vi.spyOn(reachOutQueryActions, "getReachOutDetail")
      .mockRejectedValueOnce(new Error("injected resolver load failure"));
    window.history.replaceState({}, "", `/reach-out/${created.entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PeopleOS could not load identity resolution.");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Complete identity" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Confirmed display name/)).toHaveValue("Potential mentor");
  });

  it("links to an existing Person only after a complete preview and explicit contact conflict choice", async () => {
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person: { provisionalLabel: "Simon from the digital team" },
      reason: "Reconnect after the fellowship",
      reminderDate: addDaysToLocalDate(today(), 7),
      newContexts: [{ kind: "fellowship", label: "Digital Fellowship" }]
    }, { localDate: today(), idFactory: sequence("link-ui") }));
    const target = await seedPerson({ id: "person-simon", displayName: "Simon Jones" });
    const now = new Date().toISOString();
    const sourcePhone: ContactMethod = {
      id: "contact-source-work",
      revision: 1,
      personId: created.person.id,
      kind: "phone",
      label: "Work mobile",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: now,
      updatedAt: now
    };
    const targetPhone: ContactMethod = {
      ...sourcePhone,
      id: "contact-target-personal",
      personId: target.id,
      label: "Personal mobile",
      rawValue: "07800 123456",
      canonicalValue: "+447800123456"
    };
    const affiliation: OrganisationAffiliation = {
      id: "affiliation-source",
      revision: 1,
      personId: created.person.id,
      organisationName: "Digital Team",
      role: "Clinical advisor",
      isCurrent: true,
      createdAt: now,
      updatedAt: now
    };
    const repositories = createRepositories(await getDatabase());
    await repositories.contactMethods.create(sourcePhone);
    await repositories.contactMethods.create(targetPhone);
    await repositories.affiliations.create(affiliation);
    const originalLink = reachOutIdentityActions.linkProvisionalPerson;
    const linkSpy = vi.spyOn(reachOutIdentityActions, "linkProvisionalPerson")
      .mockRejectedValueOnce(new Error("injected link failure"))
      .mockImplementation(originalLink);

    window.history.replaceState({ fromPath: `/reach-out/${created.entry.id}` }, "", `/reach-out/${created.entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Complete identity" });
    expect(screen.getByLabelText("Reach Out contexts")).toHaveTextContent("Digital Fellowship");
    await user.click(screen.getByRole("button", { name: "Link to existing Person" }));

    const search = screen.getByLabelText("Find a confirmed Person");
    await user.type(search, "Nobody here");
    expect(screen.getByText("No existing person found")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "Simon Jones");
    await user.click(screen.getByRole("button", { name: /Simon Jones/ }));

    const preview = await screen.findByRole("heading", { name: "Review before linking" });
    const previewSection = preview.closest("section")!;
    expect(within(previewSection).getByText("Digital Fellowship", { exact: false })).toBeInTheDocument();
    expect(within(previewSection).getByText("Reach Out history", { selector: "dt" }).nextElementSibling).toHaveTextContent("2");
    expect(within(previewSection).getByText("Follow-up history", { selector: "dt" }).nextElementSibling).toHaveTextContent("1");
    await user.click(within(previewSection).getByText("Review the records in this resolution"));
    expect(within(previewSection).getByText(/Reach Out context · Digital Fellowship · remains shared/)).toBeInTheDocument();
    expect(within(previewSection).getAllByText(/history.*(remains|moves)/i).length).toBeGreaterThanOrEqual(2);

    await user.click(within(previewSection).getByRole("radio", { name: /Keep Simon Jones’s current preferred phone/ }));
    await user.click(screen.getByRole("button", { name: "Link People" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("injected link failure");
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}/resolve`);
    await user.click(screen.getByRole("button", { name: "Link People" }));

    expect(await screen.findByRole("heading", { name: "Simon Jones" })).toBeInTheDocument();
    expect(linkSpy).toHaveBeenCalledTimes(2);
    expect(linkSpy.mock.calls[1]?.[1]).toEqual(linkSpy.mock.calls[0]?.[1]);
    expect(window.location.pathname).toBe(`/people/${target.id}`);
    const data = await readAllData(await getDatabase());
    expect(data.people.find((person) => person.id === created.person.id)).toMatchObject({
      identityStatus: "merged",
      mergedIntoPersonId: target.id
    });
    expect(data.reachOutEntries[0]).toMatchObject({ personId: target.id });
    expect(data.followUps[0]).toMatchObject({ personId: target.id });
    expect(data.followUpEvents[0]).toMatchObject({ personId: target.id });
    expect(data.contactMethods.find((contact) => contact.id === sourcePhone.id)).toMatchObject({
      personId: target.id,
      isPreferred: false
    });
    expect(data.affiliations.find((record) => record.id === affiliation.id)).toMatchObject({ personId: target.id });
    expect(data.reachOutContexts.find((context) => context.label === "Digital Fellowship")).toBeTruthy();
    expect(validatePeopleOsData(data)).toBeTruthy();

  });

  it("guards dirty resolver work on Cancel, contextual navigation and browser back", async () => {
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person: { provisionalLabel: "Hackathon organiser" }
    }, { localDate: today(), idFactory: sequence("dirty-resolver") }));
    window.history.replaceState({ fromPath: `/reach-out/${created.entry.id}` }, "", `/reach-out/${created.entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);
    const name = await screen.findByLabelText(/^Confirmed display name/);
    await user.type(name, " updated");
    vi.mocked(window.confirm).mockReturnValue(false);

    await user.click(screen.getByRole("button", { name: "← Reach Out plan" }));
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}/resolve`);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}/resolve`);

    window.history.replaceState({}, "", `/reach-out/${created.entry.id}`);
    fireEvent.popState(window);
    await waitFor(() => expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}/resolve`));
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(await (await getDatabase()).get("people", created.person.id)).toMatchObject({
      displayName: "Hackathon organiser",
      identityStatus: "provisional"
    });

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}`);
  });

  it("restores focus to the Reach Out empty-state capture opener", async () => {
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);
    const emptyOpener = await screen.findByRole("button", { name: "Add someone" });
    await user.click(emptyOpener);
    await user.click(await within(await screen.findByRole("dialog", { name: "Add someone" })).findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(emptyOpener).toHaveFocus());
  });
});
