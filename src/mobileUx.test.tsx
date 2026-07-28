import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { closeDatabase, getDatabase } from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";

async function reset() {
  await closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

describe("compact mobile relationship and scheduling controls", () => {
  beforeEach(async () => {
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
    await waitFor(() => expect(screen.queryByRole("group", { name: "Relationship view" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: "Personal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep at least one relationship type enabled.");
  });

  it("stores cadence and a visible first appearance independently", async () => {
    vi.useRealTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/new");
    render(<App />);
    await user.type(await screen.findByLabelText("Name"), "Monthly person");
    await user.selectOptions(screen.getByLabelText("Contact cadence in days"), "30");
    await user.click(screen.getByRole("radio", { name: "Appear today" }));
    await user.click(screen.getByRole("button", { name: "Save person" }));
    const [person] = await (await getDatabase()).getAll("people");
    expect(person).toMatchObject({ contactCadenceDays: 30, contactCadenceFirstDueDate: "2026-08-14" });
  });
});
