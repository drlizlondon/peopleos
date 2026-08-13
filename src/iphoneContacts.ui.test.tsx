import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase, readAllData } from "./data/database";
import { createRepositories } from "./data/repositories";
import { DATABASE_NAME } from "./domain/schema";
import { fixedNow } from "./test/fixtures";

const contactMocks = vi.hoisted(() => ({
  supported: true,
  singlePickerSupported: true,
  pickContact: vi.fn(),
  pickContacts: vi.fn(),
  createContact: vi.fn()
}));

vi.mock("./contacts/capacitorAdapter", () => ({
  isIPhoneContactsSupported: () => contactMocks.supported,
  pickSingleIPhoneContact: (adapter: {
    pickContact?: () => Promise<unknown>;
    pickContacts: () => Promise<unknown>;
  }) => adapter.pickContact ? adapter.pickContact() : adapter.pickContacts(),
  getIPhoneContactsAdapter: () => {
    if (!contactMocks.supported) return undefined;
    return {
      ...(contactMocks.singlePickerSupported ? { pickContact: contactMocks.pickContact } : {}),
      pickContacts: contactMocks.pickContacts,
      createContact: contactMocks.createContact
    };
  }
}));

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

async function seedNameOnlyPerson(id = "person-profile-sarah", displayName = "Sarah") {
  const db = await getDatabase();
  await createRepositories(db).people.create({
    id,
    revision: 1,
    displayName,
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    relationshipMode: "personal",
    createdAt: fixedNow,
    updatedAt: fixedNow
  });
  window.history.replaceState({ fromPath: "/people" }, "", `/people/${id}`);
  return db;
}

