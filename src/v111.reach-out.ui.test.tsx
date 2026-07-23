import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReachOutScreen from "./ReachOutScreen";
import {
  hasReachOutEntries,
  listReachOut,
  listReachOutContexts,
  type ReachOutListItem
} from "./application/reachOutQueries";
import { getDatabase } from "./data/client";
import type { ReachOutContext } from "./domain/schema";

vi.mock("./data/client", () => ({ getDatabase: vi.fn() }));
vi.mock("./application/reachOutQueries", async () => {
  const actual = await vi.importActual<typeof import("./application/reachOutQueries")>("./application/reachOutQueries");
  return {
    ...actual,
    hasReachOutEntries: vi.fn(),
    listReachOut: vi.fn(),
    listReachOutContexts: vi.fn()
  };
});

const now = "2026-08-01T09:00:00.000Z";
const context: ReachOutContext = {
  id: "context-fellowship",
  revision: 1,
  kind: "fellowship",
  label: "AI Fellowship",
  createdAt: now,
  updatedAt: now
};
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
    reason: "Reconnect after the fellowship",
    intendedActionType: "message",
    intentStatus: "active",
    contextIds: [context.id],
    addedAt: now,
    createdAt: now,
    updatedAt: now
  },
  contexts: [context],
  displayState: "active",
  searchSources: []
};

function renderScreen(navigate = vi.fn()) {
  return {
    navigate,
    ...render(<ReachOutScreen navigate={navigate} onAdd={vi.fn()} />)
  };
}

describe("V1-11 Reach Out retrieval UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/reach-out");
    vi.mocked(getDatabase).mockResolvedValue({} as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(hasReachOutEntries).mockResolvedValue(true);
    vi.mocked(listReachOutContexts).mockResolvedValue([context]);
    vi.mocked(listReachOut).mockImplementation(async (_db, options) => {
      if (options.query === "missing") return [];
      if (options.query) {
        return [{
          ...baseItem,
          searchSources: ["Organisation"],
          primarySearchMatch: { source: "Organisation", value: "Watford Health" }
        }];
      }
      return [baseItem];
    });
  });

  it("keeps search visible, explains the highest-ranked match and distinguishes no matches", async () => {
    const user = userEvent.setup();
    renderScreen();
    const search = await screen.findByRole("searchbox", { name: "Search Reach Out" });

    await user.type(search, "Watford");
    expect(await screen.findByText(/Matched organisation:/)).toHaveTextContent("Matched organisation: Watford Health");
    expect(screen.getByRole("searchbox", { name: "Search Reach Out" })).toHaveValue("Watford");

    await user.clear(search);
    await user.type(search, "missing");
    expect(await screen.findByRole("heading", { name: "No Reach Out plans match" })).toBeInTheDocument();
    expect(screen.queryByText("You can even add someone if all you remember is where you met them.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("applies status OR filters and a context through an accessible modal sheet", async () => {
    const user = userEvent.setup();
    renderScreen();
    const filterButton = await screen.findByRole("button", { name: "Filters" });
    await user.click(filterButton);

    let dialog = await screen.findByRole("dialog", { name: "Filter the queue" });
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "Active" })).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(filterButton).toHaveFocus());

    await user.click(filterButton);
    dialog = await screen.findByRole("dialog", { name: "Filter the queue" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Waiting" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Completed" }));
    await user.selectOptions(within(dialog).getByLabelText("Context"), context.id);
    await user.click(within(dialog).getByRole("button", { name: "Show results" }));

    await waitFor(() => expect(listReachOut).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusFilters: ["waiting", "completed"],
        contextId: context.id
      })
    ));
    expect(screen.getByRole("button", { name: "Remove Waiting filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Completed filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove AI Fellowship filter" })).toBeInTheDocument();
    await waitFor(() => expect(filterButton).toHaveFocus());
  });

  it("restores retrieval and scroll state from history and preserves it before navigation", async () => {
    window.history.replaceState({
      reachOutView: {
        query: "saved",
        statusFilters: ["completed"],
        contextId: context.id,
        scrollY: 240
      }
    }, "", "/reach-out");
    const scrollTo = vi.spyOn(window, "scrollTo");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 175 });
    const { navigate, unmount } = renderScreen();

    expect(await screen.findByRole("searchbox", { name: "Search Reach Out" })).toHaveValue("saved");
    expect(screen.getByRole("button", { name: "Remove Completed filter" })).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 240));

    await userEvent.setup().click(screen.getByRole("button", { name: "Open plan" }));
    expect(navigate).toHaveBeenCalledWith("/reach-out/reach-out-sarah");
    expect(window.history.state.reachOutView).toMatchObject({
      query: "saved",
      statusFilters: ["completed"],
      contextId: context.id,
      scrollY: 175
    });

    unmount();
    renderScreen();
    expect(await screen.findByRole("searchbox", { name: "Search Reach Out" })).toHaveValue("saved");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("shows an explicit retry path without substituting an empty state", async () => {
    vi.mocked(listReachOut).mockRejectedValueOnce(new Error("read failed"));
    const user = userEvent.setup();
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PeopleOS could not load Reach Out from this device.");
    expect(screen.queryByText("You can even add someone if all you remember is where you met them.")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Sarah Jones" })).toBeInTheDocument();
  });
});
