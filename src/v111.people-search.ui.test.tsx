import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import type {
  FollowUp,
  Interaction,
  MemoryFact,
  OrganisationAffiliation,
  Person,
  RelationshipEvent
} from "./domain/schema";
import { DATABASE_NAME } from "./domain/schema";

const NOW = "2026-07-23T12:00:00.000Z";

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
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides
  };
}

function affiliation(
  id: string,
  personId: string,
  organisationName: string,
  overrides: Partial<OrganisationAffiliation> = {}
): OrganisationAffiliation {
  return {
    id,
    revision: 1,
    personId,
    organisationName,
    isCurrent: true,
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
    ...overrides
  };
}

function interaction(
  id: string,
  personId: string,
  overrides: Partial<Interaction> = {}
): Interaction {
  return {
    id,
    revision: 1,
    personId,
    kind: "met",
    occurredAt: "2026-07-03T09:00:00.000Z",
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:00:00.000Z",
    ...overrides
  };
}

async function seedContextualPeople() {
  const repositories = createRepositories(await getDatabase());
  const aaron = person("person-aaron", "Aaron Clarke", { tags: ["fellowship"] });
  const priya = person("person-priya", "Priya Shah");
  const event: RelationshipEvent = {
    id: "event-healthtech",
    revision: 1,
    name: "HealthTech Fellowship",
    occurredOn: "2026-07-03",
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:00:00.000Z"
  };
  const fact: MemoryFact = {
    id: "fact-pilot-sites",
    revision: 1,
    personId: priya.id,
    kind: "seeking",
    value: "Looking for pilot sites",
    showAsMemoryCue: true,
    createdAt: "2026-07-04T09:00:00.000Z",
    updatedAt: "2026-07-04T09:00:00.000Z"
  };

  await repositories.people.create(aaron);
  await repositories.people.create(priya);
  await repositories.affiliations.create(affiliation("affiliation-aaron-healthtech", aaron.id, "NHS England", {
    role: "Programme lead"
  }));
  await repositories.events.create(event);
  await repositories.interactions.create(interaction("interaction-aaron-met", aaron.id, { eventId: event.id }));
  await repositories.memoryFacts.create(fact);
}

async function seedFilterPeople() {
  const repositories = createRepositories(await getDatabase());
  const matching = person("person-sarah", "Sarah Jones", { tags: ["mentor"] });
  const wrongOrganisation = person("person-aaron", "Aaron Clarke", { tags: ["mentor"] });
  const archived = person("person-archived", "Alex Archived", {
    tags: ["mentor"],
    archivedAt: "2026-07-20T09:00:00.000Z"
  });
  const due = (id: string, personId: string): FollowUp => ({
    id,
    revision: 1,
    personId,
    dueDate: "2026-07-20",
    reason: "Reconnect after fellowship",
    actionType: "message",
    status: "pending",
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:00.000Z"
  });

  for (const record of [matching, wrongOrganisation, archived]) await repositories.people.create(record);
  await repositories.affiliations.create(affiliation("affiliation-sarah", matching.id, "NHS England"));
  await repositories.affiliations.create(affiliation("affiliation-aaron", wrongOrganisation.id, "Private Health"));
  await repositories.affiliations.create(affiliation("affiliation-archived", archived.id, "NHS England"));
  await repositories.followUps.create(due("follow-up-sarah", matching.id));
  await repositories.followUps.create(due("follow-up-aaron", wrongOrganisation.id));
  await repositories.followUps.create(due("follow-up-archived", archived.id));
}

