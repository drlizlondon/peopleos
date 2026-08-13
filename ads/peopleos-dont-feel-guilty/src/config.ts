export type DayMomentKind = "morning" | "work" | "errands" | "evening" | "late";

export type DayMoment = {
  time: string;
  label: string;
  detail: string;
  kind: DayMomentKind;
};

export type SceneWindow = {
  start: number;
  end: number;
};

export type PeopleOSAdConfig = {
  durationSeconds: number;
  copy: {
    opening: string;
    guiltLead: string;
    guiltAction: string;
    guiltEmphasis: string;
    bridge: string;
    promise: string;
    endLine: string;
    cta: string;
  };
  scenario: {
    personName: string;
    personInitial: string;
    relationshipLabel: string;
    notificationTime: string;
    notificationBody: string;
    conversationStarter: string;
    dayMoments: DayMoment[];
  };
  timings: {
    opening: SceneWindow;
    guilt: SceneWindow;
    day: SceneWindow;
    bridge: SceneWindow;
    product: SceneWindow;
    end: SceneWindow;
  };
};

export const defaultAdConfig: PeopleOSAdConfig = {
  durationSeconds: 13.5,
  copy: {
    opening: "Don’t feel guilty.",
    guiltLead: "You forgot to",
    guiltAction: "message her",
    guiltEmphasis: "AGAIN.",
    bridge: "Life is ridiculously full.",
    promise: "Let PeopleOS remember for you.",
    endLine: "Keep in touch with the people you mean to.",
    cta: "Join the iPhone beta waitlist"
  },
  scenario: {
    personName: "Sarah Jones",
    personInitial: "S",
    relationshipLabel: "Personal",
    notificationTime: "12:00",
    notificationBody: "1 person is on your list today.",
    conversationStarter: "Hey Sarah, just thinking of you today.",
    dayMoments: [
      {time: "07:12", label: "Morning", detail: "Up and out", kind: "morning"},
      {time: "09:03", label: "Work", detail: "Back-to-back", kind: "work"},
      {time: "17:36", label: "Errands", detail: "Just three more things", kind: "errands"},
      {time: "20:18", label: "Evening", detail: "Finally home", kind: "evening"},
      {time: "23:48", label: "Suddenly…", detail: "It’s that late", kind: "late"}
    ]
  },
  timings: {
    opening: {start: 0, end: 1.55},
    guilt: {start: 1.35, end: 3.25},
    day: {start: 3.05, end: 5.95},
    bridge: {start: 5.75, end: 7.45},
    product: {start: 7.25, end: 11.05},
    end: {start: 10.85, end: 13.5}
  }
};
