import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AffiliationsScreen from "./AffiliationsScreen";
import App from "./App";
import MemoryFactsScreen from "./MemoryFactsScreen";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import {
  DATABASE_NAME,
  type MemoryFact,
  type OrganisationAffiliation,
  type Person
} from "./domain/schema";

const createdAt = "2026-07-01T09:00:00.000Z";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(id = "person-sarah", displayName = "Sarah Jones") {
  const person: Person = {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt,
    updatedAt: createdAt
  };
  await createRepositories(await getDatabase()).people.create(person);
}

describe("V1-06 memory facts and affiliations UI", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/people/person-sarah");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
    await seedPerson();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("creates, warns about an exact duplicate, archives and restores a memory fact", async () => {
    const user = userEvent.setup();
    render(<MemoryFactsScreen personId="person-sarah" navigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Memory facts" });

    await user.click(screen.getAllByRole("button", { name: "Add fact" })[0]);
    let dialog = await screen.findByRole("dialog", { name: "Add memory fact" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Kind/)).toHaveFocus());
    expect(within(dialog).getByRole("checkbox", { name: /Show this as/ })).toBeChecked();
    await user.type(within(dialog).getByLabelText(/^What to remember/), "Interested in simulation");
    await user.click(within(dialog).getByRole("button", { name: "Save fact" }));

    expect(await screen.findByRole("heading", { name: "Interested in simulation" })).toBeInTheDocument();
    let data = await readAllData(await getDatabase());
    expect(data.memoryFacts).toHaveLength(1);
    expect(data.memoryFacts[0]).toMatchObject({
      personId: "person-sarah",
      kind: "interest",
      value: "Interested in simulation",
      showAsMemoryCue: true
    });

    await user.click(screen.getByRole("button", { name: "Add fact" }));
    dialog = await screen.findByRole("dialog", { name: "Add memory fact" });
    await user.type(within(dialog).getByLabelText(/^What to remember/), "Interested in simulation");
    await user.click(within(dialog).getByRole("button", { name: "Save fact" }));
    const warning = await within(dialog).findByRole("alertdialog", { name: "This fact is already saved" });
    expect(warning).toHaveTextContent("distinct context");
    await waitFor(() => expect(within(warning).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.click(within(warning).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).queryByRole("alertdialog")).not.toBeInTheDocument();
    await user.click(within(dialog).getAllByRole("button", { name: "Cancel" })[0]);

    await user.click(screen.getByRole("button", { name: "Archive Interested in simulation" }));
    expect(await screen.findByText("Fact archived.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Interested in simulation" })).not.toBeInTheDocument());
    data = await readAllData(await getDatabase());
    expect(data.memoryFacts[0]?.archivedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Interested in simulation" })).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).memoryFacts[0]?.archivedAt).toBeUndefined();
  });

  it("keeps communication preference controlled and supports an explicit introduced-by link", async () => {
    await seedPerson("person-james", "James Cole");
    const user = userEvent.setup();
    render(<MemoryFactsScreen personId="person-sarah" navigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Memory facts" });

    await user.click(screen.getAllByRole("button", { name: "Add fact" })[0]);
    let dialog = await screen.findByRole("dialog", { name: "Add memory fact" });
    await user.selectOptions(within(dialog).getByLabelText(/^Kind/), "communication_preference");
    expect(within(dialog).getByLabelText(/^Preferred method/).tagName).toBe("SELECT");
    await user.selectOptions(within(dialog).getByLabelText(/^Preferred method/), "email");
    await user.click(within(dialog).getByRole("button", { name: "Save fact" }));
    expect(await screen.findByRole("heading", { name: "Email" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add fact" }));
    dialog = await screen.findByRole("dialog", { name: "Add memory fact" });
    await user.selectOptions(within(dialog).getByLabelText(/^Kind/), "introduced_by");
    await user.selectOptions(within(dialog).getByLabelText(/^Related person/), "person-james");
    expect(within(dialog).getByLabelText(/^What to remember/)).toHaveValue("James Cole");
    await user.click(within(dialog).getByRole("button", { name: "Save fact" }));

    await waitFor(async () => {
      const facts = (await readAllData(await getDatabase())).memoryFacts;
      expect(facts.find((fact) => fact.kind === "introduced_by")).toMatchObject({
        value: "James Cole",
        relatedPersonId: "person-james"
      });
    });
  });

  it("creates multiple current affiliations, ends one, then archives and restores it", async () => {
    const user = userEvent.setup();
    render(<AffiliationsScreen personId="person-sarah" navigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Affiliations" });

    async function addAffiliation(name: string, role: string, startedOn?: string) {
      await user.click(screen.getAllByRole("button", { name: "Add affiliation" })[0]);
      const dialog = await screen.findByRole("dialog", { name: "Add affiliation" });
      await waitFor(() => expect(within(dialog).getByLabelText(/^Organisation/)).toHaveFocus());
      await user.type(within(dialog).getByLabelText(/^Organisation/), name);
      await user.type(within(dialog).getByLabelText(/^Role/), role);
      if (startedOn) await user.type(within(dialog).getByLabelText(/^Started/), startedOn);
      await user.click(within(dialog).getByRole("button", { name: "Save affiliation" }));
      await screen.findByRole("heading", { name });
    }

    await addAffiliation("Watford General Hospital", "CIO", "2024-01-01");
    await addAffiliation("NHS AI Fellowship", "Fellow", "2025-01-01");
    expect(screen.getAllByText("Current").filter((node) => node.classList.contains("status-chip"))).toHaveLength(2);

    const watfordItem = screen.getByRole("heading", { name: "Watford General Hospital" }).closest("li");
    expect(watfordItem).not.toBeNull();
    await user.click(within(watfordItem!).getByRole("button", { name: "End Watford General Hospital" }));
    await waitFor(() => {
      const updated = screen.getByRole("heading", { name: "Watford General Hospital" }).closest("li");
      expect(updated).not.toBeNull();
      expect(within(updated!).queryByText("Current")).not.toBeInTheDocument();
    });

    const endedWatfordItem = screen.getByRole("heading", { name: "Watford General Hospital" }).closest("li");
    expect(endedWatfordItem).not.toBeNull();
    await user.click(within(endedWatfordItem!).getByRole("button", { name: "Archive Watford General Hospital" }));
    expect(await screen.findByText("Affiliation archived.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Watford General Hospital" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("heading", { name: "Watford General Hospital" })).toBeInTheDocument();

    const data = await readAllData(await getDatabase());
    expect(data.affiliations).toHaveLength(2);
    expect(data.affiliations.filter((record) => record.isCurrent)).toHaveLength(1);
    expect(data.affiliations.every((record) => !record.archivedAt)).toBe(true);
    expect(data.affiliations.find((record) => record.organisationName === "NHS AI Fellowship")?.startedOn)
      .toBe("2025-01-01");
  });

  it("keeps Profile notes plain and does not turn note prose into a memory fact", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });
    await user.type(screen.getByLabelText("Note"), "Interested in simulation training");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("Interested in simulation training")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.interactions).toHaveLength(1);
    expect(data.interactions[0]).toMatchObject({ kind: "note_added", summary: "Interested in simulation training" });
    expect(data.memoryFacts).toEqual([]);
  });

  it("retains structured facts and affiliations without presenting them on the simple Profile", async () => {
    const repositories = createRepositories(await getDatabase());
    const factSpecs: Array<Pick<MemoryFact, "id" | "kind" | "value" | "showAsMemoryCue"> & Partial<MemoryFact>> = [
      { id: "fact-preference", kind: "communication_preference", value: "email", showAsMemoryCue: true },
      { id: "fact-seeking", kind: "seeking", value: "Looking for pilot sites", showAsMemoryCue: true },
      { id: "fact-interest", kind: "interest", value: "Interested in simulation", showAsMemoryCue: true },
      { id: "fact-introduced", kind: "introduced_by", value: "Introduced by Ed", showAsMemoryCue: true },
      { id: "fact-location", kind: "location", value: "Based in Bristol", showAsMemoryCue: true },
      { id: "fact-family", kind: "family", value: "Has three children", showAsMemoryCue: false },
      { id: "fact-archived", kind: "other", value: "Archived context", showAsMemoryCue: true, archivedAt: createdAt }
    ];
    const facts: MemoryFact[] = factSpecs.map((fact) => ({
      revision: 1,
      personId: "person-sarah",
      createdAt,
      updatedAt: createdAt,
      ...fact
    }));
    for (const fact of facts) await repositories.memoryFacts.create(fact);

    const affiliations: OrganisationAffiliation[] = [
      {
        id: "affiliation-older",
        revision: 1,
        personId: "person-sarah",
        organisationName: "Earlier Organisation",
        role: "Earlier role",
        startedOn: "2024-01-01",
        isCurrent: true,
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "affiliation-newer",
        revision: 1,
        personId: "person-sarah",
        organisationName: "Current Organisation",
        role: "Current role",
        startedOn: "2025-01-01",
        isCurrent: true,
        createdAt,
        updatedAt: createdAt
      }
    ];
    for (const affiliation of affiliations) await repositories.affiliations.create(affiliation);

    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });
    for (const fact of facts) expect(screen.queryByText(fact.value)).not.toBeInTheDocument();
    expect(screen.queryByText("Earlier Organisation")).not.toBeInTheDocument();
    expect(screen.getByText("Current role · Current Organisation")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.memoryFacts).toEqual(expect.arrayContaining(facts));
    expect(data.affiliations).toEqual(expect.arrayContaining(affiliations));
  });
});
