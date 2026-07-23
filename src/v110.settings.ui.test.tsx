import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("V1-10 Already contacted default setting", () => {
  beforeEach(async () => {
    await resetDatabase();
    window.history.replaceState({}, "", "/settings");
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("shows the 14-day default and dismisses without writing", async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = await screen.findByRole("button", { name: "Default “Already contacted” interval" });
    await waitFor(() => expect(opener).toBeEnabled());
    expect(screen.getByText("14 days", { selector: "dd" })).toBeInTheDocument();
    const before = await (await getDatabase()).get("appSettings", "app");

    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Default “Already contacted” interval" });
    expect(within(dialog).getByRole("radio", { name: "14 days" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await (await getDatabase()).get("appSettings", "app")).toEqual(before);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("saves a preset immediately to the global Settings singleton", async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = await screen.findByRole("button", { name: "Default “Already contacted” interval" });
    await waitFor(() => expect(opener).toBeEnabled());
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Default “Already contacted” interval" });
    await user.click(within(dialog).getByRole("radio", { name: "30 days" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("30 days", { selector: "dd" })).toBeInTheDocument();
    expect(await (await getDatabase()).get("appSettings", "app"))
      .toMatchObject({ alreadyContactedDefaultReminderDays: 30, revision: 2 });
  });

  it("validates Custom as a whole number from 1 to 3650", async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = await screen.findByRole("button", { name: "Default “Already contacted” interval" });
    await waitFor(() => expect(opener).toBeEnabled());
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Default “Already contacted” interval" });
    await user.click(within(dialog).getByRole("radio", { name: "Custom" }));
    const input = within(dialog).getByRole("spinbutton", { name: "Custom days Required" });
    await user.clear(input);
    await user.type(input, "45");
    expect(within(dialog).getByText(/^In 45 days · /)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "3651");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter a whole number from 1 to 3650 days.");
    await waitFor(() => expect(input).toHaveFocus());
    expect((await (await getDatabase()).get("appSettings", "app"))?.alreadyContactedDefaultReminderDays).toBe(14);
  });
});