describe("selective iPhone Contacts journeys", () => {
  beforeEach(async () => {
    await resetDatabase();
    window.history.replaceState({}, "", "/people/new");
    contactMocks.supported = true;
    contactMocks.singlePickerSupported = true;
    contactMocks.pickContact.mockReset();
    contactMocks.pickContacts.mockReset();
    contactMocks.createContact.mockReset();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("puts the native searchable iPhone contact picker first and sends its selection into the existing preview", async () => {
    contactMocks.pickContact.mockResolvedValue({
      status: "selected",
      contacts: [
        {
          displayName: "Dad",
          phoneNumbers: [
            { value: "+44 7900 123456", label: "Mobile" },
            { value: "+44 20 7946 0111", label: "Home" }
          ],
          emailAddresses: [{ value: "dad@example.com", label: "Personal" }]
        }
      ]
    });
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    const picker = screen.getByRole("button", { name: "Choose from iPhone Contacts" });
    expect(picker.compareDocumentPosition(screen.getByLabelText("Name")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import contacts" })).toBeInTheDocument();

    await user.click(picker);

    expect(contactMocks.pickContact).toHaveBeenCalledTimes(1);
    expect(contactMocks.pickContacts).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Review selected contacts" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/people/import");
    expect(document.querySelector(".import-summary-bar")).toHaveTextContent("1 selected from iPhone Contacts");
    expect(screen.getByText("+44 7900 123456")).toBeInTheDocument();
    expect(screen.getByText("+44 20 7946 0111")).toBeInTheDocument();
    expect(screen.getByText("dad@example.com")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Import Dad" })).toBeChecked();
  });

  it("saves one chosen iPhone contact before offering relationship setup", async () => {
    contactMocks.pickContact.mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Bibi Jones",
        phoneNumbers: [{ value: "+44 7912 345678", label: "Mobile" }],
        emailAddresses: [{ value: "bibi@example.com", label: "Personal" }]
      }]
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Choose from iPhone Contacts" }));
    await screen.findByRole("heading", { name: "Review selected contacts" });
    await user.click(screen.getByRole("button", { name: "Import selected (1)" }));

    expect(await screen.findByRole("heading", { name: "How do you want to keep in touch?" })).toBeInTheDocument();
    const data = await readAllData(await getDatabase());
    expect(data.people).toEqual([expect.objectContaining({ displayName: "Bibi Jones" })]);
    expect(data.contactMethods.map((contact) => contact.canonicalValue).sort()).toEqual([
      "+447912345678",
      "bibi@example.com"
    ]);
    expect(data.followUps).toEqual([]);
    expect(data.reachOutEntries).toEqual([]);
  });

  it("treats picker cancellation as a no-op", async () => {
    contactMocks.pickContact.mockResolvedValue({ status: "cancelled", contacts: [] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Choose from iPhone Contacts" }));
    await waitFor(() => expect(contactMocks.pickContact).toHaveBeenCalledTimes(1));
    expect(window.location.pathname).toBe("/people/new");
    expect(screen.getByRole("button", { name: "Add to PeopleOS" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not discard a partly completed manual person when Contacts is chosen", async () => {
    contactMocks.pickContact.mockResolvedValue({ status: "cancelled", contacts: [] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), "Draft Dad");
    await user.click(screen.getByRole("button", { name: "Choose from iPhone Contacts" }));

    expect(confirm).toHaveBeenCalledWith("Discard changes?");
    expect(contactMocks.pickContact).not.toHaveBeenCalled();
    expect(contactMocks.pickContacts).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Draft Dad");
    expect(window.location.pathname).toBe("/people/new");
  });

  it("keeps manual creation and file import available on the web fallback", async () => {
    contactMocks.supported = false;
    render(<App />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import contacts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose from iPhone Contacts" })).not.toBeInTheDocument();
    expect(screen.queryByText("Also save to iPhone Contacts")).not.toBeInTheDocument();
  });

  it("reopens iPhone Contacts for an existing Person and selectively merges chosen phones and emails", async () => {
    const db = await seedNameOnlyPerson();
    contactMocks.pickContact
      .mockResolvedValueOnce({
        status: "selected",
        contacts: [{
          displayName: "Sarah Jones",
          phoneNumbers: [
            { value: "+44 7900 123456", label: "Mobile" },
            { value: "+44 20 7946 0111", label: "Home" }
          ],
          emailAddresses: [
            { value: "sarah@example.com", label: "Personal" },
            { value: "sarah@work.example", label: "Work" }
          ],
          organisation: "PeopleOS",
          jobTitle: "Founder"
        }]
      })
      .mockResolvedValueOnce({ status: "cancelled", contacts: [] });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sarah" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add contact details" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));

    expect(contactMocks.pickContact).toHaveBeenCalledTimes(1);
    expect(contactMocks.pickContacts).not.toHaveBeenCalled();
    const review = await screen.findByRole("region", { name: "Add or update from iPhone Contacts" });
    const reviewHeading = within(review).getByRole("heading", { name: "Add or update from iPhone Contacts" });
    await waitFor(() => expect(reviewHeading).toHaveFocus());
    expect(reviewHeading).toHaveAttribute("tabindex", "-1");
    expect(within(review).getByText("Selected:").parentElement).toHaveTextContent("Sarah Jones");
    const detailsGroup = within(review).getByRole("group", { name: "Details to add" });
    expect(detailsGroup).toHaveClass("choice-fieldset");
    expect(within(review).getByRole("checkbox", { name: "Mobile: +44 7900 123456" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Home: +44 20 7946 0111" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Personal: sarah@example.com" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Work: sarah@work.example" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Organisation: PeopleOS · Founder" })).toBeChecked();
    await user.click(within(review).getByRole("checkbox", { name: "Home: +44 20 7946 0111" }));
    await user.click(within(review).getByRole("checkbox", { name: "Work: sarah@work.example" }));
    await user.click(within(review).getByRole("button", { name: "Add selected details to Sarah" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Contact details added to Sarah.");
    const data = await readAllData(db);
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ id: "person-profile-sarah", displayName: "Sarah", revision: 2 });
    expect(data.contactMethods).toHaveLength(2);
    expect(data.contactMethods.every((contact) => contact.personId === "person-profile-sarah")).toBe(true);
    expect(data.contactMethods.map((contact) => contact.canonicalValue).sort()).toEqual([
      "+447900123456",
      "sarah@example.com"
    ]);
    expect(data.affiliations).toMatchObject([{
      personId: "person-profile-sarah",
      organisationName: "PeopleOS",
      role: "Founder"
    }]);
    expect(contactMocks.createContact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));
    await waitFor(() => expect(contactMocks.pickContact).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Add or update from iPhone Contacts" })).not.toBeInTheDocument();
    expect((await readAllData(db)).contactMethods).toEqual(data.contactMethods);
  });

  it("uses iPhone Contacts to correct a missing Message destination without leaving Today", async () => {
    const db = await seedNameOnlyPerson("person-today-sarah", "Sarah Jones");
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await db.put("followUps", {
      id: "follow-up-today-sarah",
      revision: 1,
      personId: "person-today-sarah",
      dueDate: localDate,
      reason: "Catch up",
      actionType: "message",
      status: "pending",
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    contactMocks.pickContact.mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Sarah Jones",
        givenName: "Sarah",
        phoneNumbers: [{ value: "+44 7900 555555", label: "Mobile" }],
        emailAddresses: [{ value: "sarah.new@example.com", label: "Personal" }]
      }]
    });
    window.history.replaceState({}, "", "/");
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "Message" }));
    const messageSheet = await screen.findByRole("dialog", { name: "Can’t message Sarah" });
    expect(within(messageSheet).getByText("No usable phone number")).toBeInTheDocument();
    const draft = within(messageSheet).getByRole("textbox", { name: "Message" });
    await user.clear(draft);
    await user.type(draft, "My edited check-in for Sarah.");
    await user.click(within(messageSheet).getByRole("button", { name: "Choose from iPhone Contacts" }));

    expect(contactMocks.pickContact).toHaveBeenCalledTimes(1);
    const review = await screen.findByRole("region", { name: "Add or update from iPhone Contacts" });
    await user.click(within(review).getByRole("checkbox", { name: "Personal: sarah.new@example.com" }));
    await user.click(within(review).getByRole("button", { name: "Add selected details to Sarah Jones" }));

    const resumed = await screen.findByRole("dialog", { name: "Can’t message Sarah" });
    expect(within(resumed).getAllByText(/07900 555555|\+44 7900 555555/)).not.toHaveLength(0);
    expect(within(resumed).getByRole("textbox", { name: "Message" })).toHaveValue(
      "My edited check-in for Sarah."
    );
    expect(window.location.pathname).toBe("/");
    expect((await db.getAllFromIndex("contactMethods", "by-person", "person-today-sarah"))
      .map((contact) => contact.canonicalValue)).toEqual(["+447900555555"]);
  });

  it("lets the user choose one of several picker results without importing the others", async () => {
    const db = await seedNameOnlyPerson();
    contactMocks.singlePickerSupported = false;
    contactMocks.pickContacts.mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Sarah Old",
        phoneNumbers: [{ value: "+44 7900 111111" }],
        emailAddresses: []
      }, {
        displayName: "Sarah Jones",
        phoneNumbers: [{ value: "+44 7900 222222" }],
        emailAddresses: [{ value: "sarah@example.com" }]
      }]
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah" });

    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));
    const review = await screen.findByRole("region", { name: "Add or update from iPhone Contacts" });
    expect(within(review).getByRole("group", { name: "Choose the iPhone contact to add to Sarah" })).toBeInTheDocument();
    const contactOptions = within(review).getAllByRole("radio");
    contactOptions.forEach((option) => {
      expect(option).not.toBeChecked();
      expect(option).toBeRequired();
    });
    await waitFor(() => expect(contactOptions[0]).toHaveFocus());
    expect(within(review).getByRole("button", { name: "Add selected details to Sarah" })).toBeDisabled();
    await user.click(within(review).getByRole("radio", { name: "Sarah Jones" }));
    await user.click(within(review).getByRole("button", { name: "Add selected details to Sarah" }));

    await screen.findByText("Contact details added to Sarah.");
    const data = await readAllData(db);
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods.map((contact) => contact.canonicalValue).sort()).toEqual([
      "+447900222222",
      "sarah@example.com"
    ]);
  });

  it("allows the chosen picker row to use a detail shared only with another skipped picker row", async () => {
    const db = await seedNameOnlyPerson();
    contactMocks.singlePickerSupported = false;
    contactMocks.pickContacts.mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Old Sarah card",
        phoneNumbers: [],
        emailAddresses: [{ value: "shared@example.com" }]
      }, {
        displayName: "Sarah Jones",
        phoneNumbers: [{ value: "+44 7900 222222" }],
        emailAddresses: [{ value: "shared@example.com" }]
      }]
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah" });

    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));
    const review = await screen.findByRole("region", { name: "Add or update from iPhone Contacts" });
    await user.click(within(review).getByRole("radio", { name: "Sarah Jones" }));
    expect(within(review).getByRole("checkbox", { name: "Email: shared@example.com" })).toBeChecked();
    await user.click(within(review).getByRole("button", { name: "Add selected details to Sarah" }));

    await screen.findByText("Contact details added to Sarah.");
    const data = await readAllData(db);
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods.map((contact) => contact.canonicalValue).sort()).toEqual([
      "+447900222222",
      "shared@example.com"
    ]);
  });

  it("leaves the opened Person unchanged when profile contact selection is cancelled", async () => {
    const db = await seedNameOnlyPerson();
    contactMocks.pickContact.mockResolvedValue({ status: "cancelled", contacts: [] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah" });

    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));
    await waitFor(() => expect(contactMocks.pickContact).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("region", { name: "Add or update from iPhone Contacts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const data = await readAllData(db);
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods).toEqual([]);
  });

  it("does not move an exact phone duplicate from another Person while allowing safe selected details", async () => {
    const db = await seedNameOnlyPerson();
    const repositories = createRepositories(db);
    await repositories.people.create({
      id: "person-james",
      revision: 1,
      displayName: "James",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      relationshipMode: "personal",
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.contactMethods.create({
      id: "contact-james-phone",
      revision: 1,
      personId: "person-james",
      kind: "phone",
      rawValue: "+44 7900 333333",
      canonicalValue: "+447900333333",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    contactMocks.pickContact.mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Sarah Jones",
        phoneNumbers: [{ value: "+44 7900 333333", label: "Mobile" }],
        emailAddresses: [{ value: "sarah@example.com", label: "Personal" }]
      }]
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Sarah" });

    await user.click(screen.getByRole("button", { name: "Add or update from iPhone Contacts" }));
    const review = await screen.findByRole("region", { name: "Add or update from iPhone Contacts" });
    expect(within(review).getByRole("alert")).toHaveTextContent("Some details already belong to James");
    expect(within(review).getByRole("checkbox", { name: /Mobile: \+44 7900 333333 · Used by another person/ })).toBeDisabled();
    expect(within(review).getByRole("checkbox", { name: "Personal: sarah@example.com" })).toBeChecked();
    await user.click(within(review).getByRole("button", { name: "Add selected details to Sarah" }));

    await screen.findByText("Contact details added to Sarah.");
    const data = await readAllData(db);
    expect(data.people).toHaveLength(2);
    expect(data.contactMethods).toHaveLength(2);
    expect(data.contactMethods.find((contact) => contact.personId === "person-profile-sarah"))
      .toMatchObject({ kind: "email", canonicalValue: "sarah@example.com" });
    expect(data.contactMethods.find((contact) => contact.personId === "person-james"))
      .toMatchObject({ kind: "phone", canonicalValue: "+447900333333" });
  });

  it("does not create an Apple contact when details are linked to an existing PeopleOS person", async () => {
    const db = await getDatabase();
    const repositories = createRepositories(db);
    await repositories.people.create({
      id: "person-existing-sarah",
      revision: 1,
      displayName: "Sarah",
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      relationshipMode: "personal",
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    await repositories.contactMethods.create({
      id: "contact-existing-sarah-email",
      revision: 1,
      personId: "person-existing-sarah",
      kind: "email",
      rawValue: "shared@example.com",
      canonicalValue: "shared@example.com",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), "Sarah");
    await user.click(screen.getByText("Also save to iPhone Contacts"));
    await user.click(screen.getByRole("checkbox", { name: "Save this person to iPhone Contacts too" }));
    await user.type(screen.getByLabelText(/Email/), "shared@example.com");
    await user.type(screen.getByLabelText(/Mobile/), "+44 7912 654321");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    const duplicate = await screen.findByRole("dialog", { name: "Possible duplicate found" });
    await user.click(within(duplicate).getByText("Review details to add"));
    await user.click(within(duplicate).getByRole("button", { name: "Add selected details to Sarah" }));

    await waitFor(() => expect(window.location.pathname).toBe("/people/person-existing-sarah"), { timeout: 10_000 });
    let data = await readAllData(db);
    await waitFor(async () => {
      data = await readAllData(db);
      expect(data.contactMethods).toHaveLength(2);
    }, { timeout: 10_000 });
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods.map((contact) => contact.rawValue)).toContain("+44 7912 654321");
    expect(data.affiliations).toHaveLength(0);
    expect(contactMocks.createContact).not.toHaveBeenCalled();
  });

  it("keeps the PeopleOS person when Contacts permission is denied and retries only the native write", async () => {
    contactMocks.createContact
      .mockRejectedValueOnce(Object.assign(new Error("Denied"), { code: "permission_denied" }))
      .mockResolvedValueOnce({
        status: "created",
        contactIdentifier: "apple-contact-sarah"
      });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), "Sarah");
    await user.click(screen.getByText("Also save to iPhone Contacts"));
    await user.click(screen.getByRole("checkbox", { name: "Save this person to iPhone Contacts too" }));
    await user.type(screen.getByLabelText(/Mobile/), "+44 7912 123456");
    await user.type(screen.getByLabelText(/Email/), "sarah@example.com");
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByRole("heading", { name: "Your person is safe." })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sarah is saved in PeopleOS, but Contacts permission was denied. Allow PeopleOS to access Contacts in iPhone Settings, then try again."
    );
    let data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({ displayName: "Sarah", relationshipMode: "personal" });
    expect(data.contactMethods).toHaveLength(2);
    expect(data.affiliations).toHaveLength(0);
    expect(contactMocks.createContact).toHaveBeenCalledTimes(1);
    expect(contactMocks.createContact.mock.calls[0]?.[0]).toEqual({
      operationId: expect.stringMatching(/^iphone-contact-person-/),
      contact: {
        displayName: "Sarah",
        phoneNumbers: [{ value: "+44 7912 123456" }],
        emailAddresses: [{ value: "sarah@example.com" }]
      }
    });

    await user.click(screen.getByRole("button", { name: "Try iPhone Contacts again" }));
    expect(await screen.findByText("Sarah is already in PeopleOS.")).toBeInTheDocument();
    data = await readAllData(await getDatabase());
    expect(data.people).toHaveLength(1);
    expect(data.contactMethods).toHaveLength(2);
    expect(contactMocks.createContact).toHaveBeenCalledTimes(2);
    expect(contactMocks.createContact.mock.calls[1]?.[0].operationId)
      .toBe(contactMocks.createContact.mock.calls[0]?.[0].operationId);
  });

  it.each([
    {
      code: "permission_restricted",
      name: "Restricted Riley",
      message: "Restricted Riley is saved in PeopleOS, but iPhone Contacts are restricted on this device."
    },
    {
      code: "invalid_payload",
      name: "Invalid Ivy",
      message: "Invalid Ivy is saved in PeopleOS, but those contact details could not be added to iPhone Contacts."
    }
  ])("keeps $name in PeopleOS without offering a blind retry for $code", async ({ code, name, message }) => {
    contactMocks.createContact.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Name"), name);
    await user.click(screen.getByText("Also save to iPhone Contacts"));
    await user.click(screen.getByRole("checkbox", { name: "Save this person to iPhone Contacts too" }));
    await user.click(screen.getByRole("button", { name: "Add to PeopleOS" }));

    expect(await screen.findByRole("heading", { name: "Your person is safe." })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Try iPhone Contacts again" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect((await readAllData(await getDatabase())).people).toHaveLength(1);
    expect(contactMocks.createContact).toHaveBeenCalledTimes(1);
  });
});
