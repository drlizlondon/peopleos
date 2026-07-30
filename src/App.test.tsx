import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { RELATIONSHIP_MODE_PREFERENCE_KEY } from "./relationshipModePreference";

describe("PeopleOS shell", () => {
  it("keeps the selected relationship view while navigating", async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); }
      }
    });
    window.localStorage.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, "all");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Showing everyone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter people" }));
    const professional = screen.getByRole("menuitemradio", { name: "Professional" });
    await user.click(professional);
    expect(screen.getByText("Showing professional contacts")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "People" }));
    expect(await screen.findByRole("heading", { name: "Your people will appear here." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter people" })).toHaveTextContent("Professional");
    expect(window.localStorage.getItem(RELATIONSHIP_MODE_PREFERENCE_KEY)).toBe("professional");
    window.localStorage.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, "all");
  });

  it("renders all five primary destinations in the accepted order", async () => {
    const user = userEvent.setup();
    render(<App />);
    const links = screen.getByRole("navigation", { name: "Primary navigation" }).querySelectorAll("a");
    expect(Array.from(links, (link) => link.textContent)).toEqual([
      "Today",
      "Reach Out",
      "People",
      "Upcoming",
      "Settings"
    ]);
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Add person" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log interaction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Reach Out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import contacts" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close Add menu" }));
    await user.click(screen.getByRole("link", { name: "People" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getAllByRole("button").filter((button) => button.closest("[role=dialog]") !== null).map((button) => button.textContent)).toEqual([
      "×",
      "Add person"
    ]);
  });

  it("navigates to Reach Out and preserves its canonical empty-state wording", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Reach Out" }));
    expect(window.location.pathname).toBe("/reach-out");
    expect(await screen.findByRole("heading", { name: "People you mean to contact" })).toBeInTheDocument();
    expect(screen.getByText("You can even add someone if all you remember is where you met them.")).toBeInTheDocument();
  });

  it("keeps Settings focused on relationships, starters, preferences, data and privacy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Relationships included",
      "Preferences",
      "Your data",
      "Privacy"
    ]);
    expect(screen.getByRole("link", { name: /Conversation starters \(\d+\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText(/Default “Already contacted” interval/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Why now/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add person" })).not.toBeInTheDocument();
  });

  it("supports browser Back between stable primary routes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "People" }));
    await user.click(screen.getByRole("link", { name: "Upcoming" }));
    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/people");
      expect(screen.getByRole("heading", { name: "Your people will appear here." })).toBeInTheDocument();
    });
  });

  it("contains no inherited Real Friends product identity", () => {
    render(<App />);
    expect(document.body).not.toHaveTextContent("Real Friends");
    expect(document.title).toBe("PeopleOS");
  });

  it("opens the V1-02 export and restore screens from Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("link", { name: "Export backup" }));
    expect(window.location.pathname).toBe("/settings/export");
    expect(screen.getByRole("heading", { name: "Export backup" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Settings" }));
    await user.click(screen.getByRole("link", { name: "Restore backup" }));
    expect(window.location.pathname).toBe("/settings/restore");
    expect(screen.getByRole("heading", { name: "Restore backup" })).toBeInTheDocument();
  });
});
