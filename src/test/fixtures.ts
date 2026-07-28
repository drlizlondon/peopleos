import type { PeopleOsData } from "../domain/schema";

export const fixedNow = "2026-08-01T09:00:00.000Z";

export function completeData(): PeopleOsData {
  return {
    people: [{
      id: "person-sarah",
      revision: 1,
      displayName: "Sarah Ahmed",
      identityStatus: "confirmed",
      relationshipMode: "personal",
      importance: "high",
      tags: ["fellowship"],
      contactCadenceDays: 90,
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    contactMethods: [{
      id: "contact-sarah-phone",
      revision: 1,
      personId: "person-sarah",
      kind: "phone",
      rawValue: "07900 123456",
      canonicalValue: "+447900123456",
      region: "GB",
      isPreferred: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    affiliations: [{
      id: "affiliation-sarah",
      revision: 1,
      personId: "person-sarah",
      organisationName: "NHS Fellowship",
      role: "Fellow",
      startedOn: "2026-08-01",
      isCurrent: true,
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    interactions: [{
      id: "interaction-met-sarah",
      revision: 1,
      personId: "person-sarah",
      kind: "met",
      occurredAt: fixedNow,
      summary: "Met at the AI Fellowship",
      eventId: "event-fellowship",
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    events: [{
      id: "event-fellowship",
      revision: 1,
      name: "AI Fellowship",
      occurredOn: "2026-08-01",
      location: "London",
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    memoryFacts: [{
      id: "fact-sarah-interest",
      revision: 1,
      personId: "person-sarah",
      kind: "interest",
      value: "NHS AI pilots",
      showAsMemoryCue: true,
      sourceInteractionId: "interaction-met-sarah",
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    followUps: [{
      id: "follow-up-sarah",
      revision: 1,
      personId: "person-sarah",
      dueDate: "2026-08-08",
      reason: "Send the pilot update",
      actionType: "send_update",
      reachOutEntryId: "reach-out-sarah",
      status: "pending",
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    followUpEvents: [{
      id: "follow-up-event-created",
      followUpId: "follow-up-sarah",
      personId: "person-sarah",
      kind: "created",
      occurredAt: fixedNow,
      toDate: "2026-08-08"
    }],
    todaySkips: [{
      id: "person-sarah:2026-08-01",
      personId: "person-sarah",
      localDate: "2026-08-01",
      createdAt: fixedNow
    }],
    reachOutEntries: [{
      id: "reach-out-sarah",
      revision: 1,
      personId: "person-sarah",
      reason: "Share the NHS AI pilot update",
      intendedActionType: "send_update",
      intentStatus: "active",
      currentFollowUpId: "follow-up-sarah",
      contextIds: ["context-fellowship"],
      addedAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    reachOutEvents: [{
      id: "reach-out-event-added",
      reachOutEntryId: "reach-out-sarah",
      kind: "added",
      occurredAt: fixedNow
    }, {
      id: "reach-out-event-linked",
      reachOutEntryId: "reach-out-sarah",
      kind: "follow_up_linked",
      occurredAt: fixedNow,
      followUpId: "follow-up-sarah"
    }],
    reachOutContexts: [{
      id: "context-fellowship",
      revision: 1,
      kind: "fellowship",
      label: "AI Fellowship",
      eventId: "event-fellowship",
      createdAt: fixedNow,
      updatedAt: fixedNow
    }],
    appSettings: [{
      id: "app",
      revision: 1,
      defaultPhoneRegion: "GB",
      captureMode: "standard",
      alreadyContactedDefaultReminderDays: 14,
      reachOutDefaultReminderDays: 7,
      createdAt: fixedNow,
      updatedAt: fixedNow
    }]
  };
}
