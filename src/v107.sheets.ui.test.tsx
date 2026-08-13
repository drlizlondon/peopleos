import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CadenceEditorSheet from "./CadenceEditorSheet";
import FollowUpCompletionSheet from "./FollowUpCompletionSheet";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import { createFollowUp, createFollowUpDraft } from "./application/followUps";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { DATABASE_NAME, type FollowUp, type LocalDate, type Person } from "./domain/schema";

function today(): LocalDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(overrides: Partial<Person> = {}): Promise<Person> {
  const now = new Date().toISOString();
  const person: Person = {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  await createRepositories(await getDatabase()).people.create(person);
  return person;
}

async function seedFollowUp(
  personId: string,
  dueDate: LocalDate = today(),
  reason = "Send the promised notes"
): Promise<FollowUp> {
  const draft = createFollowUpDraft(personId, { dueDate });
  return createFollowUp(await getDatabase(), {
    ...draft,
    reason,
    actionType: "send_update"
  }, { localDate: dueDate < today() ? dueDate : today() });
}

describe("V1-07 follow-up and cadence sheets", () => {
  beforeEach(async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("creates one explicit follow-up with a blank reason contract and stable duplicate-submit guard", async () => {
    await seedPerson();
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <FollowUpEditorSheet
        mode="create"
        personId="person-sarah"
        personName="Sarah Jones"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Plan a follow-up" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^Reason/)).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: "Save follow-up" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Add a reason");
    expect(within(dialog).getByLabelText(/^Reason/)).toHaveAttribute("aria-invalid", "true");

    await user.type(within(dialog).getByLabelText(/^Reason/), "Research how to contact the CIO");
    await user.selectOptions(within(dialog).getByLabelText(/^Action type/), "research_contact_route");
    const form = within(dialog).getByRole("button", { name: "Save follow-up" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const data = await readAllData(await getDatabase());
    expect(data.followUps).toHaveLength(1);
    expect(data.followUps[0]).toMatchObject({
      personId: "person-sarah",
      reason: "Research how to contact the CIO",
      actionType: "research_contact_route",
      dueDate: today(),
      status: "pending"
    });
    expect(data.followUpEvents).toHaveLength(1);
    expect(data.followUpEvents[0]).toMatchObject({ kind: "created", followUpId: data.followUps[0]?.id });
  });

  it("warns non-blockingly when the person already has a future follow-up", async () => {
    await seedPerson();
    await seedFollowUp("person-sarah", addDaysToLocalDate(today(), 7));
    render(
      <FollowUpEditorSheet
        mode="create"
        personId="person-sarah"
        personName="Sarah Jones"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(await screen.findByRole("status")).toHaveTextContent("A future follow-up already exists");
    expect(screen.getByRole("button", { name: "Save follow-up" })).toBeEnabled();
  });

  it("uses the shared modal lifecycle and protects a dirty draft before closing", async () => {
    await seedPerson();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const view = render(
      <FollowUpEditorSheet
        mode="create"
        personId="person-sarah"
        personName="Sarah Jones"
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );
    const reason = screen.getByLabelText(/^Reason/);
    await user.type(reason, "A plan worth keeping");

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Close follow-up editor" }));
    expect(window.confirm).toHaveBeenCalledWith("Discard changes?");
    expect(onClose).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls.some(([event]) => event instanceof CustomEvent && event.type === "peopleos:modal-open")).toBe(true);
    view.unmount();
    expect(dispatch.mock.calls.some(([event]) => event instanceof CustomEvent && event.type === "peopleos:modal-close")).toBe(true);
  });

  it("snoozes an overdue follow-up from today while preserving its original date and history", async () => {
    await seedPerson();
    const originalDate = addDaysToLocalDate(today(), -5);
    const followUp = await seedFollowUp("person-sarah", originalDate);
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <FollowUpEditorSheet
        mode="snooze"
        personId="person-sarah"
        personName="Sarah Jones"
        followUp={followUp}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Snooze follow-up" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Tomorrow" })).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: "Next week" }));
    expect(within(dialog).getByLabelText(/^Snooze until/)).toHaveValue(addDaysToLocalDate(today(), 7));
    await user.click(within(dialog).getByRole("button", { name: "Confirm snooze" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const data = await readAllData(await getDatabase());
    expect(data.followUps).toHaveLength(1);
    expect(data.followUps[0]).toMatchObject({
      id: followUp.id,
      dueDate: originalDate,
      snoozedUntilDate: addDaysToLocalDate(today(), 7),
      status: "pending"
    });
    expect(data.followUpEvents.map((event) => event.kind).sort()).toEqual(["created", "snoozed"]);
  });

  it("completes with contact as one linked interaction and blocks an empty completion choice", async () => {
    await seedPerson();
    const followUp = await seedFollowUp("person-sarah");
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    render(
      <FollowUpCompletionSheet
        followUp={followUp}
        personName="Sarah Jones"
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Complete follow-up" });
    await waitFor(() => expect(within(dialog).getByRole("radio", { name: "I contacted them" })).toHaveFocus());
    await user.click(within(dialog).getByRole("button", { name: "Complete follow-up" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose how");

    await user.click(within(dialog).getByRole("radio", { name: "I contacted them" }));
    await user.selectOptions(within(dialog).getByLabelText(/^Interaction type/), "email");
    await user.type(within(dialog).getByLabelText(/^Summary/), "Shared the fellowship update");
    const form = within(dialog).getByRole("button", { name: "Complete follow-up" }).closest("form");
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    const data = await readAllData(await getDatabase());
    expect(data.followUps[0]).toMatchObject({ status: "completed" });
    expect(data.interactions).toHaveLength(1);
    expect(data.interactions[0]).toMatchObject({
      kind: "email",
      summary: "Shared the fellowship update",
      followUpId: followUp.id
    });
    expect(data.followUpEvents.filter((event) => event.kind === "completed_with_contact")).toHaveLength(1);
  });

  it("completes without contact without changing contact history", async () => {
    await seedPerson();
    const followUp = await seedFollowUp("person-sarah");
    const user = userEvent.setup();
    render(
      <FollowUpCompletionSheet
        followUp={followUp}
        personName="Sarah Jones"
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />
    );

    await user.click(screen.getByRole("radio", { name: "Completed without contacting them" }));
    expect(screen.getByText(/will not change the last-contact date/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete follow-up" }));

    await waitFor(async () => {
      const data = await readAllData(await getDatabase());
      expect(data.interactions).toHaveLength(1);
      expect(data.interactions[0]).toMatchObject({ kind: "follow_up_completed", followUpId: followUp.id });
      expect(data.followUpEvents.some((event) => event.kind === "completed_without_contact")).toBe(true);
    });
  });

  it("validates and saves a custom cadence from a real contact anchor without creating follow-up work", async () => {
    const person = await seedPerson();
    const occurredAt = new Date().toISOString();
    await createRepositories(await getDatabase()).interactions.create({
      id: "interaction-contact-anchor",
      revision: 1,
      personId: person.id,
      kind: "contacted",
      occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt
    });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CadenceEditorSheet person={person} onClose={vi.fn()} onSaved={onSaved} />);

    const dialog = screen.getByRole("dialog", { name: "Contact cadence" });
    await waitFor(() => expect(within(dialog).getByLabelText("Recurring cadence")).toHaveFocus());
    await user.selectOptions(within(dialog).getByLabelText("Recurring cadence"), "custom");
    const custom = within(dialog).getByLabelText("Contact cadence value");
    await waitFor(() => expect(custom).toHaveFocus());
    await user.type(custom, "0");
    await user.click(within(dialog).getByRole("button", { name: "Save cadence" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("whole number from 1 to 3650");
    expect(custom).toHaveAttribute("aria-invalid", "true");

    await user.clear(custom);
    await user.type(custom, "45");
    const form = within(dialog).getByRole("button", { name: "Save cadence" }).closest("form");
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const data = await readAllData(await getDatabase());
    expect(data.people[0]).toMatchObject({ id: person.id, revision: 2, contactCadence: { value: 45, unit: "days" } });
    expect(data.people[0].contactCadenceDays).toBeUndefined();
    expect(data.interactions).toEqual([expect.objectContaining({ kind: "contacted", personId: person.id })]);
    expect(data.followUps).toEqual([]);
    expect(data.followUpEvents).toEqual([]);
  });
});
