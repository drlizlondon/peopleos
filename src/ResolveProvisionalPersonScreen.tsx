import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import EmptyState from "./EmptyState";
import {
  createContactMethodDraft,
  type ContactMethodDraft
} from "./application/contactMethods";
import {
  createAffiliationDraft,
  type AffiliationDraft
} from "./application/affiliations";
import { listActivePersonOptions, type PersonPickerOption } from "./application/interactionQueries";
import { getAppSettings } from "./application/peopleQueries";
import {
  completeProvisionalPerson,
  getProvisionalResolutionPreview,
  linkProvisionalPerson,
  prepareCompleteProvisionalPersonCommand,
  prepareLinkProvisionalPersonCommand,
  type LinkProvisionalPersonCommand,
  type PreferredContactResolution,
  type ProvisionalResolutionPreview
} from "./application/reachOutIdentity";
import { getReachOutDetail } from "./application/reachOutQueries";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { readActiveRelationshipMode } from "./relationshipModePreference";
import type { LocalDate, Person, ReachOutContext } from "./domain/schema";
import {
  ContactValueValidationError,
  getPhoneRegionOptions,
  normalizeContactValue
} from "./integrations/contactValues";
import { personProfilePath, reachOutDetailPath } from "./navigation";
import PhoneRegionSelect from "./PhoneRegionSelect";

type Navigate = (path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) => void;

type ResolverFieldErrors = Record<string, string>;

type ResolutionSubject = {
  person: Person;
  contexts: ReachOutContext[];
};

const phoneRegionOptions = getPhoneRegionOptions(globalThis.navigator?.language ?? "en-GB");

function todayLocalDate(): LocalDate {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "PeopleOS could not resolve this identity.";
}

function linkCommandSignature(
  preview: ProvisionalResolutionPreview,
  preferred: Partial<Record<"phone" | "email", PreferredContactResolution>>
): string {
  return JSON.stringify({
    source: [preview.source.id, preview.source.revision],
    target: [preview.target.id, preview.target.revision],
    datasetRevision: preview.expectedDatasetRevision,
    keepMemoryFactIds: preview.mustKeepMemoryFactIds,
    keepInteractionIds: preview.mustKeepInteractionIds,
    preferred: Object.entries(preferred).sort(([left], [right]) => left.localeCompare(right))
  });
}

