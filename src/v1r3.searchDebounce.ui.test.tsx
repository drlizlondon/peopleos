/**
 * V1-R3: typing must not issue one full search per keystroke.
 *
 * Before debouncing, every character typed into the People search box ran a
 * complete query — reading the whole dataset and ranking every Person. At 3,000
 * contacts a five-letter name cost five back-to-back queries and roughly 1.4
 * seconds of blocked main thread. This asserts the mechanism rather than the
 * timing, so it stays meaningful on any machine.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchCalls: string[] = [];

vi.mock("./application/personSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./application/personSearch")>();
  return {
    ...actual,
    getPersonSearchView: (
      db: Parameters<typeof actual.getPersonSearchView>[0],
      options: Parameters<typeof actual.getPersonSearchView>[1]
    ) => {
      searchCalls.push(options.query ?? "");
      return actual.getPersonSearchView(db, options);
    }
  };
});

const App = (await import("./App")).default;
const { closeDatabase, getDatabase } = await import("./data/client");
const { deletePeopleOsDatabase } = await import("./data/database");
const { createRepositories } = await import("./data/repositories");
const { DATABASE_NAME } = await import("./domain/schema");

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

beforeEach(async () => {
  searchCalls.length = 0;
  await resetDatabase();
  const repositories = createRepositories(await getDatabase());
  for (const [index, name] of ["Sarah Ahmed", "Sam Okonkwo", "Priya Patel"].entries()) {
    await repositories.people.create({
      id: `person-${index}`,
      revision: 1,
      displayName: name,
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: "2026-07-01T09:00:00.000Z",
      updatedAt: "2026-07-01T09:00:00.000Z"
    });
  }
  window.history.replaceState({}, "", "/people");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

describe("V1-R3 search debounce", () => {
  it("issues at most two searches for a five-character query", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await waitFor(() => expect(searchCalls.length).toBeGreaterThan(0));
    const afterInitialLoad = searchCalls.length;

    await user.type(search, "sarah");
    await screen.findByText("Sarah Ahmed");
    // Let any straggling timer fire before counting.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const typingCalls = searchCalls.length - afterInitialLoad;
    expect(typingCalls, `expected <=2 searches, saw: ${searchCalls.join(", ")}`)
      .toBeLessThanOrEqual(2);
    // The last search must be for the complete query, not a prefix.
    expect(searchCalls[searchCalls.length - 1]).toBe("sarah");
  });

  it("still shows results for the settled query", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "priya");
    expect(await screen.findByText("Priya Patel")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Sarah Ahmed")).not.toBeInTheDocument());

    await user.clear(search);
    expect(await screen.findByText("Sarah Ahmed")).toBeInTheDocument();
  });
});
