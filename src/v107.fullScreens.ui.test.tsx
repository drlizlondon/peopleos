import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FollowUpDetailScreen from "./FollowUpDetailScreen";
import UpcomingScreen from "./UpcomingScreen";
import App from "./App";
import {
  completeFollowUpWithContact,
  completeFollowUpWithoutContact,
  createCompleteFollowUpWithContactCommand,
  createCompleteFollowUpWithoutContactCommand,
  createFollowUp,
  createFollowUpDraft
} from "./application/followUps";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { addDaysToLocalDate } from "./domain/followUpPolicy";
import { DATABASE_NAME, type FollowUp, type LocalDate, type Person } from "./domain/schema";

function today(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedPerson(id: string, displayName: string, importance: Person["importance"] = "normal"): Promise<Person> {
  const now = new Date().toISOString();
  const person: Person = {
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  await createRepositories(await getDatabase()).people.create(person);
  return person;
}

async function seedFollowUp(
  personId: string,
  dueDate: LocalDate,
  reason: string,
  actionType: FollowUp["actionType"] = "other"
): Promise<FollowUp> {
  const draft = createFollowUpDraft(personId, { dueDate, actionType });
  return createFollowUp(await getDatabase(), { ...draft, reason }, {
    localDate: dueDate < today() ? dueDate : today()
  });
}

describe("V1-07 full FollowUp screens", () => {
  beforeEach(async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("keeps due plans out of Upcoming and applies filter drafts only on Show results", async () => {
    await seedPerson("person-sarah", "Sarah Jones", "high");
    await seedPerson("person-aaron", "Aaron Patel");
    await seedFollowUp("person-sarah", today(), "Send today’s update", "send_update");
    await seedFollowUp("person-sarah", addDaysToLocalDate(today(), 3), "Arrange coffee", "arrange_meeting");
    await seedFollowUp("person-aaron", addDaysToLocalDate(today(), 10), "Research contact route", "research_contact_route");

    const user = userEvent.setup();
    render(<UpcomingScreen navigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Arrange coffee" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Research contact route" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Send today’s update" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter" }));
    let dialog = await screen.findByRole("dialog", { name: "Filter follow-ups" });
    await waitFor(() => expect(within(dialog).getByLabelText("Date window")).toHaveFocus());
    await user.selectOptions(within(dialog).getByLabelText("Date window"), "next_7_days");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Research contact route" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter" }));
    dialog = await screen.findByRole("dialog", { name: "Filter follow-ups" });
    await user.selectOptions(within(dialog).getByLabelText("Date window"), "next_7_days");
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Research contact route" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Arrange coffee" })).toBeInTheDocument();
    expect(screen.getByText("1 filter applied.")).toBeInTheDocument();
  });

  it("distinguishes a due-only Upcoming state", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    await seedFollowUp("person-sarah", today(), "Send today’s update", "send_update");

    render(<UpcomingScreen navigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "No future follow-ups." })).toBeInTheDocument();
    expect(screen.getByText("You have 1 due follow-up. Upcoming only shows plans after today.")).toBeInTheDocument();
  });

  it("opens a Today-dated plan created from Upcoming instead of making it appear to vanish", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<UpcomingScreen navigate={navigate} />);
    await screen.findByRole("heading", { name: "Nothing planned yet." });

    const addButtons = screen.getAllByRole("button", { name: "Add follow-up" });
    expect(addButtons).toHaveLength(2);
    await user.click(addButtons[0]);
    const picker = await screen.findByRole("dialog", { name: "Choose a person" });
    await user.click(within(picker).getByRole("button", { name: /Sarah Jones/ }));
    const editor = await screen.findByRole("dialog", { name: "Plan a follow-up" });
    await user.type(within(editor).getByLabelText(/^Reason/), "Send today’s update");
    await user.click(within(editor).getByRole("button", { name: "Save follow-up" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/follow-ups\/follow-up-/)));
  });

  it("shows FollowUp lifecycle state and makes a cancelled plan read-only", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    const followUp = await seedFollowUp(
      "person-sarah",
      addDaysToLocalDate(today(), 7),
      "Send the promised notes",
      "send_update"
    );
    const user = userEvent.setup();
    render(
      <FollowUpDetailScreen
        followUpId={followUp.id}
        navigate={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { name: "Send the promised notes" })).toBeInTheDocument();
    expect(screen.getByText("Future pending")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Follow-up planned" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel follow-up" }));

    await waitFor(() => expect(screen.getByText("Cancelled")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Follow-up cancelled" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Follow-up actions" })).not.toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.followUps[0]).toMatchObject({ id: followUp.id, status: "cancelled" });
    expect(data.followUpEvents).toHaveLength(2);
    expect(data.followUpEvents.map((event) => event.kind)).toEqual(expect.arrayContaining(["created", "cancelled"]));
  });

  it("distinguishes completed-with-contact and completed-without-contact detail states", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    const withContact = await seedFollowUp("person-sarah", today(), "Send the update");
    const withoutContact = await seedFollowUp("person-sarah", today(), "Close the research task");
    const db = await getDatabase();
    await completeFollowUpWithContact(db, createCompleteFollowUpWithContactCommand(withContact, { kind: "email" }));
    await completeFollowUpWithoutContact(db, createCompleteFollowUpWithoutContactCommand(withoutContact));

    const view = render(
      <FollowUpDetailScreen followUpId={withContact.id} navigate={vi.fn()} onBack={vi.fn()} />
    );
    expect(within(await screen.findByRole("region", { name: "Current plan" }))
      .getByText("Completed with contact")).toBeInTheDocument();

    view.rerender(
      <FollowUpDetailScreen followUpId={withoutContact.id} navigate={vi.fn()} onBack={vi.fn()} />
    );
    expect(within(await screen.findByRole("region", { name: "Current plan" }))
      .getByText("Completed without contact")).toBeInTheDocument();
  });

  it("creates a plan and cadence from the Profile and keeps the Person follow-up view consistent", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah");
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Sarah Jones" });
    const personActions = screen.getByRole("group", { name: "Person actions" });
    await user.click(within(personActions).getByRole("button", { name: "Plan follow-up" }));
    let dialog = await screen.findByRole("dialog", { name: "Plan a follow-up" });
    await user.type(within(dialog).getByLabelText(/^Reason/), "Send the pilot update");
    await user.selectOptions(within(dialog).getByLabelText(/^Action type/), "send_update");
    const date = within(dialog).getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, addDaysToLocalDate(today(), 5));
    await user.click(within(dialog).getByRole("button", { name: "Save follow-up" }));

    const planCard = await screen.findByRole("heading", { name: "Current plan" });
    const planSection = planCard.closest("section");
    expect(planSection).not.toBeNull();
    expect(within(planSection!).getByText("Send the pilot update")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).followUps).toHaveLength(1);

    await user.click(within(personActions).getByRole("button", { name: "Cadence" }));
    dialog = await screen.findByRole("dialog", { name: "Contact cadence" });
    await user.selectOptions(within(dialog).getByLabelText("Recurring cadence"), "90");
    await user.click(within(dialog).getByRole("button", { name: "Save cadence" }));
    await waitFor(async () => {
      const data = await readAllData(await getDatabase());
      expect(data.people[0]?.contactCadenceDays).toBe(90);
      expect(data.followUps).toHaveLength(1);
    });

    await user.click(within(planSection!).getByRole("button", { name: "See all" }));
    expect(window.location.pathname).toBe("/people/person-sarah/follow-ups");
    expect(await screen.findByRole("heading", { name: "Follow-ups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send the pilot update" })).toBeInTheDocument();
  });

  it("makes Add follow-up the contextual first Global Add action from Upcoming", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    window.history.replaceState({}, "", "/upcoming");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Nothing planned yet." });

    await user.click(screen.getByRole("button", { name: "Add" }));
    const addSheet = await screen.findByRole("dialog", { name: "Add to PeopleOS" });
    const actionLabels = Array.from(addSheet.querySelectorAll(".global-add-actions > button"), (button) => button.textContent);
    expect(actionLabels[0]).toBe("Add follow-up");
    await user.click(within(addSheet).getByRole("button", { name: "Add follow-up" }));
    const picker = await screen.findByRole("dialog", { name: "Choose a person" });
    expect(within(picker).getByRole("button", { name: /Sarah Jones/ })).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: /Sarah Jones/ }));
    expect(await screen.findByRole("dialog", { name: "Plan a follow-up" })).toBeInTheDocument();
  });

  it("returns from a Person opened through Follow-up Detail to the same plan", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    const followUp = await seedFollowUp(
      "person-sarah",
      addDaysToLocalDate(today(), 4),
      "Share the fellowship notes"
    );
    window.history.replaceState({ fromPath: "/upcoming" }, "", `/follow-ups/${followUp.id}`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Share the fellowship notes" });
    await user.click(screen.getByRole("button", { name: "Sarah Jones" }));
    expect(window.location.pathname).toBe("/people/person-sarah");
    const back = await screen.findByRole("button", { name: "← Back to follow-up" });
    await user.click(back);
    await waitFor(() => expect(window.location.pathname).toBe(`/follow-ups/${followUp.id}`));
    expect(await screen.findByRole("heading", { name: "Share the fellowship notes" })).toBeInTheDocument();
  });
});
