import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReachOutScreen from "./ReachOutScreen";
import { removeReachOut } from "./application/reachOut";
import {
  getContactNowProjection,
  revalidateContactNowTarget,
  type ContactNowTarget
} from "./application/contactNow";
import { listReachOut, type ReachOutListItem } from "./application/reachOutQueries";
import { getDatabase } from "./data/client";

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
    vi.mocked(getDatabase).mockResolvedValue({} as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(listReachOut).mockResolvedValue([baseItem]);
    vi.mocked(getContactNowProjection).mockResolvedValue({
      targets: [phoneTarget],
      hasActivePhone: true
    });
    vi.mocked(revalidateContactNowTarget).mockResolvedValue(phoneTarget);
    vi.mocked(removeReachOut).mockResolvedValue({} as Awaited<ReturnType<typeof removeReachOut>>);
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
    await waitFor(() => expect(handoff).toHaveBeenCalledWith("https://wa.me/447700900123"));
    await user.click(within(actions).getByRole("button", { name: "Call" }));
    await waitFor(() => expect(handoff).toHaveBeenLastCalledWith("tel:+447700900123"));
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
