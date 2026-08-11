import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./screens";

const mocks = vi.hoisted(() => ({
  syncState: {
    id: "app" as const,
    enabled: true,
    installationId: "test-installation",
    initialMigrationPhase: "complete" as const,
    lastScannedDatasetRevision: 1,
    retryCount: 0,
    accountStatus: "available" as const
  },
  syncListener: undefined as undefined | ((state: unknown, running: boolean) => void),
  enable: vi.fn(),
  pause: vi.fn(),
  syncNow: vi.fn(),
  settings: {
    id: "app" as const,
    revision: 1,
    defaultPhoneRegion: "GB",
    captureMode: "standard" as const,
    alreadyContactedDefaultReminderDays: 14,
    todaySummaryNotificationsEnabled: false,
    todaySummaryNotificationTime: "12:00",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z"
  }
}));

vi.mock("./data/client", () => ({ getDatabase: vi.fn(async () => ({})) }));
vi.mock("./application/peopleQueries", () => ({ getAppSettings: vi.fn(async () => mocks.settings) }));
vi.mock("./sync/service", () => ({
  isCloudSyncSupported: () => true,
  subscribeToSync: (listener: (state: unknown, running: boolean) => void) => {
    mocks.syncListener = listener;
    listener({ ...mocks.syncState }, false);
    return () => { mocks.syncListener = undefined; };
  },
  enableCloudSync: mocks.enable,
  pauseCloudSync: mocks.pause,
  syncNow: mocks.syncNow
}));

beforeEach(() => {
  mocks.syncState.enabled = true;
  mocks.syncListener = undefined;
  mocks.enable.mockReset();
  mocks.pause.mockReset();
  mocks.syncNow.mockReset();
  mocks.pause.mockImplementation(async () => {
    mocks.syncState.enabled = false;
    mocks.syncListener?.({ ...mocks.syncState }, false);
  });
});

describe("Settings iCloud controls", () => {
  it("offers Sync Now and a safe Turn off action while iCloud Sync is enabled", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen navigate={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Sync Now" })).toBeInTheDocument();
    expect(screen.getByText(/does not delete copies already held in your private iCloud storage/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sync Now" }));
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Turn off iCloud Sync" }));
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Turn on iCloud Sync" })).toBeInTheDocument();
  });

  it("shows a recoverable error when turning iCloud Sync off fails", async () => {
    const user = userEvent.setup();
    mocks.pause.mockRejectedValueOnce(new Error("pause failed"));
    render(<SettingsScreen navigate={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Turn off iCloud Sync" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not turn off iCloud Sync/i));
    expect(screen.getByRole("button", { name: "Turn off iCloud Sync" })).toBeInTheDocument();
  });
});
