import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import ReachOutScreen from "./ReachOutScreen";
import { removeReachOut } from "./application/reachOut";
import {
  getContactNowProjection,
  revalidateContactNowTarget,
  type ContactNowTarget
} from "./application/contactNow";
import {
  addContactMethod,
  createContactMethodDraft,
  editContactMethod,
  listContactMethodsForPerson
} from "./application/contactMethods";
import {
  importSelectedContacts,
  prepareContactImportFromPickerResult,
  type ContactImportSession
} from "./application/contactImport";
import { getAppSettings } from "./application/peopleQueries";
import { listReachOut, type ReachOutListItem } from "./application/reachOutQueries";
import {
  getIPhoneContactsAdapter,
  isIPhoneContactsSupported,
  pickSingleIPhoneContact
} from "./contacts/capacitorAdapter";
import { getDatabase } from "./data/client";
import type { ContactMethod, Person } from "./domain/schema";

vi.mock("./data/client", () => ({ getDatabase: vi.fn() }));
vi.mock("./application/reachOutQueries", async () => {
  const actual = await vi.importActual<typeof import("./application/reachOutQueries")>("./application/reachOutQueries");
  return { ...actual, listReachOut: vi.fn() };
});
vi.mock("./application/contactNow", async () => {
  const actual = await vi.importActual<typeof import("./application/contactNow")>("./application/contactNow");
  return {
    ...actual,
    getContactNowProjection: vi.fn(),
    revalidateContactNowTarget: vi.fn()
  };
});
vi.mock("./application/reachOut", async () => {
  const actual = await vi.importActual<typeof import("./application/reachOut")>("./application/reachOut");
  return { ...actual, removeReachOut: vi.fn() };
});
vi.mock("./application/contactMethods", async () => {
  const actual = await vi.importActual<typeof import("./application/contactMethods")>("./application/contactMethods");
  return {
    ...actual,
    addContactMethod: vi.fn(),
    createContactMethodDraft: vi.fn(),
    editContactMethod: vi.fn(),
    listContactMethodsForPerson: vi.fn()
  };
});
vi.mock("./application/contactImport", async () => {
  const actual = await vi.importActual<typeof import("./application/contactImport")>("./application/contactImport");
  return {
    ...actual,
    importSelectedContacts: vi.fn(),
    prepareContactImportFromPickerResult: vi.fn()
  };
});
vi.mock("./application/peopleQueries", async () => {
  const actual = await vi.importActual<typeof import("./application/peopleQueries")>("./application/peopleQueries");
  return { ...actual, getAppSettings: vi.fn() };
});
vi.mock("./contacts/capacitorAdapter", () => ({
  getIPhoneContactsAdapter: vi.fn(),
  isIPhoneContactsSupported: vi.fn(),
  pickSingleIPhoneContact: vi.fn()
}));

const now = "2026-08-01T09:00:00.000Z";
const baseItem: ReachOutListItem = {
  person: {
    id: "person-sarah",
    revision: 1,
    displayName: "Sarah Jones",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  },
  entry: {
    id: "reach-out-sarah",
    revision: 1,
    personId: "person-sarah",
    reason: "Catch up about the fellowship",
    intendedActionType: "message",
    intentStatus: "active",
    contextIds: ["legacy-context"],
    notes: "Legacy detail retained underneath",
    addedAt: now,
    createdAt: now,
    updatedAt: now
  },
  contexts: [],
  displayState: "active",
  searchSources: []
};

const phoneTarget: ContactNowTarget = {
  id: "phone_call:contact-sarah-phone",
  channel: "phone_call",
  contactMethodId: "contact-sarah-phone",
  label: "Mobile",
  familiarValue: "07700 900123",
  canonicalValue: "+447700900123",
  isPreferred: true
};

function phoneContact(
  id: string,
  personId: string,
  rawValue: string,
  canonicalValue: string,
  label = "Mobile"
): ContactMethod {
  return {
    id,
    revision: 1,
    personId,
    kind: "phone",
    label,
    rawValue,
    canonicalValue,
    region: "GB",
    isPreferred: true,
    createdAt: now,
    updatedAt: now
  };
}

