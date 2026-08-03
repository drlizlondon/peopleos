import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import TodayScreen from "./TodayScreen";
import { NextReminderSheet } from "./TodaySheets";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { listUpcomingCadences } from "./application/followUpQueries";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
import { createReachOut, prepareCreateReachOutCommand } from "./application/reachOut";
import * as todayQueries from "./application/todayQueries";
import type { ContactMethod, FollowUp, Person } from "./domain/schema";
import { DATABASE_NAME } from "./domain/schema";

const NOW = "2026-07-23T12:00:00.000Z";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

function person(id: string, displayName: string, index = 0): Person {
  return {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: `2025-01-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
    updatedAt: `2025-01-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`
  };
}

function followUp(personId: string, index = 0): FollowUp {
  return {
    id: `follow-up-${personId}-${index}`,
    revision: 1,
    personId,
    dueDate: `2026-07-${String(10 + index).padStart(2, "0")}`,
    reason: `Reconnect with ${personId}`,
    actionType: "other",
    status: "pending",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z"
  };
}

async function seedDuePerson(options: {
  id?: string;
  name?: string;
  index?: number;
  contacts?: ContactMethod[];
  extraFollowUp?: boolean;
} = {}) {
  const id = options.id ?? "person-sarah";
  const record = person(id, options.name ?? "Sarah Jones", options.index ?? 0);
  const repositories = createRepositories(await getDatabase());
  await repositories.people.create(record);
  await repositories.followUps.create(followUp(id, options.index ?? 0));
  if (options.extraFollowUp) {
    await repositories.followUps.create({
      ...followUp(id, 1),
      id: `follow-up-${id}-extra`,
      reason: "Send the promised introduction"
    });
  }
  for (const contact of options.contacts ?? []) await repositories.contactMethods.create(contact);
  return record;
}

function contact(
  personId: string,
  id: string,
  kind: "phone" | "email",
  options: { preferred?: boolean; label?: string; createdAt?: string } = {}
): ContactMethod {
  const createdAt = options.createdAt ?? "2026-07-01T10:00:00.000Z";
  const base = {
    id,
    revision: 1,
    personId,
    ...(options.label ? { label: options.label } : {}),
    isPreferred: options.preferred ?? false,
    createdAt,
    updatedAt: createdAt
  };
  return kind === "phone" ? {
    ...base,
    kind: "phone",
    rawValue: "07900 123456",
    canonicalValue: "+447900123456",
    region: "GB"
  } : {
    ...base,
    kind: "email",
    rawValue: "sarah@example.com",
    canonicalValue: "sarah@example.com"
  };
}

function moreActions(card: HTMLElement, personName: string): HTMLElement {
  const control = card.querySelector<HTMLElement>(".today-more-actions > summary");
  expect(control).not.toBeNull();
  expect(control).toHaveAccessibleName(`More actions for ${personName}`);
  return control!;
}

describe("V1-10 Today experience", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    window.history.replaceState({}, "", "/");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await resetDatabase();
  });

  it("shows the first-launch Today empty state when there are no people", async () => {
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Start with one person you want to remember." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Contacts" })).toBeInTheDocument();
  });

  it("shows a calm caught-up state when people exist but nobody is due", async () => {
    await createRepositories(await getDatabase()).people.create(person("person-calm", "Calm Person"));
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "You’re all caught up." })).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("shows caught up rather than first use when the selected view has no matching people", async () => {
    await createRepositories(await getDatabase()).people.create({
      ...person("person-personal", "Personal Person"),
      relationshipMode: "personal"
    });
    render(<TodayScreen activeMode="professional" navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "You’re all caught up." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Start with one person you want to remember." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add your first person" })).not.toBeInTheDocument();
  });

  it("shows the same calm caught-up state when every due person was deferred today", async () => {
    await seedDuePerson();
    await (await getDatabase()).put("todaySkips", {
      id: "person-sarah:2026-07-23",
      personId: "person-sarah",
      localDate: "2026-07-23",
      createdAt: NOW
    });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "You’re all caught up." })).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("shows only the lightweight Today details and four visible decision actions", async () => {
    await seedDuePerson();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByText(/Hi Sarah Jones, how are things with you/)).toBeInTheDocument();
    expect(within(card).queryByText(/Why (now|this person)/i)).not.toBeInTheDocument();
    expect(within(card).queryByText("Due today")).not.toBeInTheDocument();
    expect(within(card).queryByText("Overdue")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Planned for/i)).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
    const actionGroup = within(card).getByRole("group", { name: "Actions for Sarah Jones" });
    expect(Array.from(actionGroup.querySelectorAll(":scope > button"), (button) => button.textContent)).toEqual([
      "Message",
      "Call",
      "Contacted",
      "Not today"
    ]);
    expect(moreActions(card, "Sarah Jones")).toHaveTextContent("•••");
    await user.click(moreActions(card, "Sarah Jones"));
    const overflow = within(card).getByRole("group", { name: "More actions for Sarah Jones" });
    expect(within(overflow).getAllByRole("button").map((button) => button.textContent)).toEqual(["Add note"]);
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("changes only the starter and toggles an optional note without resolving Today", async () => {
    const record = await seedDuePerson();
    const repositories = createRepositories(await getDatabase());
    await repositories.people.update({ ...record, todayNote: "Ask how the appointment went" }, record.revision, NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    let card = await screen.findByRole("article", { name: "Sarah Jones" });
    const starter = within(card).getByText(/Sarah Jones.*you/);
    const firstStarter = starter.textContent;
    const anotherSuggestion = within(card).getByRole("button", { name: "Show another conversation suggestion for Sarah Jones" });
    expect(anotherSuggestion).toHaveTextContent("Another suggestion");
    expect(starter).toHaveAttribute("aria-live", "polite");
    expect(anotherSuggestion).toHaveAttribute("aria-controls", starter.id);
    await user.click(anotherSuggestion);
    expect(within(card).getByText(/Sarah Jones.*you/).textContent).not.toBe(firstStarter);
    await user.click(moreActions(card, "Sarah Jones"));
    const overflow = within(card).getByRole("group", { name: "More actions for Sarah Jones" });
    expect(within(overflow).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit note"]);
    const note = within(card).getByRole("checkbox", { name: "Mark note complete: Ask how the appointment went" });
    await user.click(note);
    await waitFor(() => {
      card = screen.getByRole("article", { name: "Sarah Jones" });
      expect(within(card).getByRole("checkbox", { name: "Mark note complete: Ask how the appointment went" })).toBeChecked();
    });
    expect(await (await getDatabase()).getAll("interactions")).toEqual([]);
    expect(await (await getDatabase()).get("followUps", "follow-up-person-sarah-0")).toMatchObject({ status: "pending" });
    await user.click(within(card).getByRole("checkbox", { name: "Mark note complete: Ask how the appointment went" }));
    await waitFor(() => {
      card = screen.getByRole("article", { name: "Sarah Jones" });
      expect(within(card).getByRole("checkbox", { name: "Mark note complete: Ask how the appointment went" })).not.toBeChecked();
    });
    await user.click(within(card).getByRole("checkbox", { name: "Mark note complete: Ask how the appointment went" }));
    card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Not today" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect((await (await getDatabase()).get("people", "person-sarah"))?.todayNoteCompletedAt).toBeDefined();
    expect(await (await getDatabase()).get("followUps", "follow-up-person-sarah-0")).toMatchObject({
      status: "pending",
      dueDate: "2026-07-10",
      snoozedUntilDate: "2026-07-24",
      reason: "Reconnect with person-sarah"
    });
  });

  it("opens a deterministic chooser, launches the chosen target and records nothing", async () => {
    const id = "person-sarah";
    await seedDuePerson({
      contacts: [
        contact(id, "phone-work", "phone", { label: "Work mobile", createdAt: "2026-07-01T09:00:00.000Z" }),
        contact(id, "email-nhs", "email", { label: "NHS email", preferred: true, createdAt: "2026-07-02T09:00:00.000Z" })
      ]
    });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    const dialog = await screen.findByRole("dialog", { name: "Contact Sarah Jones" });
    const methods = within(dialog).getAllByRole("button").filter((button) => /NHS email|Work mobile/.test(button.textContent ?? ""));
    expect(methods.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Email · NHS email"),
      expect.stringContaining("WhatsApp · Work mobile")
    ]);
    expect(within(dialog).getByText("Preferred")).toBeInTheDocument();
    await user.click(methods[0]);
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("mailto:sarah@example.com"));
    const refreshedCard = screen.getByRole("article", { name: "Sarah Jones" });
    await waitFor(() => expect(within(refreshedCard).getByRole("button", { name: "Message" })).toHaveFocus());
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("launches a sole email directly and makes no domain write", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "email-only", "email", { label: "Personal email" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledOnce());
    expect(handoff).toHaveBeenCalledWith("mailto:sarah@example.com");
    expect(screen.queryByRole("dialog", { name: "Contact Sarah Jones" })).not.toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("launches a sole phone directly with its canonical tel target", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "phone-only", "phone", { label: "Work mobile" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Call" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("tel:+447900123456"));
    expect(screen.getByRole("article", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("opens WhatsApp with the conversation starter and keeps the person in Today", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "phone-only", "phone", { label: "Mobile" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/447900123456\?text=.+/)));
    expect(screen.getByRole("article", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("keeps a failed external handoff in a chooser with Copy and contact-editing fallbacks", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "email-only", "email", { label: "Personal email" })] });
    const handoff = vi.fn().mockRejectedValue(new Error("unavailable"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TodayScreen navigate={navigate} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    const dialog = await screen.findByRole("dialog", { name: "Contact Sarah Jones" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Copy it, choose another option, or manage contact details/);
    await user.click(within(dialog).getByRole("button", { name: "Copy contact detail" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sarah@example.com"));
    expect(within(dialog).getByRole("button", { name: "Manage contact methods" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("moves an explicit plan to tomorrow with one tap and leaves no contact interaction", async () => {
    await seedDuePerson();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.dblClick(within(card).getByRole("button", { name: "Not today" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect(screen.getByText("Sarah Jones is off Today until tomorrow. You’re all caught up.")).toHaveAttribute("aria-live", "polite");
    const db = await getDatabase();
    const saved = await db.get("followUps", "follow-up-person-sarah-0");
    expect(saved).toMatchObject({ status: "pending", snoozedUntilDate: "2026-07-24" });
    expect(await db.get("todaySkips", "person-sarah:2026-07-23")).toBeDefined();
    expect(await db.getAll("interactions")).toHaveLength(0);
    expect(await db.getAllFromIndex("followUpEvents", "by-person", "person-sarah")).toHaveLength(1);
  });

  it("hides a Reach Out reminder only for today while keeping its active plan for tomorrow", async () => {
    const record = person("person-reach-out", "Reach Out Person");
    const db = await getDatabase();
    await createRepositories(db).people.create(record);
    const created = await createReachOut(db, prepareCreateReachOutCommand({
      person: record,
      reason: "Reconnect after the fellowship",
      reminderDate: "2026-07-23"
    }, { now: NOW, localDate: "2026-07-23" }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Reach Out Person" });
    await user.click(within(card).getByRole("button", { name: "Not today" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Reach Out Person" })).not.toBeInTheDocument());

    expect(await db.get("reachOutEntries", created.entry.id)).toMatchObject({
      intentStatus: "active",
      currentFollowUpId: created.followUp!.id
    });
    expect(await db.get("followUps", created.followUp!.id)).toMatchObject({
      status: "pending",
      reachOutEntryId: created.entry.id,
      snoozedUntilDate: "2026-07-24"
    });
    expect(await db.getAll("interactions")).toEqual([]);

    view.unmount();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("article", { name: "Reach Out Person" })).toBeInTheDocument();
  });

  it("creates one tomorrow plan when Not today handles a new-relationship recommendation", async () => {
    const repositories = createRepositories(await getDatabase());
    const record = person("person-new", "New Person");
    await repositories.people.create(record);
    await repositories.interactions.create({
      id: "interaction-met",
      revision: 1,
      personId: record.id,
      kind: "met",
      occurredAt: "2026-07-16T12:00:00.000Z",
      createdAt: "2026-07-16T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z"
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "New Person" });
    await user.click(within(card).getByRole("button", { name: "Not today" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "New Person" })).not.toBeInTheDocument());
    const created = await (await getDatabase()).getAllFromIndex("followUps", "by-person", record.id);
    expect(created).toEqual([expect.objectContaining({ dueDate: "2026-07-24", reason: "Reconnect with New Person", status: "pending" })]);
  });

  it("completes a one-off contact without asking for or creating another reminder", async () => {
    await seedDuePerson({ extraFollowUp: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "When should I remind you again?" })).not.toBeInTheDocument();
    const db = await getDatabase();
    expect(await db.getAll("interactions")).toEqual([expect.objectContaining({ personId: "person-sarah", kind: "contacted" })]);
    const records = await db.getAllFromIndex("followUps", "by-person", "person-sarah");
    expect(records.filter((record) => record.status === "completed")).toHaveLength(1);
    expect(records.filter((record) => record.status === "pending")).toHaveLength(1);
    expect(records.find((record) => record.id === "follow-up-person-sarah-extra")).toMatchObject({ status: "pending" });
  });

  it("restarts an expired paused reminder from Contacted using the saved Keep in touch interval", async () => {
    const regular = {
      ...person("person-regular", "Regular Person"),
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-23" as const,
      contactCadenceDeferredUntilDate: "2026-07-23" as const
    };
    await createRepositories(await getDatabase()).people.create(regular);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Regular Person" });
    await user.click(within(card).getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Regular Person" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "When should I remind you again?" })).not.toBeInTheDocument();
    const db = await getDatabase();
    expect(await db.getAllFromIndex("followUps", "by-person", regular.id)).toEqual([]);
    expect(await listUpcomingCadences(db, { localDate: "2026-07-23", activeMode: "personal" })).toEqual([
      expect.objectContaining({ person: expect.objectContaining({ id: regular.id }), effectiveDate: "2026-08-06", cadenceDays: 14 })
    ]);
  });

  it("announces the normal interval after Contacted clears a later finite deferral", async () => {
    const record = await seedDuePerson({ id: "person-deferred", name: "Deferred Person" });
    await createRepositories(await getDatabase()).people.update({
      ...record,
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-23",
      contactCadenceDeferredUntilDate: "2026-08-20"
    }, record.revision, NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Deferred Person" });
    await user.click(within(card).getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Deferred Person" })).not.toBeInTheDocument());
    expect(screen.getByText("Contact recorded. Next reminder: 06/08/2026. You’re all caught up.")).toHaveAttribute("aria-live", "polite");
  });

  it("announces the normal interval after Contacted clears a legacy indefinite pause", async () => {
    const record = await seedDuePerson({ id: "person-paused", name: "Paused Person" });
    await createRepositories(await getDatabase()).people.update({
      ...record,
      contactCadenceDays: 14,
      contactCadenceFirstDueDate: "2026-07-23",
      contactCadencePausedAt: NOW
    }, record.revision, NOW);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Paused Person" });
    await user.click(within(card).getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Paused Person" })).not.toBeInTheDocument());
    expect(screen.getByText("Contact recorded. Next reminder: 06/08/2026. You’re all caught up.")).toHaveAttribute("aria-live", "polite");
  });

  it("shows caught up immediately after Not today while the refreshed projection is still pending", async () => {
    await seedDuePerson();
    const initialProjection = await todayQueries.getTodayScreenProjection(
      await getDatabase(),
      createRelationshipClock({ now: NOW })
    );
    let resolveRefresh!: (projection: todayQueries.TodayScreenProjection) => void;
    const pendingRefresh = new Promise<todayQueries.TodayScreenProjection>((resolve) => {
      resolveRefresh = resolve;
    });
    const projectionSpy = vi.spyOn(todayQueries, "getTodayScreenProjection")
      .mockResolvedValueOnce(initialProjection)
      .mockReturnValueOnce(pendingRefresh);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(<TodayScreen navigate={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Not today" }));
    expect(await screen.findByRole("heading", { name: "You’re all caught up." })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument();
    expect(projectionSpy).toHaveBeenCalledTimes(2);
    view.unmount();
    resolveRefresh(initialProjection);
  });

  it("opens one focused unsaved phone row from Call and returns to refreshed Today after save", async () => {
    await seedDuePerson();
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    let card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Call" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people/person-sarah/contact-methods"));
    let phone = await screen.findByRole("textbox", { name: "Phone number" });
    expect(phone).toHaveFocus();
    expect(phone).toHaveValue("");
    await user.type(phone, "123");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    expect(await screen.findByText(/Enter a valid phone number/)).toBeInTheDocument();
    expect(phone).toHaveValue("123");
    await waitFor(() => expect(phone).toHaveFocus());
    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Add contact detail" })).toBeInTheDocument();
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(confirm).toHaveBeenCalledTimes(2);

    card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Call" }));
    phone = await screen.findByRole("textbox", { name: "Phone number" });
    await user.type(phone, "+447900123456");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(await (await getDatabase()).getAllFromIndex("contactMethods", "by-person", "person-sarah")).toHaveLength(1);
  });

  it("shows every due person and restores card focus after opening a profile", async () => {
    for (let index = 0; index < 6; index += 1) {
      await seedDuePerson({ id: `person-${index}`, name: `Person ${index + 1}`, index });
    }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findAllByRole("article")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Show more due people" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Person 6" }));
    expect(await screen.findByRole("heading", { name: "Person 6" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Today" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(await screen.findAllByRole("article")).toHaveLength(6);
    await waitFor(() => {
      expect(within(screen.getByRole("article", { name: "Person 6" })).getByRole("button", { name: "Message" })).toHaveFocus();
    });
  });

  it("does not announce caught up when processing the last valid card leaves an evaluation failure", async () => {
    await seedDuePerson();
    const getProjection = todayQueries.getTodayScreenProjection;
    vi.spyOn(todayQueries, "getTodayScreenProjection").mockImplementation(async (db, clock, activeMode) => ({
      ...await getProjection(db, clock, activeMode),
      evaluationIssues: [{ personId: "person-unchecked", displayName: "Unchecked Person" }]
    }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Not today" }));
    expect(await screen.findByRole("heading", { name: "Today could not check every relationship." })).toBeInTheDocument();
    expect(screen.getByText("Sarah Jones is off Today until tomorrow.")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText(/You’re all caught up/)).not.toBeInTheDocument();
  });

  it("does not present an ordinary nobody-due empty state when evaluation failed", async () => {
    const repositories = createRepositories(await getDatabase());
    await repositories.people.create(person("person-unchecked", "Unchecked Person"));
    const actual = await todayQueries.getTodayScreenProjection(await getDatabase(), createRelationshipClock({ now: NOW }));
    vi.spyOn(todayQueries, "getTodayScreenProjection").mockResolvedValue({
      ...actual,
      cards: [],
      result: { ...actual.result, orderedItems: [], totalCount: 0 },
      evaluationIssues: [{ personId: "person-unchecked", displayName: "Unchecked Person" }]
    });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByText("One relationship could not be evaluated")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today could not check every relationship." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "You’re all caught up." })).not.toBeInTheDocument();
  });
});

describe("V1-10 next-reminder retry state", () => {
  it("keeps a failed choice selected and retries that exact date", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const retry = vi.fn();
    render(
      <NextReminderSheet
        personName="Sarah Jones"
        todayDate="2026-07-23"
        defaultDays={14}
        attemptedDate="2026-07-30"
        additionalDueCount={0}
        saving={false}
        error="PeopleOS could not save this yet."
        onChooseDate={choose}
        onRetry={retry}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "14 days" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });

  it("rejects today in the date picker, retains the value and returns focus", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(
      <NextReminderSheet
        personName="Sarah Jones"
        todayDate="2026-07-23"
        defaultDays={14}
        additionalDueCount={0}
        saving={false}
        onChooseDate={choose}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "Pick a date…" }));
    const date = screen.getByLabelText("Reminder date");
    await user.type(date, "2026-07-23");
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a date after today.");
    expect(date).toHaveValue("2026-07-23");
    await waitFor(() => expect(date).toHaveFocus());
    expect(choose).not.toHaveBeenCalled();
  });

  it("shows a configured custom interval with its deterministic resulting date", () => {
    render(
      <NextReminderSheet
        personName="Sarah Jones"
        todayDate="2026-07-23"
        defaultDays={21}
        additionalDueCount={0}
        saving={false}
        onChooseDate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "In 21 days · 13 August 2026" })).toHaveAttribute("aria-pressed", "true");
  });
});
