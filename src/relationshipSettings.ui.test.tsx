import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { DATABASE_NAME, type Person } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    contactCadenceDays: 14,
    contactCadenceFirstDueDate: "2026-07-01",
    contactCadenceDeferredUntilDate: "2026-08-14",
    contactCadencePausedAt: "2026-07-20T09:00:00.000Z",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides
  };
}

async function seed(record = person()) {
  await createRepositories(await getDatabase()).people.create(record);
}

describe("MVP Relationship settings", () => {
  beforeEach(async () => {
    await resetDatabase();
    window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah/relationship-settings");
  });

  afterEach(resetDatabase);

  it("keeps one Person and preserves paused reminder state when only visibility changes", async () => {
    const user = userEvent.setup();
    await seed();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Relationship settings" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Personal" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Professional" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Remind me to stay in touch" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "How often?" })).toHaveValue("14");

    await user.click(screen.getByRole("checkbox", { name: "Professional" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(window.location.pathname).toBe("/people/person-sarah"));
    const records = await (await getDatabase()).getAll("people");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "person-sarah",
      relationshipMode: "both",
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-01",
      contactCadenceDeferredUntilDate: "2026-08-14",
      contactCadencePausedAt: "2026-07-20T09:00:00.000Z"
    });
  });

  it("changes Keep in touch deliberately and clears the old pause only when the reminder changes", async () => {
    const user = userEvent.setup();
    await seed();
    render(<App />);
    await screen.findByRole("heading", { name: "Relationship settings" });

    await user.selectOptions(screen.getByRole("combobox", { name: "How often?" }), "30");
    await user.selectOptions(screen.getByRole("combobox", { name: "Start" }), "tomorrow");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(window.location.pathname).toBe("/people/person-sarah"));
    const saved = await (await getDatabase()).get("people", "person-sarah");
    expect(saved).toMatchObject({
      contactCadenceDays: 30,
      contactCadenceFirstDueDate: addDaysToLocalDate(today(), 1)
    });
    expect(saved).not.toHaveProperty("contactCadenceDeferredUntilDate");
    expect(saved).not.toHaveProperty("contactCadencePausedAt");
  });

  it("keeps Reach Out as a separate one-off intention", async () => {
    const user = userEvent.setup();
    const noCadence = person();
    delete noCadence.contactCadenceDays;
    delete noCadence.contactCadenceFirstDueDate;
    delete noCadence.contactCadenceDeferredUntilDate;
    delete noCadence.contactCadencePausedAt;
    await seed(noCadence);
    render(<App />);

    await screen.findByRole("heading", { name: "Relationship settings" });
    expect(screen.getByText("Not included")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog", { name: "Who do you want to reach out to?" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Sarah Jones")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remind me to stay in touch" })).not.toBeChecked();
  });

  it("keeps one-off reminder creation available through the Person flow", async () => {
    const user = userEvent.setup();
    await seed();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "View or add" }));
    expect(window.location.pathname).toBe("/people/person-sarah/follow-ups");
    expect(await screen.findByRole("button", { name: "Plan follow-up" })).toBeInTheDocument();
  });
});
