import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { OPEN_TODAY_FROM_NOTIFICATION_EVENT } from "./notifications/service";
import { RELATIONSHIP_MODE_PREFERENCE_KEY } from "./relationshipModePreference";

describe("PeopleOS shell", () => {
  it("loads a browser deep link below /app and keeps application links scoped there", () => {
    window.history.replaceState({}, "", "/app/people");
    render(<App />);

    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
  });

  it("exposes build provenance for diagnostics without adding product chrome", () => {
    render(<App />);
    expect(document.querySelector(".app-shell")?.getAttribute("data-build-commit"))
      .toMatch(/^(?:[0-9a-f]{7,40}(?:-dirty)?|uncommitted)$/);
  });

  it("keeps destination headings visible while primary routes load", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Today" }).closest(".page-heading")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "People" }));
    expect(screen.getByRole("heading", { name: "People" }).closest(".page-heading")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Reach Out" }));
    expect(screen.getByRole("heading", { name: "Reach Out" }).closest(".page-heading")).toBeInTheDocument();
  });

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
    await user.click(screen.getByRole("link", { name: "People" }));
    expect(await screen.findByRole("heading", { name: "Your people will appear here." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(RELATIONSHIP_MODE_PREFERENCE_KEY)).toBe("professional");
    window.localStorage.setItem(RELATIONSHIP_MODE_PREFERENCE_KEY, "all");
  });

  it("keeps Upcoming under Today and renders four primary destinations", async () => {
    const user = userEvent.setup();
    render(<App />);
    const links = screen.getByRole("navigation", { name: "Primary navigation" }).querySelectorAll("a");
    expect(Array.from(links, (link) => link.textContent)).toEqual([
      "Today",
      "Reach Out",
      "People",
      "Settings"
    ]);
    expect(screen.queryByRole("link", { name: "Upcoming" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector(".brand-mark")).toHaveAttribute("src", "/peopleos-mark.svg");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(window.location.pathname).toBe("/people/new");
    expect(screen.getByRole("heading", { name: "Add someone" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add to PeopleOS" })).not.toBeInTheDocument();
  });

  it("navigates to the concise Reach Out empty state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Reach Out" }));
    expect(window.location.pathname).toBe("/reach-out");
    expect(await screen.findByRole("heading", { name: "Reach Out" })).toBeInTheDocument();
    expect(screen.getByText("People you mean to contact.")).toBeInTheDocument();
  });

  it("renders only actionable Settings sections in order", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Notifications",
      "iCloud Sync",
      "PeopleOS",
      "Privacy & Data"
    ]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Local reminders are available in the iPhone app/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conversation starters" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add person" })).not.toBeInTheDocument();
  });

  it("opens the in-app Privacy screen from Settings and returns to Settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("link", { name: "Privacy" }));
    expect(window.location.pathname).toBe("/settings/privacy");
    expect(screen.getByRole("heading", { name: "Your data stays under your control." })).toBeInTheDocument();
    expect(screen.getByText(/private iCloud storage through Apple CloudKit/i)).toBeInTheDocument();
    expect(screen.getByText(/Previews contain only a count or general reminder/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Settings" }));
    expect(window.location.pathname).toBe("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("link", { name: "Settings" }));
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

  it("keeps focused form controls above the iPhone keyboard and provides a Done control", async () => {
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    viewport.height = 400;
    viewport.offsetTop = 0;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const user = userEvent.setup();
    const view = render(<App />);
    try {
      await user.click(screen.getByRole("button", { name: "Add" }));
      const name = screen.getByLabelText("Name");
      const scrollIntoView = vi.fn();
      Object.defineProperty(name, "scrollIntoView", { configurable: true, value: scrollIntoView });
      vi.spyOn(name, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 360,
        top: 360,
        right: 200,
        bottom: 410,
        left: 0,
        width: 200,
        height: 50,
        toJSON: () => ({})
      });
      name.focus();
      viewport.dispatchEvent(new Event("resize"));

      await waitFor(() => {
        expect(document.documentElement).toHaveAttribute("data-keyboard-open", "true");
        expect(scrollIntoView).toHaveBeenCalled();
      });
      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(name).not.toHaveFocus();
    } finally {
      view.unmount();
      if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });
});
