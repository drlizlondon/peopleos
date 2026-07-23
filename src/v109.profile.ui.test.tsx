import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Interaction, type Person } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedProfile(options: { dueCommitment?: boolean } = {}) {
  const repositories = createRepositories(await getDatabase());
  const person: Person = {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: "2021-01-01T12:00:00.000Z",
    updatedAt: "2021-01-01T12:00:00.000Z"
  };
  await repositories.people.create(person);
  const dates = ["2022-01-01", "2022-06-01", "2023-01-01", "2023-06-01", "2024-01-01"];
  for (const [index, date] of dates.entries()) {
    const record: Interaction = {
      id: `interaction-${index}`,
      revision: 1,
      personId: person.id,
      kind: index % 2 ? "email" : "meeting",
      occurredAt: `${date}T12:00:00.000Z`,
      createdAt: `${date}T12:00:00.000Z`,
      updatedAt: `${date}T12:00:00.000Z`
    };
    await repositories.interactions.create(record);
  }
  await repositories.interactions.create({
    id: "private-note",
    revision: 1,
    personId: person.id,
    kind: "note_added",
    occurredAt: "2025-01-01T12:00:00.000Z",
    summary: "Private investor concern that must never become a cue",
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
  if (options.dueCommitment) {
    await repositories.followUps.create({
      id: "follow-up-introduction",
      revision: 1,
      personId: person.id,
      dueDate: "2025-03-01",
      reason: "Introduce Sarah to the fellowship lead",
      actionType: "make_introduction",
      status: "pending",
      createdAt: "2025-02-02T12:00:00.000Z",
      updatedAt: "2025-02-02T12:00:00.000Z"
    });
  }
}

describe("V1-09 Profile projections", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-23T12:00:00.000Z"));
    window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await resetDatabase();
  });

  it("renders stage, last contact and relationship age from one engine assessment", async () => {
    await seedProfile();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Relationship summary" }).closest("section")!;
    expect(await within(summary).findByText("Long-term")).toBeInTheDocument();
    expect(within(summary).getByText(/Long-term · 5 recorded conversations across about 2 years/)).toBeInTheDocument();
    expect(within(summary).getByText(/Last contact: Meeting on 1 January 2024/)).toBeInTheDocument();
    expect(within(summary).getByText(/Known for about 5 years/)).toBeInTheDocument();
  });

  it("surfaces a safe structured Fact and never promotes private Note prose", async () => {
    await seedProfile();
    render(<App />);
    const cue = await screen.findByLabelText("Memory cue");
    expect(within(cue).getByText("Looking for pilot sites")).toBeInTheDocument();
    expect(within(cue).getByText(/From a memory fact you added/)).toBeInTheDocument();
    expect(within(cue).queryByText(/Private investor concern/)).not.toBeInTheDocument();
  });

  it("lets a due commitment displace the Fact cue without changing the stage", async () => {
    await seedProfile({ dueCommitment: true });
    render(<App />);
    const cue = await screen.findByLabelText("Memory cue");
    expect(within(cue).getByText("Introduce Sarah to the fellowship lead")).toBeInTheDocument();
    expect(within(cue).getByText(/From a follow-up planned for/)).toBeInTheDocument();
    expect(within(cue).queryByText("Looking for pilot sites")).not.toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Relationship summary" }).closest("section")!;
    expect(await within(summary).findByText("Long-term")).toBeInTheDocument();
  });
});
