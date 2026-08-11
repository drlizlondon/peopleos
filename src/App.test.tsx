import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { OPEN_TODAY_FROM_NOTIFICATION_EVENT } from "./notifications/service";

describe("PeopleOS shell", () => {
  it("keeps the selected relationship view while navigating and after remounting", async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); }
      }
    });
    const user = userEvent.setup();
    const first = render(<App />);
    const todayFilters = screen.getByRole("group", { name: "Today filters" });
    expect(Array.from(todayFilters.querySelectorAll("button"), (button) => button.textContent)).toEqual(["All", "Personal", "Professional"]);
    expect(todayFilters.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    const professional = screen.getByRole("button", { name: "Professional" });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await user.click(professional);
    expect(professional).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("link", { name: "People" }));
    expect(screen.getByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
    first.unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
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
    await user.click(screen.getByRole("button", { name: "Add person" }));
    const dialog = screen.getByRole("dialog", { name: "Add to PeopleOS" });
    expect(within(dialog).getByRole("button", { name: "Add person" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add follow-up" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Log interaction" })).toBeInTheDocument();
  });

  it("navigates to Reach Out and preserves its canonical empty-state wording", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Reach Out" }));
    expect(window.location.pathname).toBe("/reach-out");
    expect(await screen.findByRole("heading", { name: "People you mean to contact" })).toBeInTheDocument();
    expect(screen.getByText("You can even add someone if all you remember is where you met them.")).toBeInTheDocument();
  });

  it("renders the contained iCloud section and existing Settings sections in order", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "iCloud Sync",
      "General",
      "Modes",
      "Today",
      "Reach Out",
      "Interactions",
      "Notifications",
      "Privacy & Security",
      "Data",
      "About"
    ]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Local reminders are available in the iPhone app/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add person" })).not.toBeInTheDocument();
  });

  it("routes a notification tap from another screen into Today", async () => {
    window.history.replaceState({}, "", "/people");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Your people will appear here." })).toBeInTheDocument();
    window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    });
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
