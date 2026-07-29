import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";
import { RELATIONSHIP_MODE_PREFERENCE_KEY } from "./relationshipModePreference";

async function reset() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
  window.localStorage.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, "all");
}

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    }
  });
}

describe("compact mobile relationship and scheduling controls", () => {
  beforeEach(async () => {
    installLocalStorage();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    await reset();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await reset();
  });

  it("hides the global selector with one relationship context and prevents disabling both", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/settings");
    render(<App />);
    const professional = await screen.findByRole("checkbox", { name: "Professional" });
    await waitFor(async () => expect((await (await getDatabase()).get("appSettings", "app"))?.relationshipContexts)
      .toEqual(["personal", "professional"]));
    await user.click(professional);
    await waitFor(() => expect(professional).not.toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "Personal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep at least one relationship type enabled.");
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Filter people" })).not.toBeInTheDocument());
  });

  it("uses a lightweight persistent people filter when both relationship types are enabled", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/");
    const first = render(<App />);
    const filter = await screen.findByRole("button", { name: "Filter people" });
    expect(screen.getByText("Showing everyone")).toBeInTheDocument();
    await user.click(filter);
    await user.click(screen.getByRole("menuitemradio", { name: "Professional" }));
    expect(screen.getByText("Showing professional contacts")).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Filter people" })).not.toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(await screen.findByText("Showing professional contacts")).toBeInTheDocument();
  });

  it("stores Keep in touch frequency and start independently", async () => {
    vi.useRealTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Monthly person");
    await user.click(screen.getByRole("checkbox", { name: "Remind me to stay in touch" }));
    await user.selectOptions(screen.getByLabelText("How often?"), "30");
    await user.selectOptions(screen.getByLabelText("Start"), "today");
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(async () => {
      const [person] = await (await getDatabase()).getAll("people");
      expect(person).toMatchObject({ contactCadenceDays: 30, contactCadenceFirstDueDate: "2026-08-14" });
    });
  });
});
