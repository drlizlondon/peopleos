import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONVERSATION_STARTERS, type AppSettings } from "../domain/schema";
import NotificationSettingsSection from "./NotificationSettingsSection";

const mocks = vi.hoisted(() => ({
  runtime: {
    supported: true,
    permission: "prompt" as "prompt" | "granted" | "denied",
    scheduledCount: 0,
    incompleteRegularScheduleCount: 0
  },
  enable: vi.fn(),
  disable: vi.fn(),
  changeTime: vi.fn(),
  recoverSettings: vi.fn()
}));

vi.mock("./service", () => ({
  getTodayNotificationRuntimeState: () => ({ ...mocks.runtime }),
  subscribeToTodayNotificationState: (listener: (state: typeof mocks.runtime) => void) => {
    listener({ ...mocks.runtime });
    return () => undefined;
  },
  enableTodayNotifications: mocks.enable,
  disableTodayNotifications: mocks.disable,
  changeTodayNotificationTime: mocks.changeTime,
  recoverTodayNotificationSettings: mocks.recoverSettings
}));

const settings: AppSettings = {
  id: "app",
  revision: 1,
  defaultPhoneRegion: "GB",
  captureMode: "standard",
  alreadyContactedDefaultReminderDays: 14,
  todaySummaryNotificationsEnabled: false,
  todaySummaryNotificationTime: "12:00",
  conversationStarters: DEFAULT_CONVERSATION_STARTERS.map((starter) => ({ ...starter })),
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z"
};

beforeEach(() => {
  mocks.runtime.supported = true;
  mocks.runtime.permission = "prompt";
  mocks.runtime.scheduledCount = 0;
  mocks.runtime.incompleteRegularScheduleCount = 0;
  mocks.enable.mockReset();
  mocks.disable.mockReset();
  mocks.changeTime.mockReset();
  mocks.recoverSettings.mockReset();
});

describe("Today notification Settings", () => {
  it("defaults to Off at 12:00 and never requests permission on render", () => {
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Today reminders" })).not.toBeChecked();
    expect(screen.getByLabelText("Reminder time")).toHaveValue("12:00");
    expect(screen.getByLabelText("Reminder time")).toBeDisabled();
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(screen.getByText(/never include names, notes, reasons or relationship details/i)).toBeInTheDocument();
  });

  it("requests permission only after the user turns reminders on", async () => {
    const user = userEvent.setup();
    const saved = { ...settings, revision: 2, todaySummaryNotificationsEnabled: true };
    mocks.enable.mockResolvedValue(saved);
    const onChanged = vi.fn();
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={onChanged} />);
    await user.click(screen.getByRole("switch", { name: "Today reminders" }));
    expect(mocks.enable).toHaveBeenCalledWith(settings);
    expect(onChanged).toHaveBeenCalledWith(saved);
  });

  it("saves a changed time and can turn reminders off", async () => {
    const user = userEvent.setup();
    mocks.runtime.permission = "granted";
    mocks.runtime.scheduledCount = 30;
    const enabled = { ...settings, todaySummaryNotificationsEnabled: true };
    const changed = { ...enabled, revision: 2, todaySummaryNotificationTime: "08:30" };
    const disabled = { ...changed, revision: 3, todaySummaryNotificationsEnabled: false };
    mocks.changeTime.mockResolvedValue(changed);
    mocks.disable.mockResolvedValue(disabled);
    const onChanged = vi.fn();
    const view = render(<NotificationSettingsSection settings={enabled} onSettingsChanged={onChanged} />);
    const time = screen.getByLabelText("Reminder time");
    fireEvent.change(time, { target: { value: "08:30" } });
    fireEvent.blur(time);
    await waitFor(() => expect(mocks.changeTime).toHaveBeenCalledWith(enabled, "08:30"));
    expect(onChanged).toHaveBeenCalledWith(changed);

    view.rerender(<NotificationSettingsSection settings={changed} onSettingsChanged={onChanged} />);
    await user.click(screen.getByRole("switch", { name: "Today reminders" }));
    expect(mocks.disable).toHaveBeenCalledWith(changed);
    expect(onChanged).toHaveBeenCalledWith(disabled);
  });

  it("shows a denied state without exposing a misleading enabled control", () => {
    mocks.runtime.permission = "denied";
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={vi.fn()} />);
    expect(screen.getByText("Off · Permission denied")).toBeInTheDocument();
    expect(screen.getByText(/allow them in iPhone Settings/i)).toBeInTheDocument();
  });

  it("does not call an incomplete regular schedule an empty Today list", () => {
    mocks.runtime.permission = "granted";
    mocks.runtime.incompleteRegularScheduleCount = 1;
    render(<NotificationSettingsSection
      settings={{ ...settings, todaySummaryNotificationsEnabled: true }}
      onSettingsChanged={vi.fn()}
    />);
    expect(screen.getByText("On · Regular contact needs a start date")).toBeInTheDocument();
    expect(screen.queryByText("On · Nothing is waiting in Today")).not.toBeInTheDocument();
  });

  it("tells the user exactly which iPhone settings to change, without claiming to know them", () => {
    mocks.runtime.permission = "granted";
    render(<NotificationSettingsSection
      settings={{ ...settings, todaySummaryNotificationsEnabled: true }}
      onSettingsChanged={vi.fn()}
    />);

    const steps = screen.getByRole("list", { name: "Make reminders harder to miss" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(within(steps).getByText("Settings → Sounds & Haptics → Haptics")).toBeInTheDocument();
    expect(within(steps).getByText("Always Play")).toBeInTheDocument();
    expect(within(steps).getByText("Persistent")).toBeInTheDocument();
    expect(screen.getByText(/PeopleOS cannot check these for you/i)).toBeInTheDocument();
  });

  it("opens the app's own iPhone Settings page and never a private Settings deep link", () => {
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Open iPhone Settings" });
    // prefs:root= deep links into other panes are private API and get apps rejected.
    expect(link).toHaveAttribute("href", "app-settings:");
    expect(document.body.innerHTML).not.toContain("prefs:root");
  });

  it("hides the iPhone setup guidance on the web, where none of it applies", () => {
    mocks.runtime.supported = false;
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "Open iPhone Settings" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Make reminders harder to miss/i)).not.toBeInTheDocument();
  });

  it("reloads settings changed by iCloud instead of repeatedly saving a stale revision", async () => {
    const user = userEvent.setup();
    const latest = { ...settings, revision: 2, todaySummaryNotificationTime: "08:30" };
    const conflict = new Error("stale revision");
    mocks.enable.mockRejectedValue(conflict);
    mocks.recoverSettings.mockResolvedValue(latest);
    const onChanged = vi.fn();
    render(<NotificationSettingsSection settings={settings} onSettingsChanged={onChanged} />);
    await user.click(screen.getByRole("switch", { name: "Today reminders" }));
    expect(mocks.recoverSettings).toHaveBeenCalledWith(conflict);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(latest));
    expect(screen.getByRole("alert")).toHaveTextContent(/changed on another device/i);
    expect(screen.getByLabelText("Reminder time")).toHaveValue("08:30");
  });
});
