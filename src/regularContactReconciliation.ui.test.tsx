import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodayScreen from "./TodayScreen";
import UpcomingScreen from "./UpcomingScreen";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Person } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedFrequencyOnlyPerson(
  id = "person-legacy",
  displayName = "Sarah",
  relationshipMode: Person["relationshipMode"] = "personal"
) {
  const now = new Date().toISOString();
  await createRepositories(await getDatabase()).people.create({
    id,
    revision: 1,
    displayName,
    relationshipMode,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadence: { value: 1, unit: "days" },
    createdAt: now,
    updatedAt: now
  });
}

describe("legacy Regular contact reconciliation", () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("detects a frequency-only person in Today and Start today repairs and survives reload", async () => {
    await seedFrequencyOnlyPerson();
    const user = userEvent.setup();
    const view = render(<TodayScreen navigate={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "When should regular contact start?" })).toBeInTheDocument();
    expect(screen.getByText("Regular contact · Sarah")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "That’s everyone for today." })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start today" }));
    expect(await screen.findByRole("article", { name: "Sarah" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "When should regular contact start?" })).not.toBeInTheDocument();

    const data = await readAllData(await getDatabase());
    expect(data.followUps).toEqual([
      expect.objectContaining({ personId: "person-legacy", status: "pending", suggestedByRule: "initial_schedule" })
    ]);
    expect(data.followUpEvents).toEqual([
      expect.objectContaining({ personId: "person-legacy", kind: "created" })
    ]);
    expect(data.interactions).toEqual([]);

    view.unmount();
    render(<TodayScreen navigate={vi.fn()} />);
    expect(await screen.findByRole("article", { name: "Sarah" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "When should regular contact start?" })).not.toBeInTheDocument();
  });

  it("Start tomorrow repairs a frequency-only person into Upcoming without creating contact activity", async () => {
    await seedFrequencyOnlyPerson();
    const user = userEvent.setup();
    const view = render(<UpcomingScreen navigate={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "When should regular contact start?" })).toBeInTheDocument();
    expect(screen.queryByText("No one is scheduled yet.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start tomorrow" }));

    expect(await screen.findByRole("link", { name: /Sarah/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "When should regular contact start?" })).not.toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.followUps).toEqual([
      expect.objectContaining({ personId: "person-legacy", status: "pending", suggestedByRule: "initial_schedule" })
    ]);
    expect(data.interactions).toEqual([]);

    view.unmount();
    render(<UpcomingScreen navigate={vi.fn()} />);
    expect(await screen.findByRole("link", { name: /Sarah/ })).toBeInTheDocument();
  });

  it("only reconciles people in the active Personal or Professional view", async () => {
    await seedFrequencyOnlyPerson("person-personal", "Dad", "personal");
    await seedFrequencyOnlyPerson("person-professional", "Dr Smith", "professional");
    const view = render(<TodayScreen activeMode="personal" navigate={vi.fn()} />);

    expect(await screen.findByText("Regular contact · Dad")).toBeInTheDocument();
    expect(screen.queryByText("Regular contact · Dr Smith")).not.toBeInTheDocument();
    view.rerender(<TodayScreen activeMode="professional" navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Regular contact · Dr Smith")).toBeInTheDocument());
    expect(screen.queryByText("Regular contact · Dad")).not.toBeInTheDocument();
  });
});
