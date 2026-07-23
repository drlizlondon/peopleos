import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createReachOut, prepareCreateReachOutCommand } from "./application/reachOut";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { DATABASE_NAME, type LocalDate, type Person } from "./domain/schema";

function today(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(): Promise<Person> {
  const now = new Date().toISOString();
  const person: Person = {
    id: "person-sarah-default",
    revision: 1,
    displayName: "Sarah Ahmed",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  await createRepositories(await getDatabase()).people.create(person);
  return person;
}

async function setReminderDefault(days: 1 | 7 | 14 | 30 | undefined) {
  const repositories = createRepositories(await getDatabase());
  const settings = await repositories.appSettings.get("app");
  if (!settings) throw new Error("Settings missing in test");
  const { reachOutDefaultReminderDays: _previous, ...base } = settings;
  await repositories.appSettings.update({
    ...base,
    ...(days === undefined ? {} : { reachOutDefaultReminderDays: days })
  }, settings.revision, new Date().toISOString());
}

describe("V1-08 Reach Out defaults and overdue editing", () => {
  beforeEach(async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("prefills the saved reminder default, permits a visible override or clear, and never rewrites the saved plan later", async () => {
    await seedPerson();
    await setReminderDefault(7);
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    const dialog = await screen.findByRole("dialog", { name: "Who do you want to reach out to?" });
    await user.type(within(dialog).getByLabelText(/^Person or description/), "Sarah");
    await user.click(within(dialog).getByRole("button", { name: /Sarah Ahmed/ }));

    const date = within(dialog).getByLabelText(/^Reminder date/) as HTMLInputElement;
    await waitFor(() => expect(date).toHaveValue(addDaysToLocalDate(today(), 7)));
    await user.click(within(dialog).getByRole("button", { name: "No reminder" }));
    expect(date).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    expect(date).toHaveValue(addDaysToLocalDate(today(), 1));
    await user.click(within(dialog).getByRole("button", { name: "Add to Reach Out" }));

    await screen.findByRole("heading", { name: "Sarah Ahmed" });
    const db = await getDatabase();
    const entryBefore = (await db.getAll("reachOutEntries"))[0];
    const followUpBefore = (await db.getAll("followUps"))[0];
    expect(followUpBefore?.dueDate).toBe(addDaysToLocalDate(today(), 1));

    await setReminderDefault(30);

    expect(await db.get("reachOutEntries", entryBefore!.id)).toEqual(entryBefore);
    expect(await db.get("followUps", followUpBefore!.id)).toEqual(followUpBefore);
  });

  it("edits an overdue plan without forcing a reminder change", async () => {
    const person = await seedPerson();
    const yesterday = addDaysToLocalDate(today(), -1);
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Original reason",
      reminderDate: yesterday
    }, { now: `${yesterday}T09:00:00.000Z`, localDate: yesterday }));
    window.history.replaceState({}, "", `/reach-out/${created.entry.id}`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Sarah Ahmed" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Reach Out plan" });
    const reason = within(dialog).getByLabelText(/^Why I want to reach out/);
    await user.clear(reason);
    await user.type(reason, "Updated reason");
    expect(within(dialog).getByLabelText(/^Reminder date/)).toHaveValue(yesterday);
    await user.click(within(dialog).getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Reach Out plan" })).not.toBeInTheDocument());
    expect((await screen.findAllByText("Updated reason")).length).toBeGreaterThanOrEqual(1);
    const saved = await (await getDatabase()).get("followUps", created.followUp!.id);
    expect(saved).toMatchObject({ id: created.followUp!.id, dueDate: yesterday, status: "pending" });
  });
});
