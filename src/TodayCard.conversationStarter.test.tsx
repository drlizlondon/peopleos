import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TodayCardProjection } from "./application/todayQueries";
import TodayCard from "./TodayCard";

function card(
  person: { displayName: string; conversationalName?: string },
  conversationStarters: TodayCardProjection["conversationStarters"]
): TodayCardProjection {
  return {
    item: {
      personId: "person-elizabeth",
      eligibilityCode: "new_relationship",
      dueState: "due_today",
      relevantDate: "2026-08-13",
      additionalDueFollowUpIds: [],
      explanation: { code: "new_relationship", templateKey: "new_relationship", facts: [] },
      intendedActionContext: {
        code: "message",
        source: "none",
        explanation: { code: "message", templateKey: "message", facts: [] }
      }
    },
    person: {
      id: "person-elizabeth",
      revision: 1,
      ...person,
      identityStatus: "confirmed",
      importance: "normal",
      tags: [],
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z"
    },
    additionalDueFollowUps: [],
    conversationStarters,
    contact: { targets: [], hasActivePhone: false }
  };
}

function props(overrides: Partial<Parameters<typeof TodayCard>[0]> = {}): Parameters<typeof TodayCard>[0] {
  return {
    card: card({ displayName: "Elizabeth Soyode", conversationalName: "Elizabeth Soyode" }, [{
      id: "starter-one",
      template: "Hey {name}, what’s new with you?",
      relationshipMode: "personal"
    }]),
    busy: false,
    expanded: true,
    selectedStarterId: "starter-one",
    onMessage: vi.fn(),
    onCall: vi.fn(),
    onAnother: vi.fn(),
    onExpand: vi.fn(),
    onComplete: vi.fn(),
    onNotToday: vi.fn(),
    onProfile: vi.fn(),
    ...overrides
  };
}

