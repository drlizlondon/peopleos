import type { IDBPObjectStore, StoreNames } from "idb";
import { prepareNewAffiliation, type AffiliationDraft } from "./affiliations";
import { prepareNewContactMethod, type ContactMethodDraft } from "./contactMethods";
import type { PeopleOsDatabase, PeopleOsDb } from "../data/database";
import { RecordConflictError, StaleRevisionError } from "../data/repositories";
import { commandFingerprint as fingerprintCommand } from "../domain/commandFingerprint";
import type {
  ContactMethod,
  FollowUp,
  FollowUpEvent,
  Interaction,
  MemoryFact,
  OrganisationAffiliation,
  Person,
  ReachOutContext,
  ReachOutEntry,
  ReachOutEvent,
  TodaySkip
} from "../domain/schema";
import { assertValidRecord, isIsoInstant, ValidationError } from "../domain/validation";

export type IdentityResolutionHooks = {
  beforeCommit?: () => void;
};

export type CompleteProvisionalPersonCommand = {
  commandFingerprint: string;
  personId: string;
  expectedRevision: number;
  displayName: string;
  contactMethods: ContactMethodDraft[];
  defaultPhoneRegion: string;
  affiliation?: AffiliationDraft;
  occurredAt: string;
};

export type CompleteProvisionalPersonDetails = {
  contactMethods?: ContactMethodDraft[];
  defaultPhoneRegion?: string;
  affiliation?: AffiliationDraft;
};

export type PreferredContactResolution = "keep_target" | "use_source";

export type ProvisionalResolutionPreview = {
  source: Person;
  target: Person;
  expectedDatasetRevision: number;
  sourceCurrentReachOut?: ReachOutEntry;
  targetCurrentReachOut?: ReachOutEntry;
  preferredContactConflicts: Array<{
    kind: ContactMethod["kind"];
    sourceContactId: string;
    targetContactId: string;
  }>;
  mustKeepMemoryFactIds: string[];
  mustKeepInteractionIds: string[];
  blockingIssues: string[];
  records: {
    reachOutEntries: ReachOutEntry[];
    followUps: FollowUp[];
    interactions: Interaction[];
    memoryFacts: MemoryFact[];
    contactMethods: ContactMethod[];
    affiliations: OrganisationAffiliation[];
    reachOutContexts: ReachOutContext[];
    reachOutEvents: ReachOutEvent[];
    followUpEvents: FollowUpEvent[];
    todaySkips: TodaySkip[];
  };
  counts: {
    reachOutEntries: number;
    followUps: number;
    interactions: number;
    memoryFacts: number;
    contactMethods: number;
    affiliations: number;
    reachOutContexts: number;
    reachOutEvents: number;
    followUpEvents: number;
    todaySkips: number;
  };
};

export type LinkProvisionalPersonCommand = {
  commandFingerprint: string;
  sourcePersonId: string;
  expectedSourceRevision: number;
  targetPersonId: string;
  expectedTargetRevision: number;
  expectedDatasetRevision: number;
  preferredContactResolutions: Partial<Record<ContactMethod["kind"], PreferredContactResolution>>;
  keepMemoryFactIds: string[];
  keepInteractionIds: string[];
  occurredAt: string;
};

export type LinkProvisionalPersonResult = {
  source: Person;
  target: Person;
};

function requireInstant(value: string): void {
  if (!isIsoInstant(value)) throw new ValidationError(["Identity resolution needs a valid time."]);
}

function requireLinkFingerprint(command: LinkProvisionalPersonCommand): void {
  const { commandFingerprint, ...material } = command;
  if (fingerprintCommand(material) !== commandFingerprint) {
    throw new RecordConflictError("The identity-resolution command fingerprint does not match its prepared input.");
  }
}

function requireCompletionFingerprint(command: CompleteProvisionalPersonCommand): void {
  const { commandFingerprint, ...material } = command;
  if (fingerprintCommand(material) !== commandFingerprint) {
    throw new RecordConflictError("The identity-completion command fingerprint does not match its prepared input.");
  }
}

