import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import TodayScreen from "./TodayScreen";
import { NextReminderSheet, PauseTodaySheet } from "./TodaySheets";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { createRepositories } from "./data/repositories";
import { createRelationshipClock } from "./application/relationshipEngineQueries";
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

  it("keeps the compact destination heading visible while Today loads", () => {
    vi.spyOn(todayQueries, "getTodayScreenProjection").mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);

    const heading = screen.getByText("Today", { selector: "h2" }).closest(".page-heading");
    expect(heading).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Today…");
    unmount();
  });

  it("shows the first-launch Today empty state when there are no people", async () => {
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Who do you want to remember?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add someone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Contacts" })).not.toBeInTheDocument();
  });

  it("shows a calm caught-up state when people exist but nobody is due", async () => {
    await createRepositories(await getDatabase()).people.create(person("person-calm", "Calm Person"));
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "That’s everyone for today." })).toBeInTheDocument();
    expect(screen.getByText("PeopleOS will bring someone back to mind when the time is right.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View upcoming" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("shows caught up rather than first use when the selected view has no matching people", async () => {
    await createRepositories(await getDatabase()).people.create({
      ...person("person-personal", "Personal Person"),
      relationshipMode: "personal"
    });
    render(<TodayScreen activeMode="professional" navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "That’s everyone for today." })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "That’s everyone for today." })).toBeInTheDocument();
    expect(screen.getByText("PeopleOS will bring someone back to mind when the time is right.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("shows one deterministic conversation starter and cycles it accessibly", async () => {
    await seedDuePerson();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    const starter = within(card).getByText("“Hi Sarah Jones, how are things with you?”");
    const another = within(card).getByRole("button", { name: "Show another conversation starter for Sarah Jones" });
    expect(another).toHaveAttribute("aria-controls", starter.id);
    await user.click(another);
    expect(within(card).getByText("“Hey Sarah Jones, just thinking of you today.”")).toHaveAttribute("aria-live", "polite");
    expect(within(card).queryByText(/last contacted|last spoke|days ago/i)).not.toBeInTheDocument();
  });

  it("renders explicit Message and Call actions without making secondary actions compete", async () => {
    await seedDuePerson();
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    const actionGroup = within(card).getByRole("group", { name: "Actions for Sarah Jones" });
    expect(Array.from(actionGroup.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "Message",
      "Call",
      "Done"
    ]);
    expect(within(card).queryByRole("button", { name: "Already contacted" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Not today" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Why this person?" })).not.toBeInTheDocument();
  });

  it("lets Message choose WhatsApp or email, opens only a draft and records nothing", async () => {
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
    expect(within(dialog).getByText("WhatsApp opens with a draft. Nothing is sent until you press Send.")).toBeInTheDocument();
    await user.click(methods[1]);
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(
      `https://wa.me/447900123456?text=${encodeURIComponent("Hi Sarah Jones, how are things with you?")}`
    ), { timeout: 10_000 });
    const refreshedCard = screen.getByRole("article", { name: "Sarah Jones" });
    await waitFor(() => expect(within(refreshedCard).getByRole("button", { name: "Message" })).toHaveFocus());
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("launches a sole email directly without cluttering the card and makes no domain write", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "email-only", "email", { label: "Personal email" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledOnce());
    expect(handoff).toHaveBeenCalledWith(
      `mailto:sarah@example.com?body=${encodeURIComponent("Hi Sarah Jones, how are things with you?")}`
    );
    expect(screen.queryByRole("dialog", { name: "Contact Sarah Jones" })).not.toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("takes Call to add a phone when only email is available", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "email-only", "email", { label: "Personal email" })] });
    const navigate = vi.fn();
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={navigate} onAddFollowUp={vi.fn()} handoff={handoff} />);

    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Call" }));

    expect(handoff).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      "/people/person-sarah/contact-methods",
      expect.objectContaining({
        state: expect.objectContaining({ autoAddPhone: true, fromPath: "/" })
      })
    ), { timeout: 10_000 });
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("opens a sole phone as a WhatsApp draft for Message and as tel for Call", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "phone-only", "phone", { label: "Work mobile" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(
      `https://wa.me/447900123456?text=${encodeURIComponent("Hi Sarah Jones, how are things with you?")}`
    ));
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
    const handoff = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<TodayScreen navigate={navigate} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    const dialog = await screen.findByRole("dialog", { name: "Contact Sarah Jones" });
    const draftHref = `mailto:sarah@example.com?body=${encodeURIComponent("Hi Sarah Jones, how are things with you?")}`;
    expect(handoff).toHaveBeenNthCalledWith(1, draftHref);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Copy it, choose another option, or manage contact details/);
    await user.click(within(dialog).getByRole("button", { name: "Copy contact detail" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sarah@example.com"));
    expect(within(dialog).getByRole("button", { name: "Manage contact methods" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(card).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(handoff).toHaveBeenNthCalledWith(2, draftHref));
    expect(screen.getByRole("article", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("marks a due person Done once and uses the safe default when no contact frequency is stored", async () => {
    await seedDuePerson();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.dblClick(within(card).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "That’s everyone for today." })).toBeInTheDocument();
    const db = await getDatabase();
    const records = await db.getAllFromIndex("followUps", "by-person", "person-sarah");
    expect(records.filter((record) => record.status === "completed")).toHaveLength(1);
    expect(records.filter((record) => record.status === "pending")).toEqual([
      expect.objectContaining({ dueDate: "2026-08-06" })
    ]);
    expect(await db.getAll("interactions")).toEqual([
      expect.objectContaining({ personId: "person-sarah", kind: "contacted" })
    ]);
  });

  it("uses the person’s contact frequency when Done schedules the next contact", async () => {
    const record = await seedDuePerson();
    const db = await getDatabase();
    await db.put("people", { ...record, contactCadence: { value: 3, unit: "days" } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    const created = await db.getAllFromIndex("followUps", "by-person", record.id);
    expect(created.filter((followUp) => followUp.status === "pending")).toEqual([
      expect.objectContaining({ dueDate: "2026-07-26", status: "pending" })
    ]);
  });

  it("pauses a due Person for one week without changing their frequency, plans or contact history", async () => {
    const record = await seedDuePerson({ extraFollowUp: true });
    const db = await getDatabase();
    await db.put("people", { ...record, contactCadence: { value: 3, unit: "days" } });
    const followUpsBefore = await db.getAllFromIndex("followUps", "by-person", record.id);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });

    await user.click(within(card).getByRole("button", { name: "Pause" }));
    let dialog = screen.getByRole("dialog", { name: "Pause from Today" });
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "×", "1 week", "1 month", "Choose date", "Cancel"
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Pause" })).toHaveFocus());

    await user.click(within(card).getByRole("button", { name: "Pause" }));
    dialog = screen.getByRole("dialog", { name: "Pause from Today" });
    await user.click(within(dialog).getByRole("button", { name: "1 week" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());

    expect(await db.get("people", record.id)).toMatchObject({
      contactCadence: { value: 3, unit: "days" },
      todayPausedUntilDate: "2026-07-30"
    });
    expect(await db.getAllFromIndex("followUps", "by-person", record.id)).toEqual(followUpsBefore);
    expect(await db.getAll("interactions")).toEqual([]);
    expect(await db.get("todaySkips", "person-sarah:2026-07-23")).toBeDefined();
  });

  it("completes a legacy Reach Out card without creating another Reach Out plan", async () => {
    const record = await seedDuePerson();
    const db = await getDatabase();
    const due = (await db.get("followUps", "follow-up-person-sarah-0"))!;
    await db.put("followUps", { ...due, reachOutEntryId: "reach-out-sarah" });
    await db.put("reachOutEntries", {
      id: "reach-out-sarah",
      revision: 1,
      personId: record.id,
      reason: "Catch up",
      intendedActionType: "other",
      intentStatus: "active",
      currentFollowUpId: due.id,
      contextIds: [],
      addedAt: "2026-07-01T09:00:00.000Z",
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z"
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    const completedEntry = await db.get("reachOutEntries", "reach-out-sarah");
    expect(completedEntry).toMatchObject({ intentStatus: "completed" });
    expect(completedEntry).not.toHaveProperty("currentFollowUpId");
    expect((await db.getAllFromIndex("followUps", "by-person", record.id))
      .filter((followUp) => followUp.status === "pending")).toEqual([]);
    expect(await db.getAll("interactions")).toEqual([
      expect.objectContaining({ personId: record.id, kind: "contacted" })
    ]);
  });

  it("opens one unfocused phone row and returns to refreshed Today after save", async () => {
    await seedDuePerson();
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    let card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    await waitFor(
      () => expect(window.location.pathname).toBe("/people/person-sarah/contact-methods"),
      { timeout: 10_000 }
    );
    let phone = await screen.findByRole("textbox", { name: "Phone number" });
    expect(phone).not.toHaveFocus();
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
    expect(await screen.findAllByRole("article")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Show more people" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
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
    await user.click(within(card).getByRole("button", { name: "Pause" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Pause from Today" })).getByRole("button", { name: "1 week" }));
    expect(await screen.findByRole("heading", { name: "Today could not check everyone." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "That’s everyone for today." })).not.toBeInTheDocument();
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
    expect(await screen.findByText("One person could not be checked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today could not check everyone." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "That’s everyone for today." })).not.toBeInTheDocument();
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

describe("Today Pause choices", () => {
  it("uses a clamped calendar month and rejects a custom date that is not after today", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    render(
      <PauseTodaySheet
        personName="Sarah Jones"
        todayDate="2026-01-31"
        saving={false}
        onChooseDate={choose}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "1 month" }));
    expect(choose).toHaveBeenCalledWith("2026-02-28");

    await user.click(screen.getByRole("button", { name: "Choose date" }));
    const date = screen.getByLabelText("Return to Today");
    await user.type(date, "2026-01-31");
    await user.click(screen.getByRole("button", { name: "Pause until this date" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a date after today.");
    await waitFor(() => expect(date).toHaveFocus());
    expect(choose).toHaveBeenCalledTimes(1);
  });
});