describe("TodayCard controlled shell", () => {
  it("uses the safe legacy fallback and then an explicit familiar name in starter copy", () => {
    const legacyCard = card({ displayName: "Elizabeth Soyode" }, [{
      id: "starter-one",
      template: "Hey {name}, what’s new with you?",
      relationshipMode: "personal"
    }]);
    const { rerender } = render(<TodayCard {...props({ card: legacyCard })} />);
    expect(screen.getByText("Hey Elizabeth, what’s new with you?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elizabeth Soyode" })).toBeInTheDocument();

    rerender(<TodayCard {...props({
      card: card({ displayName: "Elizabeth Soyode", conversationalName: "Lizzie" }, [{
        id: "starter-one",
        template: "Hey {name}, what’s new with you?",
        relationshipMode: "personal"
      }])
    })} />);
    expect(screen.getByText("Hey Lizzie, what’s new with you?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lizzie" })).toBeInTheDocument();
  });

  it("preserves authored quote characters without adding another pair", () => {
    render(<TodayCard {...props({
      card: card({ displayName: "Elizabeth Soyode", conversationalName: "Lizzie" }, [{
        id: "starter-quoted",
        template: "You said “hello”, {name}.",
        relationshipMode: "personal"
      }])
    })} />);

    expect(screen.getByText("You said “hello”, Lizzie.")).toBeInTheDocument();
    expect(screen.queryByText("“You said “hello”, Lizzie.”")).not.toBeInTheDocument();
  });

  it("keeps profile navigation separate from its accessible disclosure", async () => {
    const user = userEvent.setup();
    const onProfile = vi.fn();
    const onExpand = vi.fn();
    const collapsedProps = props({ expanded: false, onProfile, onExpand });
    const { rerender } = render(<TodayCard {...collapsedProps} />);

    const disclosure = screen.getByRole("button", { name: "Show actions for Elizabeth Soyode" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls", "today-card-body-person-elizabeth");
    expect(document.getElementById("today-card-body-person-elizabeth")).toHaveAttribute("hidden");
    expect(screen.queryByRole("button", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hey Elizabeth, what’s new with you?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Elizabeth Soyode" }));
    await user.click(disclosure);
    expect(onProfile).toHaveBeenCalledOnce();
    expect(onExpand).toHaveBeenCalledOnce();

    rerender(<TodayCard {...collapsedProps} expanded />);
    expect(screen.getByRole("button", { name: "Collapse actions for Elizabeth Soyode" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not today" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByText("Conversation starter")).not.toBeInTheDocument();
  });

  it("quietly identifies a person brought forward while keeping their affiliation", () => {
    const base = card({ displayName: "Bibi Johnson" }, []);
    const promoted: TodayCardProjection = {
      ...base,
      item: { ...base.item, eligibilityCode: "brought_to_today" },
      currentAffiliation: {
        id: "affiliation-bibi",
        revision: 1,
        personId: base.person.id,
        organisationName: "GreatInternet",
        role: "Founder",
        isCurrent: true,
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-01T09:00:00.000Z"
      }
    };

    render(<TodayCard {...props({ card: promoted, selectedStarterId: undefined })} />);

    expect(screen.getByText("Founder · GreatInternet")).toBeInTheDocument();
    expect(screen.getByText("Brought to Today")).toHaveClass("today-brought-forward");
  });

  it("renders the parent-selected suggestion and asks the parent to advance it", async () => {
    const user = userEvent.setup();
    const onAnother = vi.fn();
    const ordered = [{
      id: "starter-unused",
      template: "Hey {name}, what’s new?",
      relationshipMode: "personal" as const
    }, {
      id: "starter-used",
      template: "How have you been, {name}?",
      relationshipMode: "personal" as const,
      lastUsedDate: "2025-11-14" as const
    }];
    const controlledProps = props({
      card: card({ displayName: "Bibi Johnson", conversationalName: "Bibi" }, ordered),
      selectedStarterId: "starter-unused",
      onAnother
    });
    const { rerender } = render(<TodayCard {...controlledProps} />);

    expect(screen.getByText("Hey Bibi, what’s new?")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText(/Last used:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /another conversation starter/i }));
    expect(onAnother).toHaveBeenCalledOnce();
    expect(screen.getByText("Hey Bibi, what’s new?")).toBeInTheDocument();

    rerender(<TodayCard {...controlledProps} selectedStarterId="starter-used" />);
    expect(screen.getByText("How have you been, Bibi?")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Last used: 14/11/2025")).toBeInTheDocument();

    rerender(<TodayCard
      {...controlledProps}
      card={card({ displayName: "Bibi Johnson", conversationalName: "Bibi" }, [...ordered].reverse())}
      selectedStarterId="starter-used"
    />);
    expect(screen.getByText("How have you been, Bibi?")).toBeInTheDocument();
  });

  it("carries starter identity only through Message", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    const onCall = vi.fn();
    const onComplete = vi.fn();
    const onNotToday = vi.fn();
    render(<TodayCard {...props({
      card: card({ displayName: "Bibi Johnson", conversationalName: "Bibi" }, [{
        id: "starter-one",
        template: "First prompt for {name}.",
        relationshipMode: "personal"
      }, {
        id: "starter-two",
        template: "Second prompt for {name}.",
        relationshipMode: "personal"
      }]),
      selectedStarterId: "starter-two",
      onMessage,
      onCall,
      onComplete,
      onNotToday
    })} />);

    expect(screen.getByText("Second prompt for Bibi.")).toHaveAttribute("aria-live", "polite");
    expect(onMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Call" }));
    await user.click(screen.getByRole("button", { name: "Not today" }));
    await user.click(screen.getByRole("button", { name: "Mark Bibi complete" }));
    expect(onCall).toHaveBeenCalledOnce();
    expect(onNotToday).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Message" }));
    expect(onMessage).toHaveBeenCalledWith({
      draft: "Second prompt for Bibi.",
      starterId: "starter-two",
      starterTemplate: "Second prompt for {name}."
    });
  });

  it("falls back to the first ordered suggestion when the selected id disappears", () => {
    const first = {
      id: "starter-first",
      template: "First prompt for {name}.",
      relationshipMode: "personal" as const,
      lastUsedAt: "2026-08-13T08:00:00.000Z",
      lastUsedDate: "2026-08-13" as const
    };
    const second = {
      id: "starter-second",
      template: "Second prompt for {name}.",
      relationshipMode: "personal" as const,
      lastUsedAt: "2026-08-13T09:00:00.000Z",
      lastUsedDate: "2026-08-13" as const
    };
    const { rerender } = render(<TodayCard {...props({
      card: card({ displayName: "Bibi Johnson" }, [first, second]),
      selectedStarterId: "starter-second"
    })} />);
    expect(screen.getByText("Second prompt for Bibi.")).toBeInTheDocument();

    rerender(<TodayCard {...props({
      card: card({ displayName: "Bibi Johnson" }, [first]),
      selectedStarterId: "starter-second"
    })} />);

    expect(screen.getByText("First prompt for Bibi.")).toBeInTheDocument();
  });

  it("makes completion a circular control with saving and completed visual states", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const base = props({ onComplete });
    const { rerender } = render(<TodayCard {...base} />);

    const tick = screen.getByRole("button", { name: "Mark Elizabeth Soyode complete" });
    expect(tick).toHaveClass("today-completion-tick");
    expect(tick).toBeEnabled();
    await user.click(tick);
    expect(onComplete).toHaveBeenCalledOnce();

    rerender(<TodayCard {...base} completionState="saving" />);
    const article = screen.getByRole("article", { name: "Elizabeth Soyode" });
    expect(article).toHaveClass("today-card--completing");
    expect(article).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Marking Elizabeth Soyode complete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not today" })).toBeDisabled();

    rerender(<TodayCard {...base} completionState="complete" />);
    expect(article).toHaveClass("today-card--complete", "today-card--collapsed");
    expect(screen.getByRole("button", { name: "Elizabeth Soyode completed" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Elizabeth Soyode completed.");
    expect(screen.queryByRole("button", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show actions for Elizabeth Soyode" })).toBeDisabled();
  });

  it("disables every card control while a screen-wide action is busy", () => {
    render(<TodayCard {...props({
      busy: true,
      error: "Could not open the contact action.",
      copyValue: "+447900123456",
      onRetry: vi.fn(),
      onCopy: vi.fn()
    })} />);

    expect(screen.getByRole("article", { name: "Elizabeth Soyode" })).toHaveAttribute("aria-busy", "true");
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
