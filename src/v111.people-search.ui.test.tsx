import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { PeopleScreen } from "./peopleScreens";
import * as personSearch from "./application/personSearch";
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

  it("keeps the compact destination heading visible while People loads", () => {
    vi.spyOn(personSearch, "getPersonSearchView").mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<PeopleScreen activeMode="personal" navigate={vi.fn()} />);

    const heading = screen.getByText("People", { selector: "h2" }).closest(".page-heading");
    expect(heading).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveTextContent("Loading people…");
    unmount();
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

  it("keeps the People screen focused on one search control", async () => {
    await seedFilterPeople();
    render(<App />);
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Filter people" })).not.toBeInTheDocument();
  });

  it("keeps archived People out of the normal list with one quiet recovery toggle", async () => {
    await seedFilterPeople();
    const user = userEvent.setup();
    render(<App />);

    const defaultResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(defaultResults).queryByText("Alex Archived")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived" }));
    const archivedResults = await screen.findByRole("list", { name: "People search results" });
    expect(within(archivedResults).getByText("Alex Archived")).toBeInTheDocument();
    expect(within(archivedResults).queryByText("Sarah Jones")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active people" })).toBeInTheDocument();

    await user.click(within(archivedResults).getByRole("link", { name: /Alex Archived/ }));
    expect(await screen.findByRole("heading", { name: "Archived" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("keeps archived People available in the name-only fallback", async () => {
    await seedFilterPeople();
    vi.spyOn(personSearch, "getPersonSearchView").mockRejectedValue(new Error("context index unavailable"));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/showing the name-only directory/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archived" }));
    const archivedResults = await screen.findByRole("list", { name: "Name-only People directory" });
    expect(within(archivedResults).getByText("Alex Archived")).toBeInTheDocument();
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

  it("restores query and scroll after opening a result and using Profile Back", async () => {
    await seedContextualPeople();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "HealthTech");
    await screen.findByRole("list", { name: "People search results" });

    Object.defineProperty(window, "scrollY", { configurable: true, value: 175 });
    await user.click(screen.getByRole("link", { name: /Aaron Clarke/ }));
    expect(await screen.findByRole("heading", { name: "Aaron Clarke" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people/person-aaron");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Edit mobile and email" }));
    expect(await screen.findByRole("button", { name: "Add email" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Person" }));
    expect(await screen.findByRole("heading", { name: "Edit person" })).toBeInTheDocument();
    const name = await screen.findByLabelText(/Full or contact name/);
    await user.clear(name);
    await user.type(name, "Aaron Clarke updated");
    await waitFor(() => expect(name).toHaveValue("Aaron Clarke updated"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Aaron Clarke updated" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people/person-aaron");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    await user.click(screen.getByRole("button", { name: "← People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
    expect(await screen.findByRole("searchbox", { name: "Search people" })).toHaveValue("HealthTech");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 175, behavior: "instant" }));
  });

  it("loads a Person profile directly without requiring transient directory state", async () => {
    await seedContextualPeople();
    window.history.replaceState({}, "", "/people/person-aaron");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Aaron Clarke" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← People" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  });
});
