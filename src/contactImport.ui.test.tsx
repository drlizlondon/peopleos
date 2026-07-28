import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME, type ContactMethod, type OrganisationAffiliation, type Person } from "./domain/schema";
import { fixedNow } from "./test/fixtures";
import { MAX_VCARD_BYTES } from "./integrations/vcard";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

function vcardFile(contents: string, name = "contacts.vcf"): File {
  const bytes = new TextEncoder().encode(contents);
  const file = new File([bytes], name, { type: "text/vcard" });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  return file;
}

function card(body: string): string {
  return `BEGIN:VCARD\nVERSION:4.0\n${body}\nEND:VCARD\n`;
}

async function seedExistingPerson() {
  const repositories = createRepositories(await getDatabase());
  const person: Person = {
    id: "person-existing",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
  const phone: ContactMethod = {
    id: "contact-existing-phone",
    revision: 1,
    personId: person.id,
    kind: "phone",
    rawValue: "07900 123456",
    canonicalValue: "+447900123456",
    region: "GB",
    isPreferred: true,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
  const affiliation: OrganisationAffiliation = {
    id: "affiliation-existing",
    revision: 1,
    personId: person.id,
    organisationName: "NHS England",
    isCurrent: true,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
  await repositories.people.create(person);
  await repositories.contactMethods.create(phone);
  await repositories.affiliations.create(affiliation);
}

describe("V1-04 duplicate review and vCard import UI", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    await resetDatabase();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("exposes import from first-launch Today, People, and Settings without adding it to the global action", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Import Contacts" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import contacts" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "People" }));
    expect(await screen.findByRole("button", { name: "Import contacts" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByRole("link", { name: "Import contacts" })).toHaveAttribute("href", "/people/import");
    await user.click(screen.getByRole("link", { name: "Import contacts" }));
    expect(window.location.pathname).toBe("/people/import");
    expect(screen.getByLabelText("vCard file")).toHaveAttribute("accept", ".vcf,text/vcard,text/x-vcard");
  });

  it("returns to the Today, People, or Settings screen that opened import", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Import Contacts" }));
    await user.click(screen.getByRole("button", { name: "← Today" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));

    await user.click(screen.getByRole("link", { name: "People" }));
    await screen.findByRole("heading", { name: "Your people will appear here." });
    await user.click(screen.getByRole("button", { name: "Import contacts" }));
    await user.click(await screen.findByRole("button", { name: "← People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people"));

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("link", { name: "Import contacts" }));
    await user.click(await screen.findByRole("button", { name: "← Settings" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
  });

  it("warns before manual persistence, explains evidence, and deliberately creates a separate Person", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Different Sarah");
    await user.type(screen.getByLabelText("Phone number"), "+44 7900 123456");
    await user.click(screen.getByRole("button", { name: "Save person" }));

    const dialog = await screen.findByRole("dialog", { name: "Possible duplicate" });
    expect(within(dialog).getByText("Same phone number: +447900123456")).toBeInTheDocument();
    expect(within(dialog).getByText("Strong match")).toBeInTheDocument();
    expect(await (await getDatabase()).count("people")).toBe(1);
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();

    const repositories = createRepositories(await getDatabase());
    await repositories.people.create({
      id: "person-concurrent",
      revision: 1,
      displayName: "Concurrent Sarah",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.contactMethods.create({
      id: "contact-concurrent-phone",
      revision: 1,
      personId: "person-concurrent",
      kind: "phone",
      rawValue: "+447900123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });

    await user.click(within(dialog).getByRole("button", { name: "Create separate person" }));
    const concurrentHeading = await screen.findByRole("heading", { level: 4, name: "Concurrent Sarah" });
    const concurrentDialog = concurrentHeading.closest<HTMLElement>("[role='dialog']");
    expect(concurrentDialog).not.toBeNull();
    if (!concurrentDialog) throw new Error("Concurrent duplicate dialog was not rendered.");
    await user.click(within(concurrentDialog).getByRole("button", { name: "Create separate person" }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/people\/person-/));
    expect(await screen.findByRole("heading", { name: "Different Sarah" })).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).people).toHaveLength(3);
  });

  it("preserves an unsaved manual candidate while the user opens the existing Person", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({ fromPath: "/people" }, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Candidate Sarah");
    await user.type(screen.getByLabelText("Phone number"), "+447900123456");
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await user.click(await screen.findByRole("button", { name: "Open existing person Sarah Jones" }));

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Continue adding person" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Continue adding person" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people/new"));
    expect(await screen.findByLabelText("Name")).toHaveValue("Candidate Sarah");
    expect(screen.getByLabelText("Phone number")).toHaveValue("+447900123456");
    expect(await (await getDatabase()).count("people")).toBe(1);
  });

  it("uses browser Back to close duplicate review without discarding the manual draft", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people");
    window.history.pushState({ fromPath: "/people" }, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Candidate Sarah");
    await user.type(screen.getByLabelText("Phone number"), "+447900123456");
    await user.click(screen.getByRole("button", { name: "Save person" }));
    expect(await screen.findByRole("dialog", { name: "Possible duplicate" })).toBeInTheDocument();

    window.history.back();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Possible duplicate" })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/people/new");
    expect(screen.getByLabelText("Name")).toHaveValue("Candidate Sarah");
    expect(screen.getByLabelText("Phone number")).toHaveValue("+447900123456");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save person" })).toHaveFocus());
    expect(await (await getDatabase()).count("people")).toBe(1);
  });

  it("adds only checked new details to an existing Person without creating the candidate", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Sarah Jones");
    await user.type(screen.getByLabelText("Phone number"), "+447900123456");
    await user.click(screen.getByRole("button", { name: "Add email" }));
    await user.type(screen.getByLabelText("Email address"), "sarah@example.com");
    await user.click(screen.getByRole("button", { name: "Save person" }));

    const dialog = await screen.findByRole("dialog", { name: "Possible duplicate" });
    await user.click(within(dialog).getByText("Review details to add"));
    const emailChoice = within(dialog).getByRole("checkbox", { name: "Email: sarah@example.com" });
    expect(emailChoice).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Add selected details to Sarah Jones" }));

    await waitFor(() => expect(window.location.pathname).toBe("/people/person-existing"));
    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods).toHaveLength(2);
    expect(data.contactMethods.find((contact) => contact.kind === "email")).toMatchObject({ personId: "person-existing" });
    expect(data.interactions).toEqual([]);
  });

  it("offers a new role on an existing organisation as reviewed affiliation detail", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Sarah Jones");
    await user.type(screen.getByLabelText("Phone number"), "+447900123456");
    await user.type(screen.getByLabelText(/^Organisation/), "NHS England");
    await user.click(screen.getByText("More details"));
    await user.type(screen.getByLabelText(/^Role or job title/), "Chief Information Officer");
    await user.click(screen.getByRole("button", { name: "Save person" }));

    const dialog = await screen.findByRole("dialog", { name: "Possible duplicate" });
    expect(within(dialog).getByRole("region", { name: "New information" })).toHaveTextContent("NHS England · Chief Information Officer");
    expect(within(dialog).getByRole("region", { name: "Existing person" })).toHaveTextContent("Sarah Jones");
    await user.click(within(dialog).getByText("Review details to add"));
    expect(within(dialog).getByRole("checkbox", {
      name: "Organisation: NHS England · Chief Information Officer"
    })).toBeChecked();
  });

  it("keeps the transient import session while an existing profile is inspected", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile(card("FN:Sarah Jones\nTEL:+447900123456\nORG:NHS England")));
    await user.click(await screen.findByRole("button", { name: "Review duplicate for Sarah Jones" }));
    await user.click(screen.getByRole("button", { name: "Open existing person Sarah Jones" }));

    expect(await screen.findByRole("heading", { name: "Sarah Jones" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Continue import" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people/import"));
    expect(await screen.findByRole("button", { name: "Review duplicate for Sarah Jones" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "1 contacts in contacts.vcf")).toBeInTheDocument();
  });

  it("uses browser Back to close import duplicate review while preserving the import session", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people");
    window.history.pushState({ fromPath: "/people" }, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile(card("FN:Sarah Jones\nTEL:+447900123456")));
    await user.click(await screen.findByRole("button", { name: "Review duplicate for Sarah Jones" }));
    expect(await screen.findByRole("dialog", { name: "Possible duplicate" })).toBeInTheDocument();

    window.history.back();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Possible duplicate" })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/people/import");
    expect(await screen.findByLabelText("Name")).toHaveValue("Sarah Jones");
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "1 contacts in contacts.vcf")).toBeInTheDocument();
    expect(await (await getDatabase()).count("people")).toBe(1);
  });

  it("requires every preview row to have an explicit outcome before showing Results", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile([
      card("FN:Aaron Patel\nEMAIL:aaron@example.com"),
      card("FN:Sarah Jones\nTEL:+447900123456")
    ].join("")));

    expect(await screen.findByText("1 contact still needs a decision. Import selected contacts, resolve a possible duplicate, or skip the contact.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import selected (1)" })).toBeDisabled();
    const aaronSelection = screen.getByRole("checkbox", { name: "Import Aaron Patel" });
    await user.click(aaronSelection);
    expect(screen.getByText("2 contacts still need a decision. Import selected contacts, resolve a possible duplicate, or skip the contact.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View results" })).toBeDisabled();
    await user.click(aaronSelection);
    await user.click(screen.getByRole("button", { name: "Review duplicate for Sarah Jones" }));
    await user.click(await screen.findByRole("button", { name: "Skip this contact" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore Sarah Jones" })).toHaveFocus());
    expect(screen.getByText("Every contact has a clear import, skip, or failed outcome.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import selected (1)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Import selected (1)" }));

    expect(await screen.findByRole("heading", { name: "Your contacts were reviewed" })).toBeInTheDocument();
    const results = screen.getByLabelText("Import results");
    expect(within(within(results).getByText("Created").parentElement!).getByText("1", { selector: "dd" })).toBeInTheDocument();
    expect(within(within(results).getByText("Skipped").parentElement!).getByText("1", { selector: "dd" })).toBeInTheDocument();
  });

  it("warns about same-file matches without offering persisted-person actions", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile([
      card("FN:Aaron Patel\nEMAIL:shared@example.com"),
      card("FN:Aaron from the fellowship\nEMAIL:shared@example.com")
    ].join("")));

    await user.click(await screen.findByRole("button", { name: "Review duplicate for Aaron from the fellowship" }));
    const dialog = await screen.findByRole("dialog", { name: "Possible duplicate" });
    expect(within(dialog).getByRole("region", { name: "Other contact in this file" })).toHaveTextContent("Aaron Patel");
    expect(within(dialog).queryByRole("button", { name: /Open existing person/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Review details to add")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create separate person" })).toBeInTheDocument();
    expect(await (await getDatabase()).count("people")).toBe(0);
  });

  it("previews, reviews, imports, reports, and temporarily filters imported people", async () => {
    await seedExistingPerson();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    const file = vcardFile([
      card("FN:Aaron Patel\nEMAIL:aaron@example.com\nORG:PeopleOS"),
      card("FN:Sarah Jones\nTEL:+447900123456\nEMAIL:sarah.new@example.com\nORG:NHS England"),
      card("FN:<script>alert(1)</script>")
    ].join(""));
    await user.upload(await screen.findByLabelText("vCard file"), file);

    expect(await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "3 contacts in contacts.vcf")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs review 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready 2" })).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();

    const sarahRow = screen.getByRole("heading", { name: "Sarah Jones" }).closest("article");
    expect(sarahRow).not.toBeNull();
    await user.click(within(sarahRow!).getByRole("button", { name: "Review duplicate for Sarah Jones" }));
    const dialog = await screen.findByRole("dialog", { name: "Possible duplicate" });
    await user.click(within(dialog).getByText("Review details to add"));
    await user.click(within(dialog).getByRole("button", { name: "Add selected details to Sarah Jones" }));

    await user.click(screen.getByRole("button", { name: "Import selected (3)" }));
    expect(await screen.findByRole("heading", { name: "Your contacts were reviewed" })).toBeInTheDocument();
    const results = screen.getByLabelText("Import results");
    expect(within(results).getByText("2", { selector: "dd" })).toBeInTheDocument();
    expect(within(results).getByText("1", { selector: "dd" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View imported people" }));
    expect(await screen.findByRole("heading", { name: "Imported people" })).toBeInTheDocument();
    expect(screen.getByText("Aaron Patel")).toBeInTheDocument();
    expect(screen.getByText("Sarah Jones")).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).people).toHaveLength(3);
  });

  it("keeps invalid methods visible, allows explicit removal, and rejects malformed files without writes", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile(card("FN:Valid name\nEMAIL:not-an-email"), "invalid.vcf"));
    expect(await screen.findByText("Enter a valid email address, such as name@example.com.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Valid name" }));
    await user.click(screen.getByRole("button", { name: "Remove contact detail 1" }));
    await user.click(screen.getByRole("button", { name: "Check this contact" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Import Valid name" })).toBeChecked());
    await user.click(screen.getByRole("button", { name: "Import selected (1)" }));
    expect(await screen.findByText("Created")).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).contactMethods).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Import another file" }));
    await user.upload(screen.getByLabelText("vCard file"), vcardFile("not a vcard", "broken.vcf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("outside a BEGIN:VCARD and END:VCARD pair");
    expect((await readAllData(await getDatabase())).people).toHaveLength(1);
  });

  it("keeps the current preview when a replacement file cannot be parsed", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile(card("FN:Aaron Patel"), "good.vcf"));
    expect(await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "1 contacts in good.vcf")).toBeInTheDocument();

    await user.upload(screen.getByLabelText("vCard file"), vcardFile("not a vcard", "broken.vcf"));

    expect(await screen.findByRole("alert")).toHaveTextContent("outside a BEGIN:VCARD and END:VCARD pair");
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "1 contacts in good.vcf")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Import Aaron Patel" })).toBeChecked();
    expect(await (await getDatabase()).count("people")).toBe(0);
  });

  it("rejects an oversized file before reading it into memory", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    const oversized = new File(["x"], "oversized.vcf", { type: "text/vcard" });
    const read = vi.fn(async () => new ArrayBuffer(0));
    Object.defineProperty(oversized, "size", { configurable: true, value: MAX_VCARD_BYTES + 1 });
    Object.defineProperty(oversized, "arrayBuffer", { configurable: true, value: read });

    await user.upload(await screen.findByLabelText("vCard file"), oversized);

    expect(await screen.findByRole("alert")).toHaveTextContent(`no larger than ${MAX_VCARD_BYTES} bytes`);
    expect(read).not.toHaveBeenCalled();
    expect(await (await getDatabase()).count("people")).toBe(0);
  });

  it("cancels preview without persisting a Person", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.history.replaceState({}, "", "/people/import");
    render(<App />);
    await user.upload(await screen.findByLabelText("vCard file"), vcardFile(card("FN:Do not save")));
    expect(await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "1 contacts in contacts.vcf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← People" }));
    await waitFor(() => expect(window.location.pathname).toBe("/people"));
    expect((await readAllData(await getDatabase())).people).toEqual([]);
  });
});