async function updateMetadata<Names extends ArrayLike<StoreNames<PeopleOsDb>>>(
  store: IDBPObjectStore<PeopleOsDb, Names, "metadata", "readwrite">,
  now: string
): Promise<void> {
  const metadata = await store.get("app" as never) as { datasetRevision: number; updatedAt: string } | undefined;
  if (!metadata) throw new Error("PeopleOS metadata is missing");
  await store.put({ ...metadata, datasetRevision: metadata.datasetRevision + 1, updatedAt: now } as never);
}

async function abortAndRethrow(
  transaction: { abort: () => void; done: Promise<unknown> },
  error: unknown
): Promise<never> {
  try { transaction.abort(); } catch { /* transaction already closed */ }
  try { await transaction.done; } catch { /* original error is authoritative */ }
  throw error;
}

function currentReachOut(entries: ReachOutEntry[]): ReachOutEntry | undefined {
  return entries.find((entry) => !entry.removedAt && entry.intentStatus !== "completed");
}

export function prepareCompleteProvisionalPersonCommand(
  person: Person,
  displayName: string,
  now = new Date().toISOString(),
  details: CompleteProvisionalPersonDetails = {}
): CompleteProvisionalPersonCommand {
  if (person.identityStatus !== "provisional" || person.archivedAt) {
    throw new RecordConflictError("Only an active provisional Person can be completed.");
  }
  const name = displayName.trim();
  if (!name) throw new ValidationError(["Add the confirmed display name."]);
  if (name.length > 120) throw new ValidationError(["Display name must be 120 characters or fewer."]);
  requireInstant(now);
  const contactMethods = details.contactMethods ?? [];
  const defaultPhoneRegion = details.defaultPhoneRegion ?? "GB";
  if (new Set(contactMethods.map((draft) => draft.id)).size !== contactMethods.length) {
    throw new ValidationError(["Each contact method needs a unique stable ID."]);
  }
  for (const draft of contactMethods) {
    if (draft.personId !== person.id) throw new RecordConflictError("Contact details must belong to this provisional Person.");
    prepareNewContactMethod(draft, defaultPhoneRegion, false);
  }
  if (details.affiliation) {
    if (details.affiliation.personId !== person.id) throw new RecordConflictError("The affiliation must belong to this provisional Person.");
    prepareNewAffiliation(details.affiliation);
  }
  const prepared = {
    personId: person.id,
    expectedRevision: person.revision,
    displayName: name,
    contactMethods,
    defaultPhoneRegion,
    ...(details.affiliation ? { affiliation: details.affiliation } : {}),
    occurredAt: now
  };
  return { ...prepared, commandFingerprint: fingerprintCommand(prepared) };
}

