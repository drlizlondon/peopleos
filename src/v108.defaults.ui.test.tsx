import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import ReachOutEditorSheet from "./ReachOutEditorSheet";
import { createReachOut, prepareCreateReachOutCommand } from "./application/reachOut";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { DATABASE_NAME, type LocalDate, type Person, type ReachOutEntry } from "./domain/schema";

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

describe("Reach Out simple capture and legacy preservation", () => {
  beforeEach(async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("ignores the stored Reach Out reminder default in the simple no-date flow", async () => {
    await seedPerson();
    await setReminderDefault(7);
    window.history.replaceState({}, "", "/reach-out");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add someone" }));
    const dialog = await screen.findByRole("dialog", { name: "Add someone" });
    const personInput = within(dialog).getByLabelText(/^Person/);
    expect(personInput).not.toHaveFocus();
    expect(within(dialog).queryByLabelText(/Reminder date/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Tomorrow|No reminder/)).not.toBeInTheDocument();

    await user.type(personInput, "Sarah");
    await user.click(within(dialog).getByRole("button", { name: /Sarah Ahmed/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      expect(await (await getDatabase()).getAll("reachOutEntries")).toHaveLength(1);
    });
    const db = await getDatabase();
    const entryBefore = (await db.getAll("reachOutEntries"))[0];
    expect(await db.getAll("followUps")).toHaveLength(0);

    await setReminderDefault(30);
    expect(await db.get("reachOutEntries", entryBefore!.id)).toEqual(entryBefore);
    expect(await db.getAll("followUps")).toHaveLength(0);
  });

  it("edits only the visible note while retaining hidden legacy plan data", async () => {
    const person = await seedPerson();
    const yesterday = addDaysToLocalDate(today(), -1);
    const created = await createReachOut(await getDatabase(), prepareCreateReachOutCommand({
      person,
      reason: "Original note",
      intendedActionType: "send_update",
      actionDetail: "Legacy action detail",
      notes: "Legacy extra notes",
      reminderDate: yesterday,
      newContexts: [{ kind: "fellowship", label: "Legacy fellowship" }]
    }, { now: `${yesterday}T09:00:00.000Z`, localDate: yesterday }));
    const onSaved = vi.fn<(entry: ReachOutEntry) => void>();
    const user = userEvent.setup();

    render(
      <ReachOutEditorSheet
        mode="edit"
        person={person}
        entry={created.entry}
        currentFollowUp={created.followUp}
        onClose={() => undefined}
        onSaved={onSaved}
        onOpenExisting={() => undefined}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit note" });
    expect(within(dialog).queryByLabelText(/Reminder date/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Intended next action|Context|More details/)).not.toBeInTheDocument();
    const note = within(dialog).getByLabelText(/^Note/);
    await user.clear(note);
    await user.type(note, "Updated note");
    await user.click(within(dialog).getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      id: created.entry.id,
      reason: "Updated note",
      intendedActionType: "send_update",
      actionDetail: "Legacy action detail",
      notes: "Legacy extra notes",
      contextIds: created.entry.contextIds
    });
    expect(await (await getDatabase()).get("followUps", created.followUp!.id)).toMatchObject({
      id: created.followUp!.id,
      dueDate: yesterday,
      status: "pending"
    });
  });
});
