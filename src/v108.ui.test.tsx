import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as reachOutIdentityActions from "./application/reachOutIdentity";
import * as reachOutQueryActions from "./application/reachOutQueries";
import {
  createReachOut,
  prepareCreateReachOutCommand
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

  it("quick-captures one provisional Person and reciprocal reminder from the canonical empty state", async () => {
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "People you mean to contact" })).toBeInTheDocument();
    expect(screen.getByText("You can even add someone if all you remember is where you met them.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add someone" }));

    const dialog = await screen.findByRole("dialog", { name: "Who do you want to reach out to?" });
    const identity = within(dialog).getByLabelText(/^Person or description/);
    await waitFor(() => expect(identity).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: "Add to Reach Out" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose an existing person");
    await user.type(identity, "Hackathon organiser");
    await user.click(within(dialog).getByRole("button", { name: /Use “Hackathon organiser”/ }));
    await user.type(within(dialog).getByLabelText(/^Why I want to reach out/), "Thank them for bringing everyone together");
    await user.selectOptions(within(dialog).getByLabelText(/^Intended next action/), "research_contact_route");
    await user.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    await user.type(within(dialog).getByLabelText(/^Add context/), "NHS AI Hackathon");

    const form = within(dialog).getByRole("button", { name: "Add to Reach Out" }).closest("form");
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(await screen.findByRole("heading", { name: "Hackathon organiser" })).toBeInTheDocument();
    expect(window.location.pathname).toMatch(/^\/reach-out\/reach-out-/);
    expect(screen.getAllByText("Thank them for bringing everyone together").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("NHS AI Hackathon")).toBeInTheDocument();

    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ displayName: "Hackathon organiser", identityStatus: "provisional" });
    expect(data.reachOutEntries).toHaveLength(1);
    expect(data.followUps).toHaveLength(1);
    expect(data.reachOutEntries[0]?.currentFollowUpId).toBe(data.followUps[0]?.id);
    expect(data.followUps[0]).toMatchObject({ reachOutEntryId: data.reachOutEntries[0]?.id, dueDate: addDaysToLocalDate(today(), 1) });
    expect(validatePeopleOsData(data)).toBeTruthy();
  });

  it("adds an existing Person without duplication and makes Reach Out the contextual first global Add action", async () => {
    await seedPerson();
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "People you mean to contact" });

    await user.click(screen.getByRole("button", { name: "Add person" }));
    const addSheet = await screen.findByRole("dialog", { name: "Add to PeopleOS" });
    const labels = Array.from(addSheet.querySelectorAll(".global-add-actions > button"), (button) => button.textContent);
    expect(labels[0]).toBe("Add to Reach Out");
    await user.click(within(addSheet).getByRole("button", { name: "Add to Reach Out" }));

    const editor = await screen.findByRole("dialog", { name: "Who do you want to reach out to?" });
    await user.type(within(editor).getByLabelText(/^Person or description/), "Sarah");
    await user.click(within(editor).getByRole("button", { name: /Sarah Jones/ }));
    await user.click(within(editor).getByRole("button", { name: "Add to Reach Out" }));

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByText("Add why")).toBeInTheDocument();
    expect(screen.getByText("Choose next action")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.reachOutEntries).toHaveLength(1);
    expect(data.followUps).toHaveLength(0);
  });

  it("shows one authoritative plan consistently in Reach Out, Detail, Profile, Upcoming and Timeline", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Send the pilot update",
      intendedActionType: "send_update",
      reminderDate: addDaysToLocalDate(today(), 7),
      newContexts: [{ kind: "fellowship", label: "AI Fellowship" }]
    }, { localDate: today(), idFactory: sequence("consistent") }));
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    const queue = await screen.findByRole("list", { name: "Current Reach Out queue" });
    expect(within(queue).getByText("Send the pilot update")).toBeInTheDocument();
    expect(within(queue).getByText("Waiting")).toBeInTheDocument();
    expect(within(queue).getByText("AI Fellowship")).toBeInTheDocument();
    await user.click(within(queue).getByRole("button", { name: "Open plan" }));

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getAllByText("Send the pilot update").length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "Open Person" }));
    const profileReachOut = (await screen.findByRole("heading", { name: "Reach Out" })).closest("section")!;
    expect(await within(profileReachOut).findByText("Send the pilot update")).toBeInTheDocument();
    expect(within(profileReachOut).getByText("Waiting")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "See full timeline" }));
    expect(await screen.findByRole("heading", { name: "Added to Reach Out" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reach Out reminder linked" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Upcoming" }));
    expect(await screen.findByRole("heading", { name: "Send the pilot update" })).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).followUps.filter((followUp) => followUp.status === "pending"))
      .toEqual([expect.objectContaining({ id: created.followUp!.id, reachOutEntryId: created.entry.id })]);
  });

  it("completes outreach without claiming contact and retains the lifecycle in history", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Research the contact route",
      reminderDate: today()
    }, { localDate: today(), idFactory: sequence("complete") }));
    window.history.replaceState({ fromPath: "/reach-out" }, "", `/reach-out/${created.entry.id}`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });
    await user.click(screen.getByRole("button", { name: "Mark outreach complete" }));
    const dialog = await screen.findByRole("dialog", { name: "Complete outreach" });
    await user.click(within(dialog).getByRole("radio", { name: "Complete without logging contact" }));
    await user.click(within(dialog).getByRole("radio", { name: "No, complete this outreach" }));
    await user.click(within(dialog).getByRole("button", { name: "Complete outreach" }));

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Outreach completed", level: 3 })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.reachOutEntries[0]).toMatchObject({ intentStatus: "completed" });
    expect(data.followUps[0]).toMatchObject({ status: "completed" });
    expect(data.interactions).toEqual([expect.objectContaining({ kind: "follow_up_completed" })]);
    expect(data.reachOutEvents.filter((event) => event.kind === "completed")).toHaveLength(1);
  });

  it("associates outreach-completion choice errors with their choice groups", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Reconnect after the fellowship"
    }, { localDate: today(), idFactory: sequence("completion-a11y") }));
    window.history.replaceState({}, "", `/reach-out/${created.entry.id}`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });
    await user.click(screen.getByRole("button", { name: "Mark outreach complete" }));

    const dialog = await screen.findByRole("dialog", { name: "Complete outreach" });
    await user.click(within(dialog).getByRole("button", { name: "Complete outreach" }));

    expect(within(dialog).getByRole("group", { name: /What happened/ }))
      .toHaveAccessibleDescription("Choose whether contact happened.");
    expect(within(dialog).getByRole("group", { name: /Do you want another follow-up/ }))
      .toHaveAccessibleDescription("Choose whether you want another follow-up.");
  });

  it("moves a plan through Dormant, reactivation and removal without losing history", async () => {
    const person = await seedPerson();
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reminderDate: addDaysToLocalDate(today(), 5)
    }, { localDate: today(), idFactory: sequence("status") }));
    window.history.replaceState({}, "", `/reach-out/${created.entry.id}`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });

    await user.click(screen.getByRole("button", { name: "Move to Dormant" }));
    expect(await screen.findByText("Dormant")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(await screen.findByText("Active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove from Reach Out" }));
    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("This retained plan is read-only.")).toBeInTheDocument();

    const data = await readAllData(await getDatabase());
    expect(data.reachOutEntries[0]?.removedAt).toBeTruthy();
    expect(data.followUps[0]).toMatchObject({ status: "cancelled" });
    expect(data.reachOutEvents.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "added", "follow_up_linked", "moved_to_dormant", "activated", "removed"
    ]));
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

    await user.click(screen.getByRole("button", { name: /Back to Reach Out plan/ }));
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}`);
    expect(await screen.findByRole("heading", { name: "Alex Morgan" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Back to Reach Out plan/ }));
    expect(window.location.pathname).toBe(`/reach-out/${created.entry.id}`);
    expect(await screen.findByRole("heading", { name: "Simon Jones" })).toBeInTheDocument();
  });

  it("guards dirty resolver work on Cancel, primary-tab navigation and browser back", async () => {
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person: { provisionalLabel: "Hackathon organiser" }
    }, { localDate: today(), idFactory: sequence("dirty-resolver") }));
    window.history.replaceState({ fromPath: `/reach-out/${created.entry.id}` }, "", `/reach-out/${created.entry.id}/resolve`);
    const user = userEvent.setup();
    render(<App />);
    const name = await screen.findByLabelText(/^Confirmed display name/);
    await user.type(name, " updated");
    vi.mocked(window.confirm).mockReturnValue(false);

    await user.click(screen.getByRole("link", { name: "People" }));
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

  it("restores focus to the actual Reach Out capture opener", async () => {
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);
    const emptyOpener = await screen.findByRole("button", { name: "Add someone" });
    await user.click(emptyOpener);
    await user.click(within(await screen.findByRole("dialog", { name: "Who do you want to reach out to?" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(emptyOpener).toHaveFocus());

    const headerOpener = screen.getByRole("button", { name: "Add person" });
    await user.click(headerOpener);
    await user.click(within(await screen.findByRole("dialog", { name: "Add to PeopleOS" })).getByRole("button", { name: "Add to Reach Out" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Who do you want to reach out to?" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(headerOpener).toHaveFocus());
  });

  it("restores focus to the Person Profile Reach Out action", async () => {
    const person = await seedPerson();
    window.history.replaceState({ fromPath: "/people" }, "", `/people/${person.id}`);
    const user = userEvent.setup();
    render(<App />);
    const opener = await screen.findByRole("button", { name: "Add to Reach Out" });
    await user.click(opener);
    await user.click(within(await screen.findByRole("dialog", { name: "Who do you want to reach out to?" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
