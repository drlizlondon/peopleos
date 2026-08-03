import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME } from "./domain/schema";
import { fixedNow } from "./test/fixtures";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function openCapture(user: ReturnType<typeof userEvent.setup>, throughPeople = false) {
  window.history.replaceState({}, "", throughPeople ? "/people" : "/people/new");
  render(<App />);
  if (throughPeople) await user.click(await screen.findByRole("button", { name: "Add person" }));
  else await screen.findByRole("heading", { name: "Add a person" });
  expect(window.location.pathname).toBe("/people/new");
  return screen.getByLabelText("Name");
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
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Simon" } });
    const replace = vi.spyOn(window.history, "replaceState");

    const form = screen.getByRole("button", { name: "Save person" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(await screen.findByRole("heading", { name: "Simon" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ displayName: "Simon", identityStatus: "confirmed" });
    expect(data.contactMethods).toHaveLength(0);

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ fromPath: "/people", navigationOrigin: true }),
      "",
      expect.stringMatching(/^\/people\/person-/)
    );
  });

  it("preserves a non-People capture origin through the saved Profile", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/");
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Add your first person" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Today person" } });
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByRole("heading", { name: "Today person" })).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ fromPath: "/" });
    await user.click(screen.getByRole("button", { name: "← Today" }));
    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("heading", { name: "You’re all caught up." })).toBeInTheDocument();
  });

  it.each([
    { kind: "phone" as const, value: "+447900123456", canonicalValue: "+447900123456" },
    { kind: "email" as const, value: " person@example.com ", canonicalValue: "person@example.com" }
  ])("creates a person with one inferred $kind contact method", async ({ kind, value, canonicalValue }) => {
    const user = userEvent.setup();
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: `${kind} person` } });
    fireEvent.change(screen.getByLabelText(/^Phone or email/), { target: { value } });
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByRole("heading", { name: `${kind} person` })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods).toHaveLength(1);
    expect(data.contactMethods[0]).toMatchObject({ kind, canonicalValue });
  });

  it("lets the user choose a phone region for an ambiguous national number", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "US contact" } });
    fireEvent.change(screen.getByLabelText(/^Phone or email/), { target: { value: "202 555 0123" } });
    const region = screen.getByLabelText("Phone region");
    expect(screen.getByText("+44")).toBeInTheDocument();
    expect(within(region).getByRole("option", { name: "United Kingdom +44" })).toBeInTheDocument();
    expect(within(region).getByRole("option", { name: "United States +1" })).toBeInTheDocument();
    await user.selectOptions(region, "US");
    expect(screen.getByText("+1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByRole("heading", { name: "US contact" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.contactMethods[0]).toMatchObject({
      kind: "phone",
      rawValue: "202 555 0123",
      canonicalValue: "+12025550123",
      region: "US"
    });
  });

  it("creates a provisional Person from only a descriptive label", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    await user.click(screen.getByText("More details"));
    await user.click(screen.getByRole("radio", { name: "A description for now" }));
    fireEvent.change(screen.getByLabelText("Temporary description"), {
      target: { value: "Chief Information Officer at Watford" }
    });
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByRole("heading", { name: "Chief Information Officer at Watford" })).toBeInTheDocument();
    expect(screen.getByText("Identity incomplete")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people[0]).toMatchObject({
      displayName: "Chief Information Officer at Watford",
      identityStatus: "provisional"
    });
  });

  it("cancels a dirty capture without creating any records", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Not saved" } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
    expect((await readAllData(await getDatabase())).people).toHaveLength(0);
  });

  it("retains the draft and uses the plain local-save error when storage fails", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Retry me" } });
    await (await getDatabase()).delete("metadata", "app");
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("PeopleOS could not save this yet.");
    expect(name).toHaveValue("Retry me");
    expect((await readAllData(await getDatabase())).people).toHaveLength(0);
  });

  it("adds and removes unsaved contact rows and validates malformed values inline", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Aaron" } });
    await user.click(screen.getByText("More details"));
    await user.click(screen.getByRole("button", { name: "Add email" }));
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove contact detail" }));
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();

    const email = screen.getByLabelText(/^Phone or email/);
    fireEvent.change(email, { target: { value: "not-an-email@" } });
    await user.click(screen.getByRole("button", { name: "Save person" }));

    expect(await screen.findByText("Enter a valid email address, such as name@example.com.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address, such as name@example.com.");
    expect((await readAllData(await getDatabase())).people).toHaveLength(0);

    fireEvent.change(email, { target: { value: "" } });
    const phone = screen.getByLabelText(/^Phone or email/);
    fireEvent.change(phone, { target: { value: "123" } });
    await user.click(screen.getByRole("button", { name: "Save person" }));
    expect(await screen.findByText("Enter a valid phone number, including the country code for international numbers.")).toBeInTheDocument();
    expect(phone).toHaveAttribute("aria-invalid", "true");
  });

  it("persists multiple contact methods, affiliation and met context as one capture", async () => {
    const user = userEvent.setup();
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sarah Ahmed" } });
    fireEvent.change(screen.getByLabelText(/^Phone or email/), { target: { value: "+447900123456" } });
    fireEvent.click(screen.getByText("More details"));
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "Personal mobile" } });
    fireEvent.click(screen.getByRole("button", { name: "Add mobile" }));
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "+44 7912 123456" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " Sarah@NHS.example " } });
    fireEvent.change(screen.getByLabelText(/^Organisation/), { target: { value: "NHS England" } });
    fireEvent.change(screen.getByLabelText(/^Where you met/), { target: { value: "HealthTech Fellowship" } });
    fireEvent.change(screen.getByLabelText(/^Role or job title/), { target: { value: "Clinical fellow" } });
    fireEvent.change(screen.getByLabelText(/^Tags/), { target: { value: "fellowship, clinician" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Remind me to stay in touch" }));
    fireEvent.change(screen.getByLabelText("How often?"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "date" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-01-15" } });
    await user.click(screen.getByRole("button", { name: "Save person" }));

    const profileHeading = await screen.findByRole("heading", { name: "Sarah Ahmed" });
    expect(profileHeading).toBeInTheDocument();
    expect(within(profileHeading.closest("header")!).getByText("Clinical fellow · NHS England")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent timeline" })).getByText("HealthTech Fellowship")).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({
      tags: ["fellowship", "clinician"],
      contactCadenceDays: 90,
      contactCadenceFirstDueDate: "2027-01-15"
    });
    expect(data.contactMethods).toHaveLength(3);
    expect(data.contactMethods.filter((contact) => contact.kind === "phone")).toHaveLength(2);
    expect(data.contactMethods.find((contact) => contact.kind === "email")).toMatchObject({
      rawValue: "Sarah@NHS.example",
      canonicalValue: "sarah@nhs.example"
    });
    expect(data.affiliations).toHaveLength(1);
    expect(data.interactions).toHaveLength(1);
  });

  it("manages contact details through add, edit, prefer and archive actions", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await openCapture(user);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mina" } });
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await screen.findByRole("heading", { name: "Mina" });
    await user.click(within(screen.getByRole("region", { name: "Contact details" })).getByRole("button", { name: "See all" }));

    await user.click(screen.getByRole("button", { name: "Add email" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "discard@example.com" } });
    confirm.mockReturnValueOnce(false);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add contact detail" })).toBeInTheDocument();
    confirm.mockReturnValueOnce(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add contact detail" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add email" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Add email" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "one@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "Personal email" } });
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    expect(await screen.findByText("one@example.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add email" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Add email" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "two@example.com" } });
    await user.click(screen.getByRole("button", { name: "Save contact detail" }));
    const second = (await screen.findByText("two@example.com")).closest("li");
    expect(second).not.toBeNull();
    await user.click(within(second!).getByRole("button", { name: /preferred/ }));
    await waitFor(() => expect(within(screen.getByText("two@example.com").closest("li")!).getByText("Preferred email")).toBeInTheDocument());

    const first = screen.getByText("one@example.com").closest("li");
    await user.click(within(first!).getByRole("button", { name: /Edit one@example.com/ }));
    const editorValue = screen.getByLabelText("Email address");
    fireEvent.change(editorValue, { target: { value: "updated@example.com" } });
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
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " Shared@Example.com " } });
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
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Contact detail already used" }))
      .getByRole("heading", { level: 4, name: "Concurrent colleague" })).toBeInTheDocument());
    const concurrentWarning = screen.getByRole("dialog", { name: "Contact detail already used" });
    await user.click(within(concurrentWarning).getByRole("button", { name: "Keep contact detail on Sarah Ahmed" }));
    expect(await screen.findByText("Shared@Example.com")).toBeInTheDocument();
    expect((await readAllData(db)).contactMethods).toHaveLength(3);
  });
});