function emailContact(
  id: string,
  personId: string,
  value: string,
  label = "Email"
): ContactMethod {
  return {
    id,
    revision: 1,
    personId,
    kind: "email",
    label,
    rawValue: value,
    canonicalValue: value,
    isPreferred: true,
    createdAt: now,
    updatedAt: now
  };
}

function selectedIPhoneSession(): ContactImportSession {
  const candidatePerson: Person = {
    id: "person-iphone-candidate",
    revision: 1,
    displayName: "Sarah Jones",
    conversationalName: "Sarah",
    relationshipMode: "personal",
    identityStatus: "confirmed",
    importance: "normal",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  const candidatePhone = phoneContact(
    "contact-iphone-phone",
    candidatePerson.id,
    "+44 7900 555555",
    "+447900555555"
  );
  const candidateEmail = emailContact(
    "contact-iphone-email",
    candidatePerson.id,
    "sarah.new@example.com",
    "Personal"
  );
  const blockedEmail = emailContact(
    "contact-iphone-blocked",
    candidatePerson.id,
    "owned@example.com",
    "Work"
  );
  return {
    id: "iphone-session",
    fileName: "iPhone Contacts",
    sourceKind: "iphone_contacts",
    createdAt: now,
    defaultPhoneRegion: "GB",
    rows: [{
      id: "iphone-row",
      sourceIndex: 0,
      draft: {
        personId: candidatePerson.id,
        affiliationId: "affiliation-iphone-candidate",
        metInteractionId: "interaction-iphone-candidate",
        initialFollowUpId: "follow-up-iphone-candidate",
        initialFollowUpEventId: "follow-up-event-iphone-candidate",
        createdAt: now,
        displayName: candidatePerson.displayName,
        conversationalName: candidatePerson.conversationalName,
        relationshipMode: "personal",
        identityStatus: "confirmed",
        importance: "normal",
        tags: [],
        contactMethods: [
          { id: candidatePhone.id, kind: "phone", value: candidatePhone.rawValue, label: candidatePhone.label, region: "GB" },
          { id: candidateEmail.id, kind: "email", value: candidateEmail.rawValue, label: candidateEmail.label },
          { id: blockedEmail.id, kind: "email", value: blockedEmail.rawValue, label: blockedEmail.label }
        ]
      },
      prepared: {
        person: candidatePerson,
        contactMethods: [candidatePhone, candidateEmail, blockedEmail]
      },
      issues: [],
      duplicateMatches: [{
        person: {
          id: "person-owner",
          revision: 1,
          displayName: "Existing owner",
          identityStatus: "confirmed",
          importance: "normal",
          tags: [],
          createdAt: now,
          updatedAt: now
        },
        strength: "strong",
        source: "stored",
        evidence: [{
          code: "same_email",
          strength: "strong",
          canonicalValue: blockedEmail.canonicalValue,
          candidateSourceIds: [blockedEmail.id],
          existingSourceIds: ["contact-owner-email"],
          explanation: "Exact email match"
        }]
      }],
      selected: false,
      status: "needs_review"
    }]
  };
}

function renderScreen(
  activeMode: "personal" | "professional" | "all" = "personal",
  handoff = vi.fn()
) {
  const navigate = vi.fn();
  const onAdd = vi.fn();
  return {
    navigate,
    onAdd,
    handoff,
    ...render(<ReachOutScreen activeMode={activeMode} navigate={navigate} onAdd={onAdd} handoff={handoff} />)
  };
}

describe("Reach Out simplified UI", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/reach-out");
    vi.mocked(getDatabase).mockResolvedValue({ get: vi.fn() } as unknown as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(listReachOut).mockResolvedValue([baseItem]);
    vi.mocked(getContactNowProjection).mockResolvedValue({
      targets: [phoneTarget],
      hasActivePhone: true
    });
    vi.mocked(revalidateContactNowTarget).mockResolvedValue(phoneTarget);
    vi.mocked(removeReachOut).mockResolvedValue({} as Awaited<ReturnType<typeof removeReachOut>>);
    vi.mocked(getAppSettings).mockResolvedValue({ defaultPhoneRegion: "GB" } as Awaited<ReturnType<typeof getAppSettings>>);
    vi.mocked(createContactMethodDraft).mockImplementation((personId, kind = "phone") => ({
      id: `contact-added-${kind}`,
      personId,
      kind,
      value: "",
      createdAt: now
    }));
    vi.mocked(listContactMethodsForPerson).mockResolvedValue([]);
    vi.mocked(prepareContactImportFromPickerResult).mockResolvedValue(null);
    vi.mocked(importSelectedContacts).mockImplementation(async (_db, session) => session);
    vi.mocked(isIPhoneContactsSupported).mockReturnValue(false);
    vi.mocked(getIPhoneContactsAdapter).mockReturnValue(undefined);
    vi.mocked(pickSingleIPhoneContact).mockResolvedValue({ status: "cancelled", contacts: [] });
  });

  it("keeps the compact destination heading visible while the list loads", () => {
    vi.mocked(listReachOut).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderScreen();

    const heading = screen.getByText("Reach Out", { selector: "h2" }).closest(".page-heading");
    expect(heading).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Reach Out…");
    expect(screen.queryByRole("button", { name: "Add someone" })).not.toBeInTheDocument();
    unmount();
  });

  it("reuses the WhatsApp and phone handoff paths for Message and Call", async () => {
    const user = userEvent.setup();
    const { handoff } = renderScreen();
    const actions = await screen.findByRole("group", { name: "Actions for Sarah Jones" });

    await user.click(within(actions).getByRole("button", { name: "Message" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Message Sarah" }))
      .getByRole("button", { name: "Continue to message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("https://wa.me/447700900123"));
    await user.click(within(actions).getByRole("button", { name: "Call" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Call Sarah" }))
      .getByRole("button", { name: "Continue to call" }));
    await waitFor(() => expect(handoff).toHaveBeenLastCalledWith("tel:+447700900123"));
  });

  it("adds a missing Call phone inline and persists it through duplicate review", async () => {
    const addedPhone = phoneContact(
      "contact-added-phone",
      baseItem.person.id,
      "+44 7900 123456",
      "+447900123456"
    );
    const addedTarget: ContactNowTarget = {
      id: `phone_call:${addedPhone.id}`,
      channel: "phone_call",
      contactMethodId: addedPhone.id,
      label: "Phone",
      familiarValue: "+44 7900 123456",
      canonicalValue: addedPhone.canonicalValue,
      isPreferred: true
    };
    vi.mocked(getContactNowProjection)
      .mockResolvedValueOnce({ targets: [], hasActivePhone: false })
      .mockResolvedValue({ targets: [addedTarget], hasActivePhone: true });
    vi.mocked(addContactMethod).mockResolvedValue(addedPhone);
    vi.mocked(revalidateContactNowTarget).mockResolvedValue(addedTarget);
    const user = userEvent.setup();
    const { handoff } = renderScreen();
    const actions = await screen.findByRole("group", { name: "Actions for Sarah Jones" });

    await user.click(within(actions).getByRole("button", { name: "Call" }));
    const dialog = await screen.findByRole("dialog", { name: "Call Sarah" });
    expect(within(dialog).getByText("No phone number available")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Enter a different detail" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Phone number" }), "+44 7900 123456");
    await user.click(within(dialog).getByRole("button", { name: "Save detail" }));

    await waitFor(() => expect(within(dialog).getByText("+44 7900 123456")).toBeInTheDocument());
    expect(createContactMethodDraft).toHaveBeenCalledWith(baseItem.person.id, "phone");
    expect(addContactMethod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: addedPhone.id,
        personId: baseItem.person.id,
        kind: "phone",
        value: "+44 7900 123456"
      }),
      "GB",
      { enforceDuplicateReview: true }
    );
    await user.click(within(dialog).getByRole("button", { name: "Continue to call" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("tel:+447900123456"));
  });

  it("corrects an existing Message email in place and persists the refreshed target", async () => {
    const currentEmail = emailContact(
      "contact-sarah-email",
      baseItem.person.id,
      "sarah.wrong@example.com",
      "Personal"
    );
    const currentTarget: ContactNowTarget = {
      id: `email:${currentEmail.id}`,
      channel: "email",
      contactMethodId: currentEmail.id,
      label: "Personal",
      familiarValue: currentEmail.rawValue,
      canonicalValue: currentEmail.canonicalValue,
      isPreferred: true
    };
    const correctedEmail = {
      ...currentEmail,
      revision: 2,
      rawValue: "sarah.corrected@example.com",
      canonicalValue: "sarah.corrected@example.com"
    } satisfies ContactMethod;
    const correctedTarget: ContactNowTarget = {
      ...currentTarget,
      familiarValue: correctedEmail.rawValue,
      canonicalValue: correctedEmail.canonicalValue
    };
    const database = { get: vi.fn().mockResolvedValue(currentEmail) };
    vi.mocked(getDatabase).mockResolvedValue(database as unknown as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(getContactNowProjection)
      .mockResolvedValueOnce({ targets: [currentTarget], hasActivePhone: false })
      .mockResolvedValue({ targets: [correctedTarget], hasActivePhone: false });
    vi.mocked(editContactMethod).mockResolvedValue(correctedEmail);
    vi.mocked(revalidateContactNowTarget).mockResolvedValue(correctedTarget);
    const user = userEvent.setup();
    const { handoff } = renderScreen();
    const actions = await screen.findByRole("group", { name: "Actions for Sarah Jones" });

    await user.click(within(actions).getByRole("button", { name: "Message" }));
    const dialog = await screen.findByRole("dialog", { name: "Message Sarah" });
    await user.click(within(dialog).getByRole("button", { name: "Change" }));
    await user.click(within(dialog).getByRole("button", { name: "Correct this detail" }));
    const email = within(dialog).getByRole("textbox", { name: "Email" });
    expect(email).toHaveValue(currentEmail.rawValue);
    await user.clear(email);
    await user.type(email, correctedEmail.rawValue);
    await user.click(within(dialog).getByRole("button", { name: "Save detail" }));

    await waitFor(() => expect(within(dialog).getByText(correctedEmail.rawValue)).toBeInTheDocument());
    expect(editContactMethod).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: currentEmail.id,
        expectedRevision: currentEmail.revision,
        kind: "email",
        value: correctedEmail.rawValue,
        label: currentEmail.label
      },
      "GB",
      expect.any(String),
      { enforceDuplicateReview: true }
    );
    await user.click(within(dialog).getByRole("button", { name: "Continue to message" }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(`mailto:${correctedEmail.canonicalValue}`));
  });

  it("selectively reconciles one iPhone contact, refreshes the Person and targets, and can reopen the picker", async () => {
    const phoneNamedPerson: Person = {
      ...baseItem.person,
      displayName: "+44 7700 900123"
    };
    const updatedPerson: Person = {
      ...phoneNamedPerson,
      revision: 2,
      displayName: "Sarah Jones",
      conversationalName: "Sarah",
      updatedAt: "2026-08-01T10:00:00.000Z"
    };
    const phoneNamedItem: ReachOutListItem = { ...baseItem, person: phoneNamedPerson };
    const updatedItem: ReachOutListItem = { ...baseItem, person: updatedPerson };
    const existingPhone = phoneContact(
      "contact-sarah-phone",
      phoneNamedPerson.id,
      phoneNamedPerson.displayName,
      "+447700900123"
    );
    const importedPhone = phoneContact(
      "contact-iphone-phone",
      phoneNamedPerson.id,
      "+44 7900 555555",
      "+447900555555"
    );
    const importedTarget: ContactNowTarget = {
      id: `phone_call:${importedPhone.id}`,
      channel: "phone_call",
      contactMethodId: importedPhone.id,
      label: "Mobile",
      familiarValue: importedPhone.rawValue,
      canonicalValue: importedPhone.canonicalValue,
      isPreferred: false
    };
    const session = selectedIPhoneSession();
    const adapter = {
      pickContacts: vi.fn(),
      createContact: vi.fn()
    } as NonNullable<ReturnType<typeof getIPhoneContactsAdapter>>;
    const database = {
      get: vi.fn(async (storeName: string) => storeName === "people" ? updatedPerson : undefined)
    };
    vi.mocked(getDatabase).mockResolvedValue(database as unknown as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(listReachOut)
      .mockResolvedValueOnce([phoneNamedItem])
      .mockResolvedValue([updatedItem]);
    vi.mocked(getContactNowProjection)
      .mockResolvedValueOnce({ targets: [phoneTarget], hasActivePhone: true })
      .mockResolvedValue({ targets: [importedTarget], hasActivePhone: true });
    vi.mocked(isIPhoneContactsSupported).mockReturnValue(true);
    vi.mocked(getIPhoneContactsAdapter).mockReturnValue(adapter);
    vi.mocked(pickSingleIPhoneContact).mockResolvedValue({
      status: "selected",
      contacts: [{
        displayName: "Sarah Jones",
        givenName: "Sarah",
        phoneNumbers: [{ value: importedPhone.rawValue, label: "Mobile" }],
        emailAddresses: [{ value: "sarah.new@example.com", label: "Personal" }]
      }]
    });
    vi.mocked(prepareContactImportFromPickerResult).mockResolvedValue(session);
    vi.mocked(listContactMethodsForPerson)
      .mockResolvedValueOnce([existingPhone])
      .mockResolvedValue([existingPhone, importedPhone]);
    vi.mocked(importSelectedContacts).mockImplementation(async (_db, reviewed) => ({
      ...reviewed,
      rows: reviewed.rows.map((row) => row.id === "iphone-row"
        ? { ...row, status: "added_details" as const, selected: false, resultPersonId: phoneNamedPerson.id }
        : row)
    }));
    const user = userEvent.setup();
    renderScreen();
    const actions = await screen.findByRole("group", { name: `Actions for ${phoneNamedPerson.displayName}` });

    await user.click(within(actions).getByRole("button", { name: "Message" }));
    const initialDialog = await screen.findByRole("dialog", { name: `Message ${phoneNamedPerson.displayName}` });
    await user.click(within(initialDialog).getByRole("button", { name: "Change" }));
    await user.click(within(initialDialog).getByRole("button", { name: "Add or update from iPhone Contacts" }));

    expect(pickSingleIPhoneContact).toHaveBeenCalledWith(adapter);
    const review = await screen.findByRole("dialog", { name: "Add or update from iPhone Contacts" });
    expect(within(review).getByRole("checkbox", { name: "Name: Sarah Jones" })).toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Mobile: +44 7900 555555" })).toBeChecked();
    const safeEmail = within(review).getByRole("checkbox", { name: "Personal: sarah.new@example.com" });
    expect(safeEmail).toBeChecked();
    const blocked = within(review).getByRole("checkbox", { name: /Work: owned@example\.com · Used by another person/ });
    expect(blocked).toBeDisabled();
    expect(blocked).not.toBeChecked();
    await user.click(safeEmail);
    await user.click(within(review).getByRole("button", { name: `Add selected details to ${phoneNamedPerson.displayName}` }));

    await waitFor(() => expect(importSelectedContacts).toHaveBeenCalledTimes(1));
    const reviewedSession = vi.mocked(importSelectedContacts).mock.calls[0]?.[1];
    expect(reviewedSession?.rows[0]?.decision).toEqual({
      kind: "link",
      targetPersonId: phoneNamedPerson.id,
      expectedPersonRevision: phoneNamedPerson.revision,
      selectedContactMethodIds: [importedPhone.id],
      includeAffiliation: false,
      includeDisplayName: true
    });
    const resumed = await screen.findByRole("dialog", { name: "Message Sarah" });
    expect(within(resumed).getByText(importedPhone.rawValue)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: updatedPerson.displayName })).toBeInTheDocument();

    await user.click(within(resumed).getByRole("button", { name: "Change" }));
    await user.click(within(resumed).getByRole("button", { name: "Add or update from iPhone Contacts" }));
    const reopenedReview = await screen.findByRole("dialog", { name: "Add or update from iPhone Contacts" });
    expect(within(reopenedReview).getByText(`Review the details to add to ${updatedPerson.displayName}. This is a one-time copy, not ongoing sync.`)).toBeInTheDocument();
    expect(pickSingleIPhoneContact).toHaveBeenCalledTimes(2);
    await user.click(within(reopenedReview).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Message Sarah" })).toBeInTheDocument();
    expect(importSelectedContacts).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("holds one synchronous screen owner while a contact chooser is open", async () => {
    const secondItem: ReachOutListItem = {
      ...baseItem,
      person: {
        ...baseItem.person,
        id: "person-alex",
        displayName: "Alex Smith"
      },
      entry: {
        ...baseItem.entry,
        id: "reach-out-alex",
        personId: "person-alex"
      }
    };
    let resolveProjection: ((projection: Awaited<ReturnType<typeof getContactNowProjection>>) => void) | undefined;
    vi.mocked(listReachOut).mockResolvedValue([baseItem, secondItem]);
    vi.mocked(getContactNowProjection).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProjection = resolve;
    }));
    const onBusyChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ReachOutScreen
        navigate={vi.fn()}
        onAdd={vi.fn()}
        onBusyChange={onBusyChange}
      />
    );
    const sarahActions = await screen.findByRole("group", { name: "Actions for Sarah Jones" });
    const alexActions = screen.getByRole("group", { name: "Actions for Alex Smith" });

    await user.click(within(sarahActions).getByRole("button", { name: "Message" }));
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Sarah Jones" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Alex Smith" })).toBeDisabled();
    expect(within(alexActions).getByRole("button", { name: "Message" })).toBeDisabled();
    expect(getContactNowProjection).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveProjection?.({ targets: [phoneTarget], hasActivePhone: true });
    });
    const chooser = await screen.findByRole("dialog", { name: "Message Sarah" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(alexActions).getByRole("button", { name: "Call" })).toBeDisabled();
    await user.click(within(chooser).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Alex Smith" })).toBeEnabled());
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("disables the shell relationship filters while Reach Out owns a pending action", async () => {
    let resolveProjection: ((projection: Awaited<ReturnType<typeof getContactNowProjection>>) => void) | undefined;
    vi.mocked(getContactNowProjection).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProjection = resolve;
    }));
    const user = userEvent.setup();
    render(<App />);
    const filters = screen.getByRole("group", { name: "Relationship filter" });
    const buttons = within(filters).getAllByRole("button");
    const initiallySelected = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
    const alternate = buttons.find((button) => button !== initiallySelected);
    const actions = await screen.findByRole("group", { name: "Actions for Sarah Jones" });

    await user.click(within(actions).getByRole("button", { name: "Message" }));
    await waitFor(() => buttons.forEach((button) => expect(button).toBeDisabled()));
    if (alternate) await user.click(alternate);
    expect(initiallySelected).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      resolveProjection?.({ targets: [phoneTarget], hasActivePhone: true });
    });
    const chooser = await screen.findByRole("dialog", { name: "Message Sarah" });
    buttons.forEach((button) => expect(button).toBeDisabled());
    await user.click(within(chooser).getByRole("button", { name: "Cancel" }));
    await waitFor(() => buttons.forEach((button) => expect(button).toBeEnabled()));
  });

  it("ignores an older list response after the relationship mode changes", async () => {
    const professionalItem: ReachOutListItem = {
      ...baseItem,
      person: {
        ...baseItem.person,
        id: "person-professional",
        displayName: "Professional Person",
        relationshipMode: "professional"
      },
      entry: {
        ...baseItem.entry,
        id: "reach-out-professional",
        personId: "person-professional"
      }
    };
    let resolvePersonal: ((items: ReachOutListItem[]) => void) | undefined;
    let resolveProfessional: ((items: ReachOutListItem[]) => void) | undefined;
    vi.mocked(listReachOut).mockImplementation((_db, options) => new Promise((resolve) => {
      if (options.activeMode === "professional") resolveProfessional = resolve;
      else resolvePersonal = resolve;
    }));
    const view = render(
      <ReachOutScreen activeMode="personal" navigate={vi.fn()} onAdd={vi.fn()} />
    );
    await waitFor(() => expect(resolvePersonal).toBeTypeOf("function"));

    view.rerender(
      <ReachOutScreen activeMode="professional" navigate={vi.fn()} onAdd={vi.fn()} />
    );
    await waitFor(() => expect(resolveProfessional).toBeTypeOf("function"));
    await act(async () => { resolveProfessional?.([professionalItem]); });
    expect(await screen.findByRole("button", { name: professionalItem.person.displayName })).toBeInTheDocument();

    await act(async () => { resolvePersonal?.([baseItem]); });
    expect(screen.getByRole("button", { name: professionalItem.person.displayName })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: baseItem.person.displayName })).not.toBeInTheDocument();
  });

  it("shows a compact populated heading, each person’s note, and the simple row actions", async () => {
    const user = userEvent.setup();
    const { navigate } = renderScreen();

    expect(await screen.findByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    expect(screen.getByText("People you mean to contact.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add someone" })).not.toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Reach Out list" });
    const card = within(list).getByRole("article", { name: "Sarah Jones" });
    expect(within(card).getByText("Catch up about the fellowship")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Message" })).not.toHaveClass("primary-action");
    expect(within(card).getByRole("button", { name: "Call" })).not.toHaveClass("primary-action");
    expect(within(card).getByRole("button", { name: "Done" })).toHaveClass("reach-out-done-action");
    const more = within(card).getByRole("button", { name: "More actions for Sarah Jones" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByRole("button", { name: "Remove from Reach Out" })).not.toBeInTheDocument();
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(within(card).getByRole("button", { name: "Remove from Reach Out" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(more).toHaveFocus());
    expect(screen.queryByText("Legacy detail retained underneath")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next action|Planned|Context|Status/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Sarah Jones" }));
    expect(navigate).toHaveBeenCalledWith("/people/person-sarah", {
      state: { fromPath: "/reach-out", navigationOrigin: true }
    });
  });

  it("removes a current entry from its card while explicitly retaining the person", async () => {
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listReachOut)
      .mockResolvedValueOnce([baseItem])
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "More actions for Sarah Jones" }));
    await user.click(within(card).getByRole("button", { name: "Remove from Reach Out" }));

    expect(confirmation).toHaveBeenCalledWith(
      "Remove Sarah Jones from Reach Out? They will remain in PeopleOS."
    );
    await waitFor(() => expect(removeReachOut).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transition: "removed",
        entryId: "reach-out-sarah",
        personId: "person-sarah"
      })
    ));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect(screen.getByText("People you mean to contact.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add someone" })).toHaveFocus());
  });

  it("keeps a successfully removed entry hidden when the list refresh fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listReachOut)
      .mockResolvedValueOnce([baseItem])
      .mockRejectedValueOnce(new Error("refresh failed"));
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    await user.click(within(card).getByRole("button", { name: "More actions for Sarah Jones" }));
    await user.click(within(card).getByRole("button", { name: "Remove from Reach Out" }));

    await waitFor(() => expect(removeReachOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Sarah Jones" })).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent("PeopleOS could not load Reach Out from this device.");
    expect(screen.getByRole("button", { name: "Add someone" })).toBeInTheDocument();
  });

  it("leaves Reach Out unchanged when card removal is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderScreen();

    const card = await screen.findByRole("article", { name: "Sarah Jones" });
    const more = within(card).getByRole("button", { name: "More actions for Sarah Jones" });
    await user.click(more);
    await user.click(within(card).getByRole("button", { name: "Remove from Reach Out" }));

    expect(removeReachOut).not.toHaveBeenCalled();
    expect(more).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(more).toHaveFocus());
    expect(card).toBeInTheDocument();
  });

  it("uses one short empty state and one Add someone action", async () => {
    vi.mocked(listReachOut).mockResolvedValue([]);
    const user = userEvent.setup();
    const { onAdd } = renderScreen();

    const add = await screen.findByRole("button", { name: "Add someone" });
    expect(screen.getByText("People you mean to contact.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    await user.click(add);
    expect(onAdd).toHaveBeenCalledWith(add);
  });

  it("queries only the current list for the active relationship mode", async () => {
    renderScreen("professional");

    await screen.findByRole("list", { name: "Reach Out list" });
    await waitFor(() => expect(listReachOut).toHaveBeenCalledWith(expect.anything(), {
      localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      activeMode: "professional"
    }));
  });

  it("shows an explicit retry path without substituting the empty state", async () => {
    vi.mocked(listReachOut).mockRejectedValueOnce(new Error("read failed"));
    const user = userEvent.setup();
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PeopleOS could not load Reach Out from this device.");
    expect(screen.getByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Sarah Jones" })).toBeInTheDocument();
  });
});
