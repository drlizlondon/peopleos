import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createInteraction } from "./application/interactions";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Person } from "./domain/schema";

const createdAt = "2026-01-01T09:00:00.000Z";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(): Promise<Person> {
  const person: Person = {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt,
    updatedAt: createdAt
  };
  await createRepositories(await getDatabase()).people.create(person);
  return person;
}

async function renderProfile() {
  window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah");
  render(<App />);
  await screen.findByRole("heading", { name: "Sarah Jones" });
}

describe("simple Profile notes and retained interaction routes", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("presents Profile as a short reference page without relationship analytics or workflow actions", async () => {
    await seedPerson();
    await renderProfile();

    expect(screen.getByRole("region", { name: "Person details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.queryByText("Last meaningful contact")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Person actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /timeline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /follow-up/i })).not.toBeInTheDocument();
  });

  it("saves one plain note without asking the user to understand interaction types", async () => {
    await seedPerson();
    const user = userEvent.setup();
    await renderProfile();

    const note = screen.getByLabelText("Note");
    expect(note).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    await user.type(note, "Ask how the garden project is going.");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByText("Ask how the garden project is going.")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).interactions).toMatchObject([{
      personId: "person-sarah",
      kind: "note_added",
      summary: "Ask how the garden project is going."
    }]);
    expect((await readAllData(await getDatabase())).memoryFacts).toEqual([]);
  });

  it("continues to read existing note data without surfacing other recorded activity as complete history", async () => {
    await seedPerson();
    const db = await getDatabase();
    await createInteraction(db, {
      id: "interaction-note",
      personId: "person-sarah",
      kind: "note_added",
      occurredAt: "2026-03-02T08:00:00.000Z",
      summary: "Prefers early meetings",
      createdAt: "2026-03-02T08:00:00.000Z",
      origin: "note"
    }, "2026-03-02T09:00:00.000Z");
    await createInteraction(db, {
      id: "interaction-coffee",
      personId: "person-sarah",
      kind: "coffee",
      occurredAt: "2026-03-01T12:00:00.000Z",
      summary: "Coffee at the station",
      createdAt: "2026-03-01T12:00:00.000Z",
      origin: "manual"
    }, "2026-03-02T09:00:00.000Z");

    await renderProfile();
    expect(await screen.findByText("Prefers early meetings")).toBeInTheDocument();
    expect(screen.queryByText("Coffee at the station")).not.toBeInTheDocument();
  });

  it("keeps the existing Timeline route readable for old links and stored data", async () => {
    await seedPerson();
    const db = await getDatabase();
    await createInteraction(db, {
      id: "interaction-note",
      personId: "person-sarah",
      kind: "note_added",
      occurredAt: "2026-03-02T08:00:00.000Z",
      summary: "Prefers early meetings",
      createdAt: "2026-03-02T08:00:00.000Z",
      origin: "note"
    }, "2026-03-02T09:00:00.000Z");
    cleanup();
    window.history.replaceState({}, "", "/people/person-sarah/timeline");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByText("Prefers early meetings")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 5, name: "Person created" })).toBeInTheDocument();
  });
});
