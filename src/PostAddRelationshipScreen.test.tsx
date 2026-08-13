import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PostAddRelationshipScreen from "./PostAddRelationshipScreen";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Person } from "./domain/schema";

const person: Person = {
  id: "person-sarah",
  revision: 1,
  displayName: "Sarah",
  relationshipMode: "professional",
  identityStatus: "confirmed",
  importance: "normal",
  tags: [],
  createdAt: "2026-08-13T09:00:00.000Z",
  updatedAt: "2026-08-13T09:00:00.000Z"
};

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson() {
  await createRepositories(await getDatabase()).people.create(person);
}

function renderScreen() {
  const navigate = vi.fn();
  const onSavingChange = vi.fn();
  render(
    <PostAddRelationshipScreen
      personId={person.id}
      navigate={navigate}
      onSavingChange={onSavingChange}
    />
  );
  return { navigate, onSavingChange };
}

describe("post-add relationship choice", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    await resetDatabase();
    await seedPerson();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await resetDatabase();
  });

  it("closes without configuring or removing the already-saved Person", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate } = renderScreen();
    expect(await screen.findByRole("heading", { name: "How do you want to keep in touch?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close relationship setup" }));

    expect(navigate).toHaveBeenCalledWith("/people/person-sarah", { replace: true });
    const data = await readAllData(await getDatabase());
    expect(data.people).toEqual([person]);
    expect(data.followUps).toEqual([]);
    expect(data.reachOutEntries).toEqual([]);
  });

  it("sets Daily from Today with the scheduler's private initial anchor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate, onSavingChange } = renderScreen();
    await screen.findByText("Sarah is already in PeopleOS.");

    await user.click(screen.getByRole("button", { name: /Regular contact/ }));
    expect(screen.getByLabelText("How often?")).toHaveValue("three-days");
    await user.selectOptions(screen.getByLabelText("How often?"), "daily");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
    const data = await readAllData(await getDatabase());
    expect(data.people[0]).toMatchObject({
      id: person.id,
      relationshipMode: "professional",
      contactCadence: { value: 1, unit: "days" }
    });
    expect(data.followUps).toEqual([
      expect.objectContaining({
        personId: person.id,
        dueDate: "2026-08-13",
        suggestedByRule: "initial_schedule",
        status: "pending"
      })
    ]);
    expect(data.followUpEvents).toEqual([
      expect.objectContaining({ kind: "created", toDate: "2026-08-13" })
    ]);
    expect(data.interactions).toEqual([]);
    expect(onSavingChange).toHaveBeenCalledWith(true);
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });

  it("sets Tomorrow as a calculable future schedule", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate } = renderScreen();
    await screen.findByText("Sarah is already in PeopleOS.");

    await user.click(screen.getByRole("button", { name: /Regular contact/ }));
    await user.selectOptions(screen.getByLabelText("How often?"), "weekly");
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/upcoming", { replace: true }));
    const data = await readAllData(await getDatabase());
    expect(data.people[0]?.contactCadence).toEqual({ value: 1, unit: "weeks" });
    expect(data.followUps[0]).toMatchObject({ dueDate: "2026-08-14", suggestedByRule: "initial_schedule" });
  });

  it("supports an explicit future date and the existing three-month frequency", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate } = renderScreen();
    await screen.findByText("Sarah is already in PeopleOS.");

    await user.click(screen.getByRole("button", { name: /Regular contact/ }));
    await user.selectOptions(screen.getByLabelText("How often?"), "three-months");
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-01" } });
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/upcoming", { replace: true }));
    const data = await readAllData(await getDatabase());
    expect(data.people[0]?.contactCadence).toEqual({ value: 3, unit: "months" });
    expect(data.followUps[0]?.dueDate).toBe("2026-09-01");
  });

  it("cannot persist a frequency without a usable first date", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate } = renderScreen();
    await screen.findByText("Sarah is already in PeopleOS.");

    await user.click(screen.getByRole("button", { name: /Regular contact/ }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose when regular contact should start.");
    await waitFor(() => expect(screen.getByRole("group", { name: "Start" })).toHaveFocus());
    expect(navigate).not.toHaveBeenCalled();
    const data = await readAllData(await getDatabase());
    expect(data.people).toEqual([person]);
    expect(data.followUps).toEqual([]);
  });

  it("adds the existing Person to Reach Out without creating a recurring schedule", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { navigate } = renderScreen();
    await screen.findByText("Sarah is already in PeopleOS.");

    await user.click(screen.getByRole("button", { name: /Add to Reach Out/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/reach-out", { replace: true }));
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]?.contactCadence).toBeUndefined();
    expect(data.reachOutEntries).toEqual([
      expect.objectContaining({
        personId: person.id,
        intentStatus: "active"
      })
    ]);
    expect(data.reachOutEntries[0]?.currentFollowUpId).toBeUndefined();
    expect(data.reachOutEvents).toEqual([expect.objectContaining({ kind: "added" })]);
    expect(data.followUps).toEqual([]);
    expect(data.interactions).toEqual([]);
  });
});