describe("V1-11 People search and filters UI", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    window.history.replaceState({}, "", "/people");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await resetDatabase();
  });

  it("searches remembered context and explains the highest-ranked Event and Memory Fact matches", async () => {
    await seedContextualPeople();
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    expect(search).toHaveAttribute("placeholder", "Name, organisation, event or memory");

    await user.type(search, "HealthTech Fell");
    // Search is debounced, so wait for the matched result itself: the results
    // list element already exists from the unfiltered view.
    await screen.findByText("Matched: Event · HealthTech Fellowship");
    const eventResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(eventResults).getByText("Aaron Clarke")).toBeInTheDocument();
    expect(within(eventResults).getByText("Programme lead · NHS England")).toBeInTheDocument();
    expect(within(eventResults).getByText("Met at HealthTech Fellowship")).toBeInTheDocument();
    expect(within(eventResults).getByText("Matched: Event · HealthTech Fellowship")).toBeInTheDocument();
    expect(within(eventResults).queryByText("Priya Shah")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "pilot sit");
    await screen.findByText("Matched: Seeking · Looking for pilot sites");
    const factResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(factResults).getByText("Priya Shah")).toBeInTheDocument();
    expect(within(factResults).getByText("Matched: Seeking · Looking for pilot sites")).toBeInTheDocument();
    expect(within(factResults).queryByText("Aaron Clarke")).not.toBeInTheDocument();
  });

  it("applies different filter kinds conjunctively and makes the modal keyboard-accessible", async () => {
    await seedFilterPeople();
    const user = userEvent.setup();
    render(<App />);

    const filterButton = await screen.findByRole("button", { name: "Filters" });
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    await user.click(filterButton);

    let dialog = await screen.findByRole("dialog", { name: "Filter people" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close people filters" })).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(filterButton).toHaveFocus());

    await user.click(filterButton);
    dialog = await screen.findByRole("dialog", { name: "Filter people" });
    await user.click(within(dialog).getByRole("checkbox", { name: "mentor" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "NHS England" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Has due follow-up" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Missing contact details" }));
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));

    const results = await screen.findByRole("list", { name: "People search results" });
    expect(within(results).getByText("Sarah Jones")).toBeInTheDocument();
    expect(within(results).queryByText("Aaron Clarke")).not.toBeInTheDocument();
    expect(within(results).queryByText("Alex Archived")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tag: mentor ×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Organisation: NHS England ×" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Organisation: NHS England ×" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "People search results" })).toHaveTextContent("Aaron Clarke"));
  });

  it("keeps archived People excluded until the archived filter is explicitly requested", async () => {
    await seedFilterPeople();
    const user = userEvent.setup();
    render(<App />);

    const defaultResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(defaultResults).queryByText("Alex Archived")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter people" });
    await user.click(within(dialog).getByRole("radio", { name: "Archived" }));
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));

    const archivedResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(archivedResults).getByText("Alex Archived")).toBeInTheDocument();
    expect(within(archivedResults).getByText("Archived")).toBeInTheDocument();
    expect(within(archivedResults).queryByText("Sarah Jones")).not.toBeInTheDocument();
  });

  it("validates the 200-character limit with an associated accessible error", async () => {
    await seedContextualPeople();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    fireEvent.change(search, { target: { value: "x".repeat(201) } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search is limited to 200 characters.");
    expect(search).toHaveAttribute("aria-invalid", "true");
    expect(search).toHaveAttribute("aria-describedby", alert.id);
  });

  it("distinguishes no matches from first-use emptiness and offers deterministic recovery actions", async () => {
    await seedContextualPeople();
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "Nobody here");
    expect(await screen.findByRole("heading", { name: "No one matches “Nobody here”." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add new person" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your people will appear here." })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("list", { name: "People search results" })).toHaveTextContent("Aaron Clarke");
  });

  it("restores query, filters, and scroll after opening a result and using Profile Back", async () => {
    await seedContextualPeople();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "HealthTech");
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = await screen.findByRole("dialog", { name: "Filter people" });
    await user.click(within(dialog).getByRole("checkbox", { name: "fellowship" }));
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));
    expect(await screen.findByRole("button", { name: "Tag: fellowship ×" })).toBeInTheDocument();
    await screen.findByRole("list", { name: "People search results" });

    Object.defineProperty(window, "scrollY", { configurable: true, value: 175 });
    await user.click(screen.getByRole("link", { name: /Aaron Clarke/ }));
    expect(await screen.findByRole("heading", { name: "Aaron Clarke" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people/person-aaron");

    const actions = screen.getByRole("group", { name: "Person actions" });
    const moreActions = actions.querySelector("summary");
    expect(moreActions).toHaveAttribute("aria-label", "More actions for Aaron Clarke");
    await user.click(moreActions!);
    const overflow = screen.getByRole("group", { name: "More actions for Aaron Clarke" });
    await user.click(within(overflow).getByRole("button", { name: "Edit person" }));
    await user.click(await screen.findByRole("button", { name: "Manage contact methods" }));
    expect(await screen.findByRole("button", { name: "Add email" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Person" }));
    expect(await screen.findByRole("heading", { name: "Edit person" })).toBeInTheDocument();
    const name = await screen.findByLabelText(/Display name/);
    await user.clear(name);
    await user.type(name, "Aaron Clarke updated");
    await waitFor(() => expect(name).toHaveValue("Aaron Clarke updated"));
    const confirm = vi.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Manage affiliations" }));
    expect(window.location.pathname).toBe("/people/person-aaron/edit");
    expect(screen.getByLabelText(/Display name/)).toHaveValue("Aaron Clarke updated");
    confirm.mockReturnValueOnce(false);
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/people/person-aaron/edit"));
    expect(window.history.state).toMatchObject({ fromProfile: true, fromPath: "/people" });
    expect(screen.getByLabelText(/Display name/)).toHaveValue("Aaron Clarke updated");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Aaron Clarke updated" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people/person-aaron");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await user.click(screen.getByRole("button", { name: "← People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toHaveValue("HealthTech");
    expect(screen.getByRole("button", { name: "Tag: fellowship ×" })).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 175, behavior: "instant" }));
  });

  it("loads a Person profile directly without requiring transient directory state", async () => {
    await seedContextualPeople();
    window.history.replaceState({}, "", "/people/person-aaron");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Aaron Clarke" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← People" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
  });
});
