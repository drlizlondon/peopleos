import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";
import { RELATIONSHIP_MODE_PREFERENCE_KEY } from "./relationshipModePreference";

async function reset() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
  window.localStorage.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, "all");
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    }
  });
}

describe("compact mobile relationship and scheduling controls", () => {
  beforeEach(async () => {
    installLocalStorage();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    await reset();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await reset();
  });

  it("keeps relationship filters on working lists and out of Settings", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.replaceState({}, "", "/settings");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /filters|relationship filter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Personal|Professional/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Today" }));
    const filters = screen.getByRole("group", { name: "Today filters" });
    expect(Array.from(filters.querySelectorAll("button"), (button) => button.textContent))
      .toEqual(["All", "Personal", "Professional"]);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists the compact relationship filter across working lists and remounts", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.replaceState({}, "", "/");
    const first = render(<App />);
    const professional = await screen.findByRole("button", { name: "Professional" });
    await user.click(professional);
    expect(professional).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("link", { name: "People" }));
    expect(screen.getByRole("group", { name: "Relationship filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
    first.unmount();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(RELATIONSHIP_MODE_PREFERENCE_KEY)).toBe("professional");
  });

  it("saves the person before optional regular contact and creates a usable first schedule", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Monthly person");
    expect(screen.queryByLabelText("How often?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByRole("heading", { name: "How do you want to keep in touch?" })).toBeInTheDocument();
    let db = await getDatabase();
    const savedPeople = await db.getAll("people");
    expect(savedPeople).toHaveLength(1);
    expect(savedPeople[0]).toMatchObject({ displayName: "Monthly person" });
    expect(savedPeople[0]?.contactCadence).toBeUndefined();
    expect(await db.getAll("followUps")).toEqual([]);

    await user.click(screen.getByRole("button", { name: /Regular contact/ }));
    await user.selectOptions(screen.getByLabelText("How often?"), "monthly");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    await waitFor(async () => {
      db = await getDatabase();
      const [person] = await db.getAll("people");
      expect(person).toMatchObject({ contactCadence: { value: 1, unit: "months" } });
      expect(await db.getAll("followUps")).toEqual([
        expect.objectContaining({
          personId: person?.id,
          dueDate: "2026-08-14",
          status: "pending",
          suggestedByRule: "initial_schedule"
        })
      ]);
      expect(await db.getAll("interactions")).toEqual([]);
    });
  });
});
