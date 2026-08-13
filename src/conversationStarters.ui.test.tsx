import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { updateTodaySummaryNotificationSettings } from "./application/settings";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";

async function resetDatabase() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

describe("Conversation starter settings", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/settings");
    await resetDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("opens from Settings, edits the bank and stores the name placeholder safely", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Conversation starters" }));
    expect(window.location.pathname).toBe("/settings/conversation-starters");
    expect(await screen.findByRole("heading", { name: "Conversation starters" })).toBeInTheDocument();
    expect(screen.getByText("Keep a few messages that sound like you. PeopleOS opens a draft; it never sends one.")).toBeInTheDocument();

    const first = await screen.findByRole("textbox", { name: "Conversation starter 1" });
    expect(first).toHaveValue("Hey NAME, just thinking of you today.");
    expect((first as HTMLTextAreaElement).value).not.toContain("{name}");
    await user.clear(first);
    await user.type(first, "Thinking of you, NAME.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Conversation starters saved.");
    const settings = await (await getDatabase()).get("appSettings", "app");
    expect(settings?.conversationStarters[0]?.template).toBe("Thinking of you, {name}.");
  });

  it("keeps coverage for both Personal and Professional relationships", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Conversation starters" }));

    const modes = await screen.findAllByRole("combobox", { name: /Relationships for conversation starter/ });
    for (const mode of modes) await user.selectOptions(mode, "professional");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Keep at least one starter for Personal and Professional relationships."
    );
    await waitFor(async () => {
      const settings = await (await getDatabase()).get("appSettings", "app");
      expect(settings?.conversationStarters.some((starter) => starter.relationshipMode === "personal")).toBe(true);
    });
  });

  it("protects unsaved edits from both the screen back action and primary navigation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Conversation starters" }));

    const first = await screen.findByRole("textbox", { name: "Conversation starter 1" });
    await user.type(first, " Still here.");
    await user.click(screen.getByRole("button", { name: "← Settings" }));
    expect(window.location.pathname).toBe("/settings/conversation-starters");
    expect(first).toHaveValue("Hey NAME, just thinking of you today. Still here.");

    await user.click(screen.getByRole("link", { name: "People" }));
    expect(window.location.pathname).toBe("/settings/conversation-starters");
    expect(confirm).toHaveBeenCalledTimes(2);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("link", { name: "People" }));
    expect(window.location.pathname).toBe("/people");
  });

  it("reloads the latest Settings revision after a stale save and preserves the draft for retry", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Conversation starters" }));

    const first = await screen.findByRole("textbox", { name: "Conversation starter 1" });
    await user.clear(first);
    await user.type(first, "Thinking of you, NAME.");
    await updateTodaySummaryNotificationSettings(await getDatabase(), {
      expectedRevision: 1,
      enabled: true,
      time: "12:00",
      occurredAt: "2026-08-11T10:00:00.000Z"
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conversation starters changed elsewhere. Your edits are still here; review them and try again."
    );
    expect(first).toHaveValue("Thinking of you, NAME.");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Conversation starters saved.");
    const settings = await (await getDatabase()).get("appSettings", "app");
    expect(settings).toMatchObject({
      revision: 3,
      todaySummaryNotificationsEnabled: true
    });
    expect(settings?.conversationStarters[0]?.template).toBe("Thinking of you, {name}.");
  });
});
