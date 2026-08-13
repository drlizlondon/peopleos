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
    window.history.replaceState({}, "", "/upcoming");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("shows each future scheduled person once and leaves people already due in Today", async () => {
    await seedPerson("person-sarah", "Sarah Jones", "high");
    await seedPerson("person-aaron", "Aaron Patel");
    await seedFollowUp("person-sarah", today(), "Send today’s update", "send_update");
    await seedFollowUp("person-sarah", addDaysToLocalDate(today(), 3), "Arrange coffee", "arrange_meeting");
    await seedFollowUp("person-aaron", addDaysToLocalDate(today(), 10), "Research contact route", "research_contact_route");

    render(<UpcomingScreen navigate={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "People coming up" });
    expect(within(list).getByRole("link", { name: /Aaron Patel/ })).toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: /Sarah Jones/ })).not.toBeInTheDocument();
    expect(within(list).queryByText("Send today’s update")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.queryByText("Action type")).not.toBeInTheDocument();
  });

  it("distinguishes a due-only Upcoming state", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    await seedFollowUp("person-sarah", today(), "Send today’s update", "send_update");

    render(<UpcomingScreen navigate={vi.fn()} />);
    expect(await screen.findByText("No one is scheduled yet.")).toBeInTheDocument();
    expect(screen.queryByText(/follow-up/i)).not.toBeInTheDocument();
  });

  it("is read-only and returns quietly to Today", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<UpcomingScreen navigate={navigate} />);
    await screen.findByText("No one is scheduled yet.");
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Today" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("opens an Upcoming person, brings them to Today, and preserves their future plan", async () => {
    const futureDate = addDaysToLocalDate(today(), 5);
    await seedPerson("person-bibi", "Bibi Jones");
    const future = await seedFollowUp("person-bibi", futureDate, "Catch up with Bibi", "message");
    const before = await readAllData(await getDatabase());
    const user = userEvent.setup();
    render(<App />);

    const upcoming = await screen.findByRole("list", { name: "People coming up" });
    expect(within(upcoming).queryByRole("button", { name: /Bring to Today/i })).not.toBeInTheDocument();
    await user.click(within(upcoming).getByRole("link", { name: /Bibi Jones/ }));

    expect(await screen.findByRole("heading", { name: "Bibi Jones" })).toBeInTheDocument();
    expect(screen.queryByText(/Promote/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring to Today" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(await screen.findByRole("article", { name: "Bibi Jones" })).toBeInTheDocument();
    const after = await readAllData(await getDatabase());
    expect(after.interactions).toEqual(before.interactions);
    expect(after.followUps.find((record) => record.id === future.id)).toEqual(future);
    expect(after.people.find((record) => record.id === "person-bibi")).toMatchObject({
      broughtToTodayDate: today()
    });
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
    expect(screen.getByText("Planned")).toBeInTheDocument();
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

  it("keeps stored schedules and frequency while the Profile no longer promotes follow-up planning", async () => {
    const person = await seedPerson("person-sarah", "Sarah Jones");
    await (await getDatabase()).put("people", {
      ...person,
      contactCadence: { value: 2, unit: "weeks" },
      updatedAt: new Date().toISOString()
    });
    await seedFollowUp("person-sarah", addDaysToLocalDate(today(), 5), "Send the pilot update");
    window.history.replaceState({ fromPath: "/people" }, "", "/people/person-sarah");
    render(<App />);

    await screen.findByRole("heading", { name: "Sarah Jones" });
    expect(screen.getByText("2 weeks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadence" })).not.toBeInTheDocument();
    expect((await readAllData(await getDatabase())).followUps).toEqual([
      expect.objectContaining({ reason: "Send the pilot update", status: "pending" })
    ]);
  });

  it("keeps legacy follow-up routes but removes planner entry points from Upcoming", async () => {
    await seedPerson("person-sarah", "Sarah Jones");
    window.history.replaceState({}, "", "/upcoming");
    render(<App />);
    await screen.findByText("No one is scheduled yet.");
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Relationship filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Plan a follow-up" })).not.toBeInTheDocument();
  });

  it("keeps a legacy Follow-up Detail reachable through browser history after opening its Person", async () => {
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
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe(`/follow-ups/${followUp.id}`));
    expect(await screen.findByRole("heading", { name: "Share the fellowship notes" })).toBeInTheDocument();
  });
});
