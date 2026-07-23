import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import TodayScreen from "./TodayScreen";
import { NextReminderSheet } from "./TodaySheets";
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

  it("shows the first-launch Today empty state when there are no people", async () => {
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Start with one person you want to remember." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import vCard" })).toBeInTheDocument();
  });

  it("shows the nobody-due state when people exist but nobody is eligible", async () => {
    await createRepositories(await getDatabase()).people.create(person("person-calm", "Calm Person"));
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Nothing needs your attention today." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find someone in People" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeInTheDocument();
  });

  it("shows the cleared state when every eligible person was deferred today", async () => {
    await seedDuePerson();
    await (await getDatabase()).put("todaySkips", {
      id: "person-sarah:2026-07-23",
      personId: "person-sarah",
      localDate: "2026-07-23",
      createdAt: NOW
    });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "You’ve cleared Today for now." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("renders the engine reason and exactly the three standard actions in order", async () => {
    await seedDuePerson();
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByText(/You planned to Reconnect with person-sarah/)).toBeInTheDocument();
    const actionGroup = within(card).getByRole("group", { name: "Actions for Sarah Jones" });
    expect(Array.from(actionGroup.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "Contact now",
      "Not today",
      "Already contacted"
    ]);
    expect(within(card).getByRole("button", { name: "Add phone number" })).toBeInTheDocument();
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
    await user.click(within(card).getByRole("button", { name: "Contact now" }));
    const dialog = await screen.findByRole("dialog", { name: "Contact Sarah Jones" });
    const methods = within(dialog).getAllByRole("button").filter((button) => /NHS email|Work mobile/.test(button.textContent ?? ""));
    expect(methods.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Email · NHS email"),
      expect.stringContaining("Call · Work mobile")
    ]);
    expect(within(dialog).getByText("Preferred")).toBeInTheDocument();
    await user.click(methods[0]);
    expect(handoff).toHaveBeenCalledWith("mailto:sarah@example.com");
    const refreshedCard = screen.getByRole("article", { name: "Sarah Jones" });
    await waitFor(() => expect(within(refreshedCard).getByRole("button", { name: "Contact now" })).toHaveFocus());
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
  });

  it("launches a sole email directly, keeps Add phone visible and makes no domain write", async () => {
    const id = "person-sarah";
    await seedDuePerson({ contacts: [contact(id, "email-only", "email", { label: "Personal email" })] });
    const handoff = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} handoff={handoff} />);
    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByRole("button", { name: "Add phone number" })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Contact now" }));
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
    await user.click(within(card).getByRole("button", { name: "Contact now" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("tel:+447900123456"));
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
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
    await user.click(within(card).getByRole("button", { name: "Contact now" }));
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
    const db = await getDatabase();
    const saved = await db.get("followUps", "follow-up-person-sarah-0");
    expect(saved).toMatchObject({ status: "pending", snoozedUntilDate: "2026-07-24" });
    expect(await db.get("todaySkips", "person-sarah:2026-07-23")).toBeDefined();
    expect(await db.getAll("interactions")).toHaveLength(0);
    expect(await db.getAllFromIndex("followUpEvents", "by-person", "person-sarah")).toHaveLength(1);
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

  it("dismisses Already contacted without writes, then retains other due plans when saving", async () => {
    await seedDuePerson({ extraFollowUp: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen navigate={vi.fn()} onAddFollowUp={vi.fn()} />);
    let card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Already contacted" }));
    let dialog = screen.getByRole("dialog", { name: "When should I remind you again?" });
    expect(within(dialog).getByRole("button", { name: "14 days" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByText("1 other plan remains due and may bring Sarah Jones back sooner.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await (await getDatabase()).getAll("interactions")).toHaveLength(0);
    card = screen.getByRole("article", { name: "Sarah Jones" });
    await waitFor(() => expect(within(card).getByRole("button", { name: "Already contacted" })).toHaveFocus());
    await user.click(within(card).getByRole("button", { name: "Already contacted" }));
    dialog = screen.getByRole("dialog", { name: "When should I remind you again?" });
    await user.click(within(dialog).getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    const db = await getDatabase();
    expect(await db.getAll("interactions")).toEqual([expect.objectContaining({ personId: "person-sarah", kind: "contacted" })]);
    const records = await db.getAllFromIndex("followUps", "by-person", "person-sarah");
    expect(records.filter((record) => record.status === "completed")).toHaveLength(1);
    expect(records.filter((record) => record.status === "pending" && record.dueDate === "2026-07-30")).toHaveLength(1);
    expect(records.find((record) => record.id === "follow-up-person-sarah-extra")).toMatchObject({ status: "pending" });
  });

  it("opens one focused unsaved phone row and returns to refreshed Today after save", async () => {
    await seedDuePerson();
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    let card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Contact now" }));
    expect(window.location.pathname).toBe("/people/person-sarah/contact-methods");
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
    await user.click(within(card).getByRole("button", { name: "Add phone number" }));
    phone = await screen.findByRole("textbox", { name: "Phone number" });
    await user.type(phone, "+447900123456");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    card = await screen.findByRole("article", { name: "Sarah Jones" });
    expect(within(card).queryByRole("button", { name: "Add phone number" })).not.toBeInTheDocument();
    expect(await (await getDatabase()).getAllFromIndex("contactMethods", "by-person", "person-sarah")).toHaveLength(1);
  });

  it("restores the second page and card focus after opening a profile", async () => {
    for (let index = 0; index < 6; index += 1) {
      await seedDuePerson({ id: `person-${index}`, name: `Person ${index + 1}`, index });
    }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    expect(await screen.findAllByRole("article")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Show more due people" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Person 6" }));
    expect(await screen.findByRole("heading", { name: "Person 6" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Today" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(await screen.findAllByRole("article")).toHaveLength(6);
    await waitFor(() => {
      expect(within(screen.getByRole("article", { name: "Person 6" })).getByRole("button", { name: "Contact now" })).toHaveFocus();
    });
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
    expect(screen.queryByRole("heading", { name: "Nothing needs your attention today." })).not.toBeInTheDocument();
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
