import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

describe("simplified Settings", () => {
  beforeEach(async () => {
    await resetDatabase();
    window.history.replaceState({}, "", "/settings");
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("shows conversation starters as one collapsed row beside the four essential sections", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Relationships included" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Relationships included",
      "Preferences",
      "Your data",
      "Privacy"
    ]);
    expect(screen.getByRole("link", { name: /Conversation starters \(\d+\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Conversation starter/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Default “Already contacted” interval/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Current plan|Why now|reminder engine/i)).not.toBeInTheDocument();
  });

  it("opens a focused conversation-starter editor and adds the greeting when NAME is omitted", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: /Conversation starters \(\d+\)/ }));
    expect(window.location.pathname).toBe("/settings/conversation-starters");
    expect(await screen.findByRole("heading", { name: "Conversation starters" })).toBeInTheDocument();
    expect(screen.getByText("Write naturally. Use NAME only when you want to place the person’s name yourself.")).toBeInTheDocument();

    const first = screen.getByRole("textbox", { name: "Conversation starter 1" });
    expect((first as HTMLInputElement).value).not.toContain("{name}");
    await user.clear(first);
    await user.type(first, "Hope you are doing well.");
    await user.click(screen.getByRole("button", { name: "Save starters" }));

    expect(await screen.findByText("Conversation starters saved.")).toBeInTheDocument();
    const saved = await (await getDatabase()).get("appSettings", "app");
    expect(saved?.conversationStarters?.[0]?.template).toBe("Hi {name},\n\nHope you are doing well.");
  });

  it("stores the friendly NAME token as the existing canonical person placeholder", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: /Conversation starters \(\d+\)/ }));
    const first = await screen.findByRole("textbox", { name: "Conversation starter 1" });
    await user.clear(first);
    await user.type(first, "Hi NAME, free this week?");
    await user.click(screen.getByRole("button", { name: "Save starters" }));

    await waitFor(async () => {
      const saved = await (await getDatabase()).get("appSettings", "app");
      expect(saved?.conversationStarters?.[0]?.template).toBe("Hi {name}, free this week?");
    });
  });
});
