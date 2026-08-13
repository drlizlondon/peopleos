import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Person } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedProfile() {
  const repositories = createRepositories(await getDatabase());
  const person: Person = {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadence: { value: 2, unit: "weeks" },
    createdAt: "2021-01-01T12:00:00.000Z",
    updatedAt: "2021-01-01T12:00:00.000Z"
  };
  await repositories.people.create(person);
  await repositories.interactions.create({
    id: "private-note",
    revision: 1,
    personId: person.id,
    kind: "note_added",
    occurredAt: "2025-01-01T12:00:00.000Z",
    summary: "Ask about the garden project",
    createdAt: "2025-01-01T12:00:00.000Z",
    updatedAt: "2025-01-01T12:00:00.000Z"
  });
  await repositories.memoryFacts.create({
    id: "fact-seeking",
    revision: 1,
    personId: person.id,
    kind: "seeking",
    value: "Looking for pilot sites",
    showAsMemoryCue: true,
    createdAt: "2025-02-01T12:00:00.000Z",
    updatedAt: "2025-02-01T12:00:00.000Z"
  });
  await repositories.followUps.create({
    id: "follow-up-introduction",
    revision: 1,
    personId: person.id,
    dueDate: "2026-08-13",
    reason: "Introduce Sarah to the fellowship lead",
    actionType: "make_introduction",
    status: "pending",
    createdAt: "2025-02-02T12:00:00.000Z",
    updatedAt: "2025-02-02T12:00:00.000Z"
  });
}

describe("simple Profile projections", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
    window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await resetDatabase();
  });

  it("shows only reference details, frequency, next date and plain Notes", async () => {
    await seedProfile();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByText("Contact every").parentElement).toHaveTextContent("2 weeks");
    expect(screen.getByText("Next").parentElement).toHaveTextContent("Tomorrow");
    expect(await screen.findByText("Ask about the garden project")).toBeInTheDocument();
  });

  it("shows a paused due Person’s return date from the shared schedule", async () => {
    await seedProfile();
    const db = await getDatabase();
    const person = await db.get("people", "person-sarah");
    const followUp = await db.get("followUps", "follow-up-introduction");
    await db.put("people", {
      ...person!,
      todayPausedUntilDate: "2026-08-20"
    });
    await db.put("followUps", {
      ...followUp!,
      dueDate: "2026-08-11"
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByText("Next").parentElement).toHaveTextContent(/Aug 20, 2026|20 Aug 2026/);
    expect(screen.getByText("Next").parentElement).not.toHaveTextContent("Today");
  });

  it("does not turn stored facts, follow-up reasons or recorded activity into profile analytics", async () => {
    await seedProfile();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah Jones" });

    expect(screen.queryByText("Looking for pilot sites")).not.toBeInTheDocument();
    expect(screen.queryByText("Introduce Sarah to the fellowship lead")).not.toBeInTheDocument();
    expect(screen.queryByText("Relationship summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/last contact/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/known for/i)).not.toBeInTheDocument();
  });
});
