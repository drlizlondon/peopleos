import { render, screen } from "@testing-library/react";
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

  afterEach(resetDatabase);

  it("shows only settings and useful data actions", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Notifications",
      "iCloud Sync",
      "PeopleOS",
      "Privacy & Data"
    ]);
    expect(screen.getByRole("link", { name: "Conversation starters" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export backup" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Restore backup" })).toBeInTheDocument();
  });

  it("does not expose immutable device details or the old workflow defaults", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Settings" });

    expect(screen.queryByText("Default phone region")).not.toBeInTheDocument();
    expect(screen.queryByText("Timezone and formats")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture mode")).not.toBeInTheDocument();
    expect(screen.queryByText("How Today works")).not.toBeInTheDocument();
    expect(screen.queryByText("Default reminder")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Default “Already contacted” interval" })).not.toBeInTheDocument();
  });

  it("retains the hidden compatibility default without rewriting it", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Settings" });

    expect(await (await getDatabase()).get("appSettings", "app"))
      .toMatchObject({ alreadyContactedDefaultReminderDays: 14, revision: 1 });
  });
});