export async function completeProvisionalPerson(
  db: PeopleOsDatabase,
  command: CompleteProvisionalPersonCommand,
  hooks: IdentityResolutionHooks = {}
): Promise<Person> {
  requireInstant(command.occurredAt);
  requireCompletionFingerprint(command);
  const tx = db.transaction(["people", "contactMethods", "affiliations", "metadata"], "readwrite");
  try {
    const people = tx.objectStore("people");
    const current = await people.get(command.personId);
    if (!current) throw new RecordConflictError("This provisional Person is no longer available.");
    const sameCompletionCoordinates = current.identityStatus === "confirmed"
      && current.displayName === command.displayName
      && current.updatedAt === command.occurredAt;
    if (sameCompletionCoordinates && current.identityCompletionFingerprint !== command.commandFingerprint) {
      throw new RecordConflictError("This identity was completed by a different prepared command.");
    }
    const isRetry = sameCompletionCoordinates
      && current.identityCompletionFingerprint === command.commandFingerprint;
    if (!isRetry) {
      if (current.revision !== command.expectedRevision) throw new StaleRevisionError();
      if (current.identityStatus !== "provisional" || current.archivedAt) {
        throw new RecordConflictError("Only an active provisional Person can be completed.");
      }
    }
    const updated: Person = {
      ...current,
      revision: current.revision + 1,
      displayName: command.displayName,
      identityStatus: "confirmed",
      identityCompletionFingerprint: command.commandFingerprint,
      updatedAt: command.occurredAt
    };
    assertValidRecord("people", updated);

    const contactStore = tx.objectStore("contactMethods");
    const siblings = await contactStore.index("by-person").getAll(command.personId);
    const preparedContacts: ContactMethod[] = [];
    for (const draft of command.contactMethods) {
      const isPreferred = ![...siblings, ...preparedContacts].some((contact) =>
        contact.id !== draft.id && !contact.archivedAt && contact.kind === draft.kind && contact.isPreferred
      );
      const prepared = prepareNewContactMethod(draft, command.defaultPhoneRegion, isPreferred);
      const existing = await contactStore.get(prepared.id);
      if (existing) {
        if (fingerprintCommand(existing) !== fingerprintCommand(prepared)) {
          throw new RecordConflictError(`contactMethods already contains id ${prepared.id}`);
        }
      } else if (isRetry) {
        throw new RecordConflictError("The completed identity is missing one of its prepared contact details.");
      } else {
        await contactStore.add(prepared);
      }
      preparedContacts.push(prepared);
    }

    if (command.affiliation) {
      const prepared = prepareNewAffiliation(command.affiliation);
      const affiliationStore = tx.objectStore("affiliations");
      const existing = await affiliationStore.get(prepared.id);
      if (existing) {
        if (fingerprintCommand(existing) !== fingerprintCommand(prepared)) {
          throw new RecordConflictError(`affiliations already contains id ${prepared.id}`);
        }
      } else if (isRetry) {
        throw new RecordConflictError("The completed identity is missing its prepared affiliation.");
      } else {
        await affiliationStore.add(prepared);
      }
    }

    if (isRetry) {
      await tx.done;
      return current;
    }
    await people.put(updated);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return updated;
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}

export async function getProvisionalResolutionPreview(
  db: PeopleOsDatabase,
  sourcePersonId: string,
  targetPersonId: string
): Promise<ProvisionalResolutionPreview> {
  const tx = db.transaction([
    "people", "reachOutEntries", "followUps", "interactions", "memoryFacts",
    "contactMethods", "affiliations", "todaySkips", "followUpEvents", "reachOutEvents",
    "reachOutContexts", "metadata"
  ], "readonly");
  const [source, target, sourceReachOut, targetReachOut, followUps, interactions, facts, sourceContacts,
    targetContacts, affiliations, todaySkips, allFollowUpEvents, allReachOutEvents, allReachOutContexts, metadata] = await Promise.all([
    tx.objectStore("people").get(sourcePersonId),
    tx.objectStore("people").get(targetPersonId),
    tx.objectStore("reachOutEntries").index("by-person").getAll(sourcePersonId),
    tx.objectStore("reachOutEntries").index("by-person").getAll(targetPersonId),
    tx.objectStore("followUps").index("by-person").getAll(sourcePersonId),
    tx.objectStore("interactions").index("by-person").getAll(sourcePersonId),
    tx.objectStore("memoryFacts").index("by-person").getAll(sourcePersonId),
    tx.objectStore("contactMethods").index("by-person").getAll(sourcePersonId),
    tx.objectStore("contactMethods").index("by-person").getAll(targetPersonId),
    tx.objectStore("affiliations").index("by-person").getAll(sourcePersonId),
    tx.objectStore("todaySkips").index("by-person").getAll(sourcePersonId),
    tx.objectStore("followUpEvents").index("by-person").getAll(sourcePersonId),
    tx.objectStore("reachOutEvents").getAll(),
    tx.objectStore("reachOutContexts").getAll(),
    tx.objectStore("metadata").get("app")
  ]);
  await tx.done;
  if (!source || source.identityStatus !== "provisional" || source.archivedAt) {
    throw new RecordConflictError("Choose an active provisional Person to resolve.");
  }
  if (!target || target.identityStatus !== "confirmed" || target.archivedAt || source.id === target.id) {
    throw new RecordConflictError("Choose a different active confirmed Person.");
  }
  const preferredContactConflicts = sourceContacts.flatMap((sourceContact) => {
    if (sourceContact.archivedAt || !sourceContact.isPreferred) return [];
    const targetContact = targetContacts.find((candidate) => !candidate.archivedAt
      && candidate.isPreferred && candidate.kind === sourceContact.kind);
    return targetContact ? [{
      kind: sourceContact.kind,
      sourceContactId: sourceContact.id,
      targetContactId: targetContact.id
    }] : [];
  });
  if (!metadata) throw new RecordConflictError("PeopleOS metadata is missing.");
  const sourceReachOutIds = new Set(sourceReachOut.map((entry) => entry.id));
  const sourceFollowUpIds = new Set(followUps.map((followUp) => followUp.id));
  const referencedContextIds = new Set(sourceReachOut.flatMap((entry) => entry.contextIds));
  const reachOutContexts = allReachOutContexts.filter((context) => referencedContextIds.has(context.id));
  const followUpEvents = allFollowUpEvents.filter((event) => sourceFollowUpIds.has(event.followUpId));
  const reachOutEvents = allReachOutEvents.filter((event) => sourceReachOutIds.has(event.reachOutEntryId));
  const lifecycleInteractionIds = new Set([
    ...followUpEvents.flatMap((event) => event.interactionId ? [event.interactionId] : []),
    ...reachOutEvents.flatMap((event) => sourceReachOutIds.has(event.reachOutEntryId) && event.interactionId
      ? [event.interactionId]
      : [])
  ]);
  const keepFactIds = new Set(facts
    .filter((fact) => fact.relatedPersonId === target.id)
    .map((fact) => fact.id));
  const keepInteractionIds = new Set(interactions
    .filter((interaction) => interaction.relatedPersonId === target.id)
    .map((interaction) => interaction.id));
  let closureChanged = true;
  while (closureChanged) {
    closureChanged = false;
    for (const fact of facts) {
      if (keepFactIds.has(fact.id) && fact.sourceInteractionId && !keepInteractionIds.has(fact.sourceInteractionId)) {
        keepInteractionIds.add(fact.sourceInteractionId);
        closureChanged = true;
      }
      if (fact.sourceInteractionId && keepInteractionIds.has(fact.sourceInteractionId) && !keepFactIds.has(fact.id)) {
        keepFactIds.add(fact.id);
        closureChanged = true;
      }
    }
  }
  const blockingIssues = [...keepInteractionIds]
    .filter((id) => lifecycleInteractionIds.has(id))
    .map(() => "A retained memory or self-reference depends on lifecycle history that must move. Edit that reference before linking these People.");
  return {
    source,
    target,
    expectedDatasetRevision: metadata.datasetRevision,
    ...(currentReachOut(sourceReachOut) ? { sourceCurrentReachOut: currentReachOut(sourceReachOut) } : {}),
    ...(currentReachOut(targetReachOut) ? { targetCurrentReachOut: currentReachOut(targetReachOut) } : {}),
    preferredContactConflicts,
    mustKeepMemoryFactIds: [...keepFactIds].sort(),
    mustKeepInteractionIds: [...keepInteractionIds].sort(),
    blockingIssues: [...new Set(blockingIssues)],
    records: {
      reachOutEntries: sourceReachOut,
      followUps,
      interactions,
      memoryFacts: facts,
      contactMethods: sourceContacts,
      affiliations,
      reachOutContexts,
      reachOutEvents,
      followUpEvents,
      todaySkips
    },
    counts: {
      reachOutEntries: sourceReachOut.length,
      followUps: followUps.length,
      interactions: interactions.length,
      memoryFacts: facts.length,
      contactMethods: sourceContacts.length,
      affiliations: affiliations.length,
      reachOutContexts: reachOutContexts.length,
      reachOutEvents: reachOutEvents.length,
      followUpEvents: followUpEvents.length,
      todaySkips: todaySkips.length
    }
  };
}

export function prepareLinkProvisionalPersonCommand(
  preview: ProvisionalResolutionPreview,
  options: {
    preferredContactResolutions?: Partial<Record<ContactMethod["kind"], PreferredContactResolution>>;
    keepMemoryFactIds?: string[];
    now?: string;
  } = {}
): LinkProvisionalPersonCommand {
  if (preview.sourceCurrentReachOut && preview.targetCurrentReachOut) {
    throw new RecordConflictError("Both People have a current Reach Out plan. Complete or remove one plan before linking them.");
  }
  if (preview.blockingIssues.length) throw new RecordConflictError(preview.blockingIssues[0]);
  const resolutions = options.preferredContactResolutions ?? {};
  for (const conflict of preview.preferredContactConflicts) {
    if (!resolutions[conflict.kind]) {
      throw new ValidationError([`Choose which ${conflict.kind} contact stays preferred.`]);
    }
  }
  const keepMemoryFactIds = [...new Set([
    ...(options.keepMemoryFactIds ?? []),
    ...preview.mustKeepMemoryFactIds
  ])];
  const now = options.now ?? new Date().toISOString();
  requireInstant(now);
  const prepared = {
    sourcePersonId: preview.source.id,
    expectedSourceRevision: preview.source.revision,
    targetPersonId: preview.target.id,
    expectedTargetRevision: preview.target.revision,
    expectedDatasetRevision: preview.expectedDatasetRevision,
    preferredContactResolutions: resolutions,
    keepMemoryFactIds,
    keepInteractionIds: preview.mustKeepInteractionIds,
    occurredAt: now
  };
  return { ...prepared, commandFingerprint: fingerprintCommand(prepared) };
}

export async function linkProvisionalPerson(
  db: PeopleOsDatabase,
  command: LinkProvisionalPersonCommand,
  hooks: IdentityResolutionHooks = {}
): Promise<LinkProvisionalPersonResult> {
  requireInstant(command.occurredAt);
  requireLinkFingerprint(command);
  const tx = db.transaction([
    "people", "contactMethods", "affiliations", "interactions", "memoryFacts",
    "followUps", "followUpEvents", "todaySkips", "reachOutEntries", "metadata"
  ], "readwrite");
  try {
    const people = tx.objectStore("people");
    const source = await people.get(command.sourcePersonId);
    const target = await people.get(command.targetPersonId);
    if (source?.identityStatus === "merged" && source.mergedIntoPersonId === command.targetPersonId
      && source.updatedAt === command.occurredAt
      && source.mergeCommandFingerprint === command.commandFingerprint && target) {
      await tx.done;
      return { source, target };
    }
    if (!source || source.revision !== command.expectedSourceRevision) throw new StaleRevisionError();
    if (!target || target.revision !== command.expectedTargetRevision) throw new StaleRevisionError();
    const metadata = await tx.objectStore("metadata").get("app");
    if (!metadata || metadata.datasetRevision !== command.expectedDatasetRevision) throw new StaleRevisionError();
    if (source.identityStatus !== "provisional" || source.archivedAt) {
      throw new RecordConflictError("Choose an active provisional Person to resolve.");
    }
    if (target.identityStatus !== "confirmed" || target.archivedAt || source.id === target.id) {
      throw new RecordConflictError("Choose a different active confirmed Person.");
    }

    const reachOutStore = tx.objectStore("reachOutEntries");
    const [sourceReachOut, targetReachOut] = await Promise.all([
      reachOutStore.index("by-person").getAll(source.id),
      reachOutStore.index("by-person").getAll(target.id)
    ]);
    if (currentReachOut(sourceReachOut) && currentReachOut(targetReachOut)) {
      throw new RecordConflictError("Both People have a current Reach Out plan. Complete or remove one plan before linking them.");
    }

    const contactStore = tx.objectStore("contactMethods");
    const [sourceContacts, targetContacts] = await Promise.all([
      contactStore.index("by-person").getAll(source.id),
      contactStore.index("by-person").getAll(target.id)
    ]);
    for (const sourceContact of sourceContacts) {
      let preferred = sourceContact.isPreferred;
      if (!sourceContact.archivedAt && sourceContact.isPreferred) {
        const targetPreferred = targetContacts.find((candidate) => !candidate.archivedAt
          && candidate.isPreferred && candidate.kind === sourceContact.kind);
        if (targetPreferred) {
          const resolution = command.preferredContactResolutions[sourceContact.kind];
          if (!resolution) throw new ValidationError([`Choose which ${sourceContact.kind} contact stays preferred.`]);
          if (resolution === "keep_target") preferred = false;
          else {
            await contactStore.put({
              ...targetPreferred,
              revision: targetPreferred.revision + 1,
              isPreferred: false,
              updatedAt: command.occurredAt
            });
          }
        }
      }
      await contactStore.put({
        ...sourceContact,
        revision: sourceContact.revision + 1,
        personId: target.id,
        isPreferred: preferred,
        updatedAt: command.occurredAt
      });
    }

    const affiliationStore = tx.objectStore("affiliations");
    for (const affiliation of await affiliationStore.index("by-person").getAll(source.id)) {
      await affiliationStore.put({
        ...affiliation,
        revision: affiliation.revision + 1,
        personId: target.id,
        updatedAt: command.occurredAt
      });
    }

    const interactionStore = tx.objectStore("interactions");
    const keepInteractions = new Set(command.keepInteractionIds);
    for (const interaction of await interactionStore.index("by-person").getAll(source.id)) {
      if (keepInteractions.has(interaction.id)) continue;
      if (interaction.relatedPersonId === target.id) {
        throw new ValidationError(["A self-referential interaction must remain with the provisional history."]);
      }
      const updated: Interaction = {
        ...interaction,
        revision: interaction.revision + 1,
        personId: target.id,
        updatedAt: command.occurredAt
      };
      assertValidRecord("interactions", updated);
      await interactionStore.put(updated);
    }

    const factStore = tx.objectStore("memoryFacts");
    const keepFacts = new Set(command.keepMemoryFactIds);
    for (const fact of await factStore.index("by-person").getAll(source.id)) {
      if (keepFacts.has(fact.id)) continue;
      if (fact.kind === "introduced_by" && fact.relatedPersonId === target.id) {
        throw new ValidationError(["A self-referential introduction fact must remain with the provisional history."]);
      }
      if (fact.sourceInteractionId && keepInteractions.has(fact.sourceInteractionId)) {
        throw new ValidationError(["A memory fact cannot move without its source interaction."]);
      }
      const updated: MemoryFact = {
        ...fact,
        revision: fact.revision + 1,
        personId: target.id,
        updatedAt: command.occurredAt
      };
      assertValidRecord("memoryFacts", updated);
      await factStore.put(updated);
    }

    const followUpStore = tx.objectStore("followUps");
    const sourceFollowUps = await followUpStore.index("by-person").getAll(source.id);
    for (const followUp of sourceFollowUps) {
      await followUpStore.put({
        ...followUp,
        revision: followUp.revision + 1,
        personId: target.id,
        updatedAt: command.occurredAt
      });
    }

    // Identity resolution is the sole owner-correction exception for append-only
    // FollowUpEvent records. IDs, kinds, timestamps, dates and links are preserved.
    const followUpEventStore = tx.objectStore("followUpEvents");
    for (const event of await followUpEventStore.index("by-person").getAll(source.id)) {
      await followUpEventStore.put({ ...event, personId: target.id });
    }

    const skipStore = tx.objectStore("todaySkips");
    for (const skip of await skipStore.index("by-person").getAll(source.id)) {
      const targetId = `${target.id}:${skip.localDate}`;
      const targetSkip = await skipStore.get(targetId);
      await skipStore.delete(skip.id);
      if (!targetSkip) await skipStore.add({ ...skip, id: targetId, personId: target.id });
    }

    for (const entry of sourceReachOut) {
      await reachOutStore.put({
        ...entry,
        revision: entry.revision + 1,
        personId: target.id,
        updatedAt: command.occurredAt
      });
    }

    const merged: Person = {
      ...source,
      revision: source.revision + 1,
      identityStatus: "merged",
      mergedIntoPersonId: target.id,
      mergeCommandFingerprint: command.commandFingerprint,
      updatedAt: command.occurredAt
    };
    assertValidRecord("people", merged);
    await people.put(merged);
    await updateMetadata(tx.objectStore("metadata"), command.occurredAt);
    hooks.beforeCommit?.();
    await tx.done;
    return { source: merged, target };
  } catch (error) {
    return abortAndRethrow(tx, error);
  }
}
