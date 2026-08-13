import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReachOutEditorSheet from "./ReachOutEditorSheet";
import * as client from "./data/client";
import { deletePeopleOsDatabase } from "./data/database";
import { DATABASE_NAME } from "./domain/schema";

async function resetDatabase() {
  await client.closeDatabase();
  await deletePeopleOsDatabase(DATABASE_NAME);
}

describe("Reach Out editor focus", () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it("opens on a non-input control after asynchronous data finishes loading", async () => {
    const db = await client.getDatabase();
    let releaseLoad: (() => void) | undefined;
    const loadingGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    vi.spyOn(client, "getDatabase").mockImplementation(async () => {
      await loadingGate;
      return db;
    });

    render(
      <ReachOutEditorSheet
        mode="create"
        onClose={() => undefined}
        onSaved={() => undefined}
        onOpenExisting={() => undefined}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading people");
    expect(screen.queryByLabelText(/^Person/)).not.toBeInTheDocument();

    await act(async () => { releaseLoad?.(); });

    const identity = await screen.findByLabelText(/^Person/);
    const close = screen.getByRole("button", { name: "Close Reach Out" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(identity).not.toHaveFocus();
  });
});
