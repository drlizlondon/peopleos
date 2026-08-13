import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type Person } from "./domain/schema";
import { fixedNow } from "./test/fixtures";
import { OPEN_TODAY_FROM_NOTIFICATION_EVENT } from "./notifications/service";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function openCapture(user: ReturnType<typeof userEvent.setup>, throughPeople = false) {
  window.history.replaceState({}, "", throughPeople ? "/people" : "/people/new");
  render(<App />);
  if (throughPeople) await user.click(await within(screen.getByRole("main")).findByRole("button", { name: "Add someone" }));
  else await screen.findByRole("heading", { name: "Add someone" });
  expect(window.location.pathname).toBe("/people/new");
  return screen.getByLabelText("Name");
}

async function saveNewPerson(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
  await screen.findByRole("heading", { name: "How do you want to keep in touch?" }, { timeout: 10_000 });
  await user.click(await screen.findByRole("button", { name: /Regular contact/ }));
  await user.selectOptions(screen.getByLabelText("How often?"), "three-days");
  await user.click(screen.getByRole("button", { name: "Today" }));
  await user.click(screen.getByRole("button", { name: "Set regular contact" }));
}

describe("V1-03 manual person capture", () => {
  beforeEach(resetDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("creates a named person once even if the form submits twice", async () => {
    const user = userEvent.setup();
    const name = await openCapture(user, true);
    expect(name).not.toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    await user.type(name, "Simon");
    const replace = vi.spyOn(window.history, "replaceState");

    const form = screen.getByRole("button", { name: "Add to PeopleOS" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(await screen.findByRole("heading", { name: "How do you want to keep in touch?" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("Simon is already in PeopleOS.")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({
      displayName: "Simon",
      identityStatus: "confirmed"
    });
    expect(data.contactMethods).toHaveLength(0);
    expect(data.followUps).toHaveLength(0);
    expect(data.followUpEvents).toHaveLength(0);

    expect(replace).toHaveBeenCalledWith(
      expect.any(Object),
      "",
      expect.stringMatching(/^\/people\/[^/]+\/keep-in-touch$/)
    );
  });

  it("preserves a non-People capture origin through the saved Profile", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/");
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Name"), "Today person");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
    await screen.findByRole("heading", { name: "How do you want to keep in touch?" }, { timeout: 10_000 });
    await user.click(screen.getByRole("button", { name: "Close relationship setup" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect((await readAllData(await getDatabase())).people[0]?.displayName).toBe("Today person");
  });

  it("keeps first capture deliberately minimal and creates a person without optional data", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    expect(screen.getByLabelText(/Mobile/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.queryByLabelText("How often?")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "A description for now" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import contacts" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Sarah");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
    expect(await screen.findByText("Sarah is already in PeopleOS.")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ displayName: "Sarah", identityStatus: "confirmed" });
    expect(data.contactMethods).toHaveLength(0);
    expect(data.affiliations).toHaveLength(0);
    expect(data.interactions).toHaveLength(0);
    expect(data.followUps).toHaveLength(0);
  });

  it.each([
    ["Mobile", "+44 7912 345678", "+447912345678"],
    ["Email", "bibi@example.com", "bibi@example.com"]
  ] as const)("creates a %s-only Person and uses that identifier as the visible label", async (field, value, canonical) => {
    const user = userEvent.setup();
    await openCapture(user);
    await user.type(screen.getByLabelText(new RegExp(field)), value);
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByText(`${value} is already in PeopleOS.`)).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toEqual([expect.objectContaining({ displayName: value })]);
    expect(data.contactMethods).toEqual([expect.objectContaining({ canonicalValue: canonical })]);
    expect(data.followUps).toEqual([]);
  });

  it("rejects a completely blank identity without creating anything", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Add a name, mobile number or email address.");
    expect((await readAllData(await getDatabase())).people).toEqual([]);
    expect(window.location.pathname).toBe("/people/new");
  });

  it("saves the person first, then starts tomorrow in Upcoming", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    expect(screen.queryByRole("group", { name: "Lists" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Sam Taylor");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
    expect((await readAllData(await getDatabase())).followUps).toEqual([]);
    await user.click(await screen.findByRole("button", { name: /Regular contact/ }, { timeout: 10_000 }));
    await user.selectOptions(screen.getByLabelText("How often?"), "three-days");
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    expect(await screen.findByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Sam Taylor/ })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people[0]).toMatchObject({ relationshipMode: "personal" });
    expect(data.followUps[0]?.dueDate).not.toBe(data.followUps[0]?.createdAt.slice(0, 10));
  });

  it.each([
    ["daily", "Today", "Daily Today", "days", 1],
    ["daily", "Tomorrow", "Daily Tomorrow", "days", 1],
    ["weekly", "Today", "Weekly Today", "weeks", 1],
    ["weekly", "Tomorrow", "Weekly Tomorrow", "weeks", 1]
  ] as const)(
    "%s with Start %s is immediately visible in the correct schedule",
    async (frequency, start, name, unit, value) => {
      const user = userEvent.setup();
      await openCapture(user);
      await user.type(screen.getByLabelText("Name"), name);
      await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
      expect((await readAllData(await getDatabase())).people[0]?.contactCadence).toBeUndefined();
      await user.click(await screen.findByRole("button", { name: /Regular contact/ }));
      await user.selectOptions(screen.getByLabelText("How often?"), frequency);
      await user.click(screen.getByRole("button", { name: start }));
      await user.click(screen.getByRole("button", { name: "Set regular contact" }));

      if (start === "Today") {
        expect(await screen.findByRole("article", { name })).toBeInTheDocument();
      } else {
        expect(await screen.findByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
      }
      expect((await readAllData(await getDatabase())).people[0]?.contactCadence).toEqual({ value, unit });
    }
  );

  it("requires a start choice when an existing unanchored person first enables Regular contact", async () => {
    const person: Person = {
      id: "person-existing-unanchored",
      revision: 1,
      displayName: "Existing person",
      relationshipMode: "personal",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    await createRepositories(await getDatabase()).people.create(person);
    window.history.replaceState({ fromPath: `/people/${person.id}` }, "", `/people/${person.id}/edit`);
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(
      await screen.findByLabelText("How often do you want to contact them?"),
      "1-days"
    );
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Choose Start today or Start tomorrow.")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).people[0]?.contactCadence).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Existing person" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people[0]?.contactCadence).toEqual({ value: 1, unit: "days" });
    expect(data.followUps).toEqual([
      expect.objectContaining({ personId: person.id, suggestedByRule: "initial_schedule", status: "pending" })
    ]);
    expect(data.interactions).toEqual([]);
  });

  it("uses a genuine existing contact as the recurrence anchor without asking for Start", async () => {
    const person: Person = {
      id: "person-existing-contacted",
      revision: 1,
      displayName: "Already contacted",
      relationshipMode: "personal",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    };
    const repositories = createRepositories(await getDatabase());
    await repositories.people.create(person);
    await repositories.interactions.create({
      id: "interaction-existing-contact",
      revision: 1,
      personId: person.id,
      kind: "contacted",
      occurredAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    window.history.replaceState({ fromPath: `/people/${person.id}` }, "", `/people/${person.id}/edit`);
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(
      await screen.findByLabelText("How often do you want to contact them?"),
      "1-days"
    );
    expect(screen.queryByRole("group", { name: "Start" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Already contacted" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people[0]?.contactCadence).toEqual({ value: 1, unit: "days" });
    expect(data.interactions).toHaveLength(1);
    expect(data.followUps).toEqual([]);
  });

  it("moves a daily person from Today to tomorrow in Upcoming after Done", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    await user.type(screen.getByLabelText("Name"), "Daily contact");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
    await user.click(await screen.findByRole("button", { name: /Regular contact/ }));
    await user.selectOptions(screen.getByLabelText("How often?"), "daily");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Set regular contact" }));

    expect(await screen.findByRole("article", { name: "Daily contact" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(async () => expect(
      (await readAllData(await getDatabase())).followUps.some((followUp) =>
        followUp.status === "pending" && followUp.suggestedByRule === "today_already_contacted"
      )
    ).toBe(true));
    await user.click(await screen.findByRole("button", { name: "View upcoming" }));
    await waitFor(() => expect(window.location.pathname).toBe("/upcoming"), { timeout: 10_000 });
    expect(await screen.findByRole("link", { name: /Daily contact/ })).toBeInTheDocument();

    const data = await readAllData(await getDatabase());
    const pending = data.followUps.find((followUp) => followUp.status === "pending");
    expect(pending).toMatchObject({
      suggestedByRule: "today_already_contacted",
      dueDate: expect.any(String)
    });
    expect(pending?.dueDate).not.toBe(data.followUps.find((followUp) => followUp.suggestedByRule === "initial_schedule")?.dueDate);
    expect(data.interactions).toEqual([
      expect.objectContaining({ kind: "contacted", personId: data.people[0]?.id })
    ]);
  });

  it("rebases Start tomorrow if the Add form remains open across a Europe/London midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-12T22:59:00.000Z"));
      const user = userEvent.setup();
      await openCapture(user);
      await user.type(screen.getByLabelText("Name"), "Midnight person");
      await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
      await user.click(await screen.findByRole("button", { name: /Regular contact/ }));
      await user.selectOptions(screen.getByLabelText("How often?"), "three-days");
      await user.click(screen.getByRole("button", { name: "Tomorrow" }));

      vi.setSystemTime(new Date("2026-08-12T23:01:00.000Z"));
      await user.click(screen.getByRole("button", { name: "Set regular contact" }));
      expect(await screen.findByRole("link", { name: /Midnight person/ })).toBeInTheDocument();
      expect((await readAllData(await getDatabase())).followUps[0]?.dueDate).toBe("2026-08-14");
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns off the generated regular schedule without deleting its records or an independent reminder", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    await user.type(screen.getByLabelText("Name"), "Schedule Off");
    await saveNewPerson(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("link", { name: "People" }));
    await user.click(await screen.findByRole("link", { name: /Schedule Off/ }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.selectOptions(await screen.findByLabelText("How often do you want to contact them?", {}, { timeout: 10_000 }), "none");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "Schedule Off" })).toBeInTheDocument();
    const details = screen.getByRole("region", { name: "Person details" });
    expect(within(details).getByText("Not set")).toBeInTheDocument();
    expect(within(details).getByText(/Aug 20, 2026|20 Aug 2026/)).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people[0]?.contactCadence).toBeUndefined();
    expect(data.followUps).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "completed", suggestedByRule: "initial_schedule" }),
      expect.objectContaining({ status: "cancelled", suggestedByRule: "today_already_contacted" })
    ]));
    expect(data.followUps).toHaveLength(2);
    expect(data.followUpEvents.map((event) => event.kind).sort()).toEqual(["cancelled", "completed_with_contact", "created", "created"]);
  });

  it("cancels a dirty capture without creating any records", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await openCapture(user);
    await user.type(screen.getByLabelText("Name"), "Not saved");
    await user.click(screen.getByRole("button", { name: "← Cancel" }));

    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
    expect((await readAllData(await getDatabase())).people).toHaveLength(0);
  });

  it("queues a notification tap until an in-flight draft is safely saved", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openCapture(user);
    await user.type(screen.getByLabelText("Name"), "Saved before Today");

    window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));
    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    expect(window.location.pathname).toBe("/people/new");

    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect((await readAllData(await getDatabase())).people[0]?.displayName).toBe("Saved before Today");
  });

  it("retains the draft and uses the plain local-save error when storage fails", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    const name = screen.getByLabelText("Name");
    await user.type(name, "Retry me");
    await (await getDatabase()).delete("metadata", "app");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("PeopleOS could not save this yet.");
    expect(name).toHaveValue("Retry me");
    expect((await readAllData(await getDatabase())).people).toHaveLength(0);
  });

  it("manages contact details through add, edit, prefer and archive actions", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await openCapture(user);
    await user.type(screen.getByLabelText("Name"), "Mina");
    await saveNewPerson(user);
    await user.click(await screen.findByRole("button", { name: "Mina" }));
    await user.click(await screen.findByRole("button", { name: "Add contact details" }));

    await user.click(await screen.findByRole("button", { name: "Add email" }, { timeout: 10_000 }));
    await user.type(screen.getByLabelText("Email address"), "discard@example.com");
    confirm.mockReturnValueOnce(false);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add contact detail" })).toBeInTheDocument();
    confirm.mockReturnValueOnce(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add contact detail" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add email" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Add email" }));
    await user.type(screen.getByLabelText("Email address"), "one@example.com");
    await user.type(screen.getByLabelText(/^Label/), "Personal email");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    expect(await screen.findByText("one@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add email" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Add email" }));
    await user.type(screen.getByLabelText("Email address"), "two@example.com");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    const second = (await screen.findByText("two@example.com")).closest("li");
    expect(second).not.toBeNull();
    await user.click(within(second!).getByRole("button", { name: /preferred/ }));
    await waitFor(() => expect(within(screen.getByText("two@example.com").closest("li")!).getByText("Preferred email")).toBeInTheDocument());

    const first = screen.getByText("one@example.com").closest("li");
    await user.click(within(first!).getByRole("button", { name: /Edit one@example.com/ }));
    const editorValue = screen.getByLabelText("Email address");
    await user.clear(editorValue);
    await user.type(editorValue, "updated@example.com");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    expect(await screen.findByText("updated@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Edit updated@example.com/ })).toHaveFocus());

    const updated = screen.getByText("updated@example.com").closest("li");
    await user.click(within(updated!).getByRole("button", { name: /Remove updated@example.com/ }));
    expect(await screen.findByText("Contact detail removed.")).toBeInTheDocument();
    expect(await screen.findByText("Archived contact details (1)")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).contactMethods.find((contact) => contact.rawValue === "updated@example.com")?.archivedAt).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Contact detail removed.")).not.toBeInTheDocument());
    expect(screen.getByText("updated@example.com")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).contactMethods.find((contact) => contact.rawValue === "updated@example.com")?.archivedAt).toBeUndefined();
  });

  it("warns on a duplicate contact method and preserves the editor while the existing Person is inspected", async () => {
    const db = await getDatabase();
    const repositories = createRepositories(db);
    await repositories.people.create({
      id: "person-sarah",
      revision: 1,
      displayName: "Sarah Ahmed",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.people.create({
      id: "person-aaron",
      revision: 1,
      displayName: "Aaron Patel",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.contactMethods.create({
      id: "contact-aaron",
      revision: 1,
      personId: "person-aaron",
      kind: "email",
      rawValue: "shared@example.com",
      canonicalValue: "shared@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    const user = userEvent.setup();
    window.history.replaceState({ fromPath: "/people/person-sarah" }, "", "/people/person-sarah/contact-methods");
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Add email" }));
    await user.type(screen.getByLabelText("Email address"), " Shared@Example.com ");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));

    const warning = await screen.findByRole("dialog", { name: "Contact detail already used" });
    expect(within(warning).getByText("Same email address: shared@example.com")).toBeInTheDocument();
    expect((await readAllData(db)).contactMethods).toHaveLength(1);
    await user.click(within(warning).getByRole("button", { name: "Open existing person Aaron Patel" }));
    expect(await screen.findByRole("heading", { name: "Aaron Patel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Continue editing contact" }));

    expect(await screen.findByLabelText("Email address")).toHaveValue("Shared@Example.com");
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    const secondWarning = await screen.findByRole("dialog", { name: "Contact detail already used" });
    await repositories.people.create({
      id: "person-concurrent",
      revision: 1,
      displayName: "Concurrent colleague",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.contactMethods.create({
      id: "contact-concurrent",
      revision: 1,
      personId: "person-concurrent",
      kind: "email",
      rawValue: "shared@example.com",
      canonicalValue: "shared@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    await user.click(within(secondWarning).getByRole("button", { name: "Keep contact detail on Sarah Ahmed" }));
    const concurrentWarning = await screen.findByRole("dialog", { name: "Contact detail already used" });
    expect(await within(concurrentWarning).findByRole(
      "heading",
      { level: 4, name: "Concurrent colleague" },
      { timeout: 10_000 }
    )).toBeInTheDocument();
    await user.click(within(concurrentWarning).getByRole("button", { name: "Keep contact detail on Sarah Ahmed" }));
    expect(await screen.findByText("Shared@Example.com")).toBeInTheDocument();
    expect((await readAllData(db)).contactMethods).toHaveLength(3);
  });
});
