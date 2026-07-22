import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("PeopleOS shell", () => {
  it("renders all five primary destinations in the accepted order", () => {
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
    expect(screen.getByRole("link", { name: "Add person" })).toHaveAttribute("href", "/people/new");
  });

  it("navigates to Reach Out and preserves its canonical empty-state wording", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Reach Out" }));
    expect(window.location.pathname).toBe("/reach-out");
    expect(screen.getByRole("heading", { name: "People you mean to contact" })).toBeInTheDocument();
    expect(screen.getByText("You can even add someone if all you remember is where you met them.")).toBeInTheDocument();
  });

  it("renders all nine Settings sections in order as information, not controls", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
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
    expect(screen.getByText("Unavailable in Version 1")).toBeInTheDocument();
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
      expect(screen.getByRole("heading", { name: "Your people will live here" })).toBeInTheDocument();
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