export default function ResolveProvisionalPersonScreen({
  entryId,
  personId,
  profileStateAfterResolution,
  navigate,
  onBack,
  onDirtyChange,
  onSavingChange
}: {
  entryId?: string;
  personId?: string;
  profileStateAfterResolution?: Record<string, unknown>;
  navigate: Navigate;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [detail, setDetail] = useState<ResolutionSubject | null | undefined>(undefined);
  const [people, setPeople] = useState<PersonPickerOption[]>([]);
  const [mode, setMode] = useState<"complete" | "link">("complete");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PersonPickerOption>();
  const [preview, setPreview] = useState<ProvisionalResolutionPreview>();
  const [preferred, setPreferred] = useState<Partial<Record<"phone" | "email", PreferredContactResolution>>>({});
  const [contactDrafts, setContactDrafts] = useState<ContactMethodDraft[]>([]);
  const [organisationName, setOrganisationName] = useState("");
  const [role, setRole] = useState("");
  const [defaultPhoneRegion, setDefaultPhoneRegion] = useState("GB");
  const [fieldErrors, setFieldErrors] = useState<ResolverFieldErrors>({});
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  const submittingRef = useRef(false);
  const completionCommandRef = useRef<ReturnType<typeof prepareCompleteProvisionalPersonCommand>>();
  const linkCommandRef = useRef<{ signature: string; command: LinkProvisionalPersonCommand }>();
  const affiliationDraftRef = useRef<AffiliationDraft>();
  const resolvedProfileState = profileStateAfterResolution
    ?? (entryId ? { fromPath: reachOutDetailPath(entryId) } : { fromPath: "/people" });

  function markDirty(): void {
    completionCommandRef.current = undefined;
    linkCommandRef.current = undefined;
    dirtyRef.current = true;
    onDirtyChange(true);
  }

  function markClean(): void {
    dirtyRef.current = false;
    onDirtyChange(false);
  }

  const load = useCallback(async () => {
    setError("");
    setDetail(undefined);
    try {
      const db = await getDatabase();
      const [current, settings] = await Promise.all([
        entryId
          ? getReachOutDetail(db, entryId, todayLocalDate()).then((reachOut) => reachOut
            ? { person: reachOut.person, contexts: reachOut.contexts }
            : undefined)
          : personId
            ? db.get("people", personId).then((person) => person ? { person, contexts: [] } : undefined)
            : Promise.resolve(undefined),
        getAppSettings(db)
      ]);
      setDefaultPhoneRegion(settings.defaultPhoneRegion);
      setDetail(current ?? null);
      if (current?.person.identityStatus === "provisional") {
        setName(current.person.displayName);
        affiliationDraftRef.current ??= createAffiliationDraft(current.person.id);
        setPeople((await listActivePersonOptions(db, current.person.id, readActiveRelationshipMode())).filter((option) => option.person.identityStatus === "confirmed"));
      }
    } catch {
      setError("PeopleOS could not load identity resolution.");
    }
  }, [entryId, personId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    requestAnimationFrame(() => mode === "complete" ? nameRef.current?.focus() : searchRef.current?.focus());
  }, [mode]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      onDirtyChange(false);
      onSavingChange(false);
    };
  }, [onDirtyChange, onSavingChange]);

  async function chooseTarget(option: PersonPickerOption) {
    if (!detail) return;
    markDirty();
    setTarget(option);
    setPreview(undefined);
    setPreferred({});
    setError("");
    setLoadingPreview(true);
    try {
      setPreview(await getProvisionalResolutionPreview(await getDatabase(), detail.person.id, option.person.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingPreview(false);
    }
  }

  function addContactDraft(kind: "phone" | "email"): void {
    if (!detail) return;
    setContactDrafts((current) => [...current, createContactMethodDraft(detail.person.id, kind)]);
    setFieldErrors({});
    markDirty();
  }

  function updateContactDraft(id: string, patch: Partial<ContactMethodDraft>): void {
    setContactDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`contact-${id}`];
      return next;
    });
    markDirty();
  }

  function removeContactDraft(id: string): void {
    setContactDrafts((current) => current.filter((draft) => draft.id !== id));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`contact-${id}`];
      return next;
    });
    markDirty();
  }

  function validateCompletionDetails(): ContactMethodDraft[] | undefined {
    const nextErrors: ResolverFieldErrors = {};
    if (!name.trim()) nextErrors.name = "Add the confirmed display name.";
    const contactsToSave = contactDrafts.filter((draft) => draft.value.trim() || draft.label?.trim());
    for (const draft of contactsToSave) {
      if (!draft.value.trim()) {
        nextErrors[`contact-${draft.id}`] = `Enter a ${draft.kind === "phone" ? "phone number" : "email address"} or remove this row.`;
        continue;
      }
      try {
        normalizeContactValue(draft.kind, draft.value, draft.region ?? defaultPhoneRegion);
      } catch (caught) {
        nextErrors[`contact-${draft.id}`] = caught instanceof ContactValueValidationError
          ? caught.message
          : "Check this contact detail.";
      }
    }
    if (role.trim() && !organisationName.trim()) {
      nextErrors.organisation = "Add an organisation before adding a role.";
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return undefined;
    }
    return contactsToSave;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || saving || submittingRef.current) return;
    const contactsToSave = mode === "complete" ? validateCompletionDetails() : [];
    if (!contactsToSave) return;
    submittingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError("");
    try {
      const db = await getDatabase();
      if (mode === "complete") {
        const command = completionCommandRef.current
          ?? prepareCompleteProvisionalPersonCommand(detail.person, name, new Date().toISOString(), {
            contactMethods: contactsToSave,
            defaultPhoneRegion,
            ...(organisationName.trim()
              ? {
                  affiliation: {
                    ...(affiliationDraftRef.current ?? createAffiliationDraft(detail.person.id)),
                    organisationName,
                    ...(role.trim() ? { role } : {})
                  }
                }
              : {})
          });
        completionCommandRef.current = command;
        const person = await completeProvisionalPerson(db, command);
        markClean();
        onSavingChange(false);
        navigate(personProfilePath(person.id), {
          replace: true,
          state: resolvedProfileState
        });
      } else {
        if (!preview) throw new Error("Choose an existing Person and review what will move.");
        const signature = linkCommandSignature(preview, preferred);
        const command = linkCommandRef.current?.signature === signature
          ? linkCommandRef.current.command
          : prepareLinkProvisionalPersonCommand(preview, {
              preferredContactResolutions: preferred,
              keepMemoryFactIds: preview.mustKeepMemoryFactIds
            });
        linkCommandRef.current = { signature, command };
        const result = await linkProvisionalPerson(db, command);
        markClean();
        onSavingChange(false);
        navigate(personProfilePath(result.target.id), {
          replace: true,
          state: resolvedProfileState
        });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  const normalized = query.trim().toLocaleLowerCase("en-US");
  const matches = people.filter((option) => !normalized
    || option.person.displayName.toLocaleLowerCase("en-US").includes(normalized)
    || option.affiliation?.toLocaleLowerCase("en-US").includes(normalized));
  const currentConflict = Boolean(preview?.sourceCurrentReachOut && preview.targetCurrentReachOut);
  const resolutionBlocked = currentConflict || Boolean(preview?.blockingIssues.length);

  return (
    <main className="screen resolve-provisional-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← {entryId ? "Reach Out plan" : "Person"}</button>
      {detail === undefined && !error && <p role="status">Loading identity…</p>}
      {detail === undefined && error && (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {detail === null && <EmptyState eyebrow={entryId ? "Reach Out" : "People"} title={entryId ? "Plan not found" : "Person not found"} description={entryId ? "This Reach Out plan is no longer available." : "This Person is no longer available."} action={<button className="primary-action" type="button" onClick={() => navigate(entryId ? "/reach-out" : "/people")}>Return</button>} />}
      {detail && detail.person.identityStatus !== "provisional" && <EmptyState eyebrow={entryId ? "Reach Out" : "People"} title="Identity already resolved" description="This Person now has a confirmed identity." action={<button className="primary-action" type="button" onClick={() => navigate(personProfilePath(detail.person.id))}>Open Person</button>} />}
      {detail?.person.identityStatus === "provisional" && (
        <>
          <header className="page-heading compact-heading">
            <p className="eyebrow">{detail.person.displayName}</p>
            <h2 ref={headingRef} tabIndex={-1}>Complete identity</h2>
            <p>Keep this permanent Person or explicitly link it to a confirmed Person.</p>
            {detail.contexts.length > 0 && (
              <p className="reach-out-contexts" aria-label="Reach Out contexts">
                {detail.contexts.map((context) => context.label).join(" · ")}
              </p>
            )}
          </header>
          <div className="timeline-filters" role="group" aria-label="Identity resolution method">
            <button type="button" className={mode === "complete" ? "active" : undefined} aria-pressed={mode === "complete"} onClick={() => { setMode("complete"); setError(""); markDirty(); }}>Complete this Person</button>
            <button type="button" className={mode === "link" ? "active" : undefined} aria-pressed={mode === "link"} onClick={() => { setMode("link"); setError(""); markDirty(); }}>Link to existing Person</button>
          </div>
          <form className="profile-card contact-editor resolve-provisional-form" onSubmit={submit} noValidate>
            {mode === "complete" ? (
              <>
                <div className="form-field">
                  <label htmlFor="confirmed-display-name">Confirmed display name <span>Required</span></label>
                  <input
                    ref={nameRef}
                    id="confirmed-display-name"
                    value={name}
                    maxLength={120}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? "confirmed-display-name-error" : undefined}
                    onChange={(event) => {
                      setName(event.target.value);
                      completionCommandRef.current = undefined;
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.name;
                        return next;
                      });
                      setError("");
                      markDirty();
                    }}
                  />
                  <p className="field-hint">This updates the same permanent Person ID.</p>
                  {fieldErrors.name && <p className="field-error" id="confirmed-display-name-error" role="alert">{fieldErrors.name}</p>}
                </div>
                <section className="form-section" aria-labelledby="resolver-contact-heading">
                  <div className="form-section-heading">
                    <div>
                      <h3 id="resolver-contact-heading">Contact details <span>Optional</span></h3>
                      <p>Add only details you already know.</p>
                    </div>
                  </div>
                  <div className="contact-draft-list">
                    {contactDrafts.map((draft, index) => {
                      const fieldError = fieldErrors[`contact-${draft.id}`];
                      const errorId = `resolver-contact-${draft.id}-error`;
                      return (
                        <fieldset className="contact-draft" key={draft.id}>
                          <legend>Contact detail {index + 1}</legend>
                          <div className={`contact-row-grid${draft.kind === "phone" ? " phone-row-grid" : ""}`}>
                            <div className="form-field">
                              <label htmlFor={`resolver-contact-${draft.id}-kind`}>Type</label>
                              <select
                                id={`resolver-contact-${draft.id}-kind`}
                                value={draft.kind}
                                onChange={(event) => updateContactDraft(draft.id, { kind: event.target.value as "phone" | "email" })}
                              >
                                <option value="phone">Phone</option>
                                <option value="email">Email</option>
                              </select>
                            </div>
                            {draft.kind === "phone" && (
                              <div className="form-field phone-region-field">
                                <label htmlFor={`resolver-contact-${draft.id}-region`}>Phone region</label>
                                <PhoneRegionSelect
                                  id={`resolver-contact-${draft.id}-region`}
                                  value={draft.region ?? defaultPhoneRegion}
                                  options={phoneRegionOptions}
                                  onChange={(region) => updateContactDraft(draft.id, { region })}
                                />
                              </div>
                            )}
                            <div className="form-field contact-value-field">
                              <label htmlFor={`resolver-contact-${draft.id}-value`}>{draft.kind === "phone" ? "Phone number" : "Email address"}</label>
                              <input
                                id={`resolver-contact-${draft.id}-value`}
                                type={draft.kind === "email" ? "email" : "tel"}
                                inputMode={draft.kind === "email" ? "email" : "tel"}
                                value={draft.value}
                                aria-invalid={Boolean(fieldError)}
                                aria-describedby={fieldError ? errorId : undefined}
                                onChange={(event) => updateContactDraft(draft.id, { value: event.target.value })}
                              />
                              {fieldError && <p className="field-error" id={errorId} role="alert">{fieldError}</p>}
                            </div>
                            <div className="form-field">
                              <label htmlFor={`resolver-contact-${draft.id}-label`}>Label</label>
                              <input
                                id={`resolver-contact-${draft.id}-label`}
                                value={draft.label ?? ""}
                                placeholder={draft.kind === "phone" ? "Work mobile" : "NHS email"}
                                onChange={(event) => updateContactDraft(draft.id, { label: event.target.value })}
                              />
                            </div>
                          </div>
                          <button className="text-action danger-text" type="button" onClick={() => removeContactDraft(draft.id)}>Remove contact detail</button>
                        </fieldset>
                      );
                    })}
                  </div>
                  <div className="button-row compact-buttons">
                    <button type="button" onClick={() => addContactDraft("phone")}>Add phone</button>
                    <button type="button" onClick={() => addContactDraft("email")}>Add email</button>
                  </div>
                </section>
                <section className="form-section" aria-labelledby="resolver-affiliation-heading">
                  <div className="form-section-heading">
                    <div>
                      <h3 id="resolver-affiliation-heading">Affiliation <span>Optional</span></h3>
                      <p>Add a lightweight current organisation and role.</p>
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor="resolver-organisation">Organisation</label>
                    <input
                      id="resolver-organisation"
                      value={organisationName}
                      aria-invalid={Boolean(fieldErrors.organisation)}
                      aria-describedby={fieldErrors.organisation ? "resolver-organisation-error" : undefined}
                      onChange={(event) => { setOrganisationName(event.target.value); setFieldErrors({}); markDirty(); }}
                    />
                    {fieldErrors.organisation && <p className="field-error" id="resolver-organisation-error" role="alert">{fieldErrors.organisation}</p>}
                  </div>
                  <div className="form-field">
                    <label htmlFor="resolver-role">Role or job title</label>
                    <input id="resolver-role" value={role} onChange={(event) => { setRole(event.target.value); setFieldErrors({}); markDirty(); }} />
                  </div>
                </section>
              </>
            ) : (
              <>
                <div className="form-field">
                  <label htmlFor="existing-person-search">Find a confirmed Person</label>
                  <input ref={searchRef} id="existing-person-search" value={query} onChange={(event) => { setQuery(event.target.value); setTarget(undefined); setPreview(undefined); setError(""); markDirty(); }} placeholder="Start with their name" />
                </div>
                <ul className="selector-list compact-selector" aria-label="Confirmed people">
                  {matches.slice(0, 8).map((option) => <li key={option.person.id}><button type="button" aria-pressed={target?.person.id === option.person.id} onClick={() => void chooseTarget(option)}><strong>{option.person.displayName}</strong>{option.affiliation && <span>{option.affiliation}</span>}</button></li>)}
                </ul>
                {!loadingPreview && matches.length === 0 && <p className="muted-copy">No existing person found</p>}
                {loadingPreview && <p role="status">Preparing resolution preview…</p>}
                {preview && (
                  <section className="resolution-preview" aria-labelledby="resolution-preview-heading">
                    <h3 id="resolution-preview-heading">Review before linking</h3>
                    <p><strong>{preview.source.displayName}</strong> will be retained as merged history. Owned records move to <strong>{preview.target.displayName}</strong>.</p>
                    <dl className="profile-details">
                      <div><dt>Reach Out plans</dt><dd>{preview.counts.reachOutEntries}</dd></div>
                      <div><dt>Follow-ups</dt><dd>{preview.counts.followUps}</dd></div>
                      <div><dt>Interactions</dt><dd>{preview.counts.interactions}</dd></div>
                      <div><dt>Memory facts</dt><dd>{preview.counts.memoryFacts}</dd></div>
                      <div><dt>Contact methods</dt><dd>{preview.counts.contactMethods}</dd></div>
                      <div><dt>Affiliations</dt><dd>{preview.counts.affiliations}</dd></div>
                      <div><dt>Reach Out contexts</dt><dd>{preview.counts.reachOutContexts}</dd></div>
                      <div><dt>Reach Out history</dt><dd>{preview.counts.reachOutEvents}</dd></div>
                      <div><dt>Follow-up history</dt><dd>{preview.counts.followUpEvents}</dd></div>
                    </dl>
                    <details className="resolution-records">
                      <summary>Review the records in this resolution</summary>
                      <ul>
                        {preview.records.reachOutEntries.map((record) => <li key={`reach-out-${record.id}`}>Reach Out · {record.reason ?? "No reason added"} · {record.intentStatus} · moves to surviving Person</li>)}
                        {preview.records.reachOutEvents.map((record) => <li key={`reach-out-event-${record.id}`}>Reach Out history · {record.kind} · remains with its Reach Out plan</li>)}
                        {preview.records.followUps.map((record) => <li key={`follow-up-${record.id}`}>Follow-up · {record.reason} · {record.dueDate} · moves to surviving Person</li>)}
                        {preview.records.followUpEvents.map((record) => <li key={`follow-up-event-${record.id}`}>Follow-up history · {record.kind} · moves to surviving Person</li>)}
                        {preview.records.interactions.map((record) => <li key={`interaction-${record.id}`}>Interaction · {record.kind} · {record.summary ?? record.occurredAt}{preview.mustKeepInteractionIds.includes(record.id) ? " · stays with provisional history" : " · moves to surviving Person"}</li>)}
                        {preview.records.memoryFacts.map((record) => <li key={`fact-${record.id}`}>Memory fact · {record.value}{preview.mustKeepMemoryFactIds.includes(record.id) ? " · stays with provisional history" : " · moves to surviving Person"}</li>)}
                        {preview.records.contactMethods.map((record) => <li key={`contact-${record.id}`}>Contact · {record.label ?? record.kind} · {record.rawValue} · moves to surviving Person</li>)}
                        {preview.records.affiliations.map((record) => <li key={`affiliation-${record.id}`}>Affiliation · {[record.role, record.organisationName].filter(Boolean).join(" · ")} · moves to surviving Person</li>)}
                        {preview.records.reachOutContexts.map((record) => <li key={`context-${record.id}`}>Reach Out context · {record.label} · remains shared with its Reach Out plan</li>)}
                        {preview.records.todaySkips.map((record) => <li key={`skip-${record.id}`}>Today history · not today on {record.localDate} · moves or coalesces on surviving Person</li>)}
                        {Object.values(preview.records).every((records) => records.length === 0) && <li>No child records will move.</li>}
                      </ul>
                    </details>
                    {preview.preferredContactConflicts.map((conflict) => (
                      <fieldset className="choice-fieldset" key={conflict.kind}>
                        <legend>Preferred {conflict.kind}</legend>
                        <label><input type="radio" name={`preferred-${conflict.kind}`} checked={preferred[conflict.kind] === "keep_target"} onChange={() => { setPreferred((value) => ({ ...value, [conflict.kind]: "keep_target" })); markDirty(); }} /> Keep {preview.target.displayName}’s current preferred {conflict.kind}</label>
                        <label><input type="radio" name={`preferred-${conflict.kind}`} checked={preferred[conflict.kind] === "use_source"} onChange={() => { setPreferred((value) => ({ ...value, [conflict.kind]: "use_source" })); markDirty(); }} /> Use the provisional Person’s preferred {conflict.kind}</label>
                      </fieldset>
                    ))}
                    {currentConflict && (
                      <div className="form-alert" role="alert">
                        <p>Both People have a current Reach Out plan. Complete or remove one plan before linking them.</p>
                        {preview.targetCurrentReachOut && <button type="button" onClick={() => navigate(reachOutDetailPath(preview.targetCurrentReachOut!.id))}>Open target Reach Out plan</button>}
                      </div>
                    )}
                    {preview.blockingIssues.map((issue) => <p className="form-alert" role="alert" key={issue}>{issue}</p>)}
                  </section>
                )}
              </>
            )}
            {error && detail !== undefined && <p className="form-alert" role="alert">{error}</p>}
            <div className="button-row">
              <button type="button" onClick={onBack}>Cancel</button>
              <button className="primary-action" type="submit" disabled={saving || (mode === "link" && (!preview || resolutionBlocked))}>{saving ? "Saving…" : mode === "complete" ? "Confirm identity" : "Link People"}</button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
