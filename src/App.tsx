import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { followUpDetailPath, personProfilePath, reachOutDetailPath, routeFromPath, routes, type Route } from "./navigation";
import { SettingsScreen } from "./screens";
import TodayScreen from "./TodayScreen";
import {
  AddPersonScreen,
  ContactMethodsScreen,
  PeopleScreen,
  PersonProfileScreen,
  type ContactEditorResumeState,
  type ManualCaptureResumeState
} from "./peopleScreens";
import { ExportBackupScreen, RestoreBackupScreen } from "./dataScreens";
// eslint-disable-next-line no-restricted-imports -- V1-R4 debt: UI reaches the data layer directly; migrate to src/application/*
import { getDatabase } from "./data/client";
import { ImportContactsScreen, ImportResultsScreen } from "./importScreens";
import TimelineScreen from "./TimelineScreen";
import GlobalAddSheet from "./GlobalAddSheet";
import InteractionEditorSheet from "./InteractionEditorSheet";
import MemoryFactsScreen from "./MemoryFactsScreen";
import AffiliationsScreen from "./AffiliationsScreen";
import FollowUpEditorSheet from "./FollowUpEditorSheet";
import FollowUpDetailScreen from "./FollowUpDetailScreen";
import PersonFollowUpsScreen from "./PersonFollowUpsScreen";
import UpcomingScreen from "./UpcomingScreen";
import ReachOutScreen from "./ReachOutScreen";
import ReachOutDetailScreen from "./ReachOutDetailScreen";
import ResolveProvisionalPersonScreen from "./ResolveProvisionalPersonScreen";
import ReachOutEditorSheet from "./ReachOutEditorSheet";
import EditPersonScreen from "./EditPersonScreen";
import type { PersonPickerOption } from "./application/interactionQueries";
import type { ContactImportSession } from "./application/contactImport";
import type { Person } from "./domain/schema";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import { readActiveRelationshipMode, writeActiveRelationshipMode } from "./relationshipModePreference";

type ModalBackHandler = {
  id: string;
  dismiss: () => void;
  historyState: unknown;
};

function profileStateFromResolver(): Record<string, unknown> {
  const state = { ...(window.history.state ?? {}) };
  delete state.resolverProfileReturn;
  delete state.resolverPersonId;
  delete state.resolverOriginPrepared;
  return state;
}

function resolverSuccessProfileState(route: Route): Record<string, unknown> {
  if (window.history.state?.resolverProfileReturn === true) return profileStateFromResolver();
  if (window.history.state?.resolverOriginPrepared === true && typeof window.history.state?.fromPath === "string") {
    return { fromPath: window.history.state.fromPath, profileOriginPrepared: true };
  }
  return { fromPath: route.reachOutEntryId ? reachOutDetailPath(route.reachOutEntryId) : "/people" };
}

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [activeRelationshipMode, setActiveRelationshipMode] = useState<ActiveRelationshipMode>(readActiveRelationshipMode);
  const [relationshipContexts, setRelationshipContexts] = useState<Array<"personal" | "professional">>(["personal", "professional"]);
  const [storageError, setStorageError] = useState(false);
  const [importSession, setImportSession] = useState<ContactImportSession | null>(null);
  const [importedPeopleFilter, setImportedPeopleFilter] = useState<string[] | null>(null);
  const [suspendedCapture, setSuspendedCapture] = useState<ManualCaptureResumeState | null>(null);
  const [suspendedContactEditor, setSuspendedContactEditor] = useState<ContactEditorResumeState | null>(null);
  const [globalAddOpen, setGlobalAddOpen] = useState(false);
  const [globalInteractionPerson, setGlobalInteractionPerson] = useState<PersonPickerOption | null>(null);
  const [globalFollowUpPerson, setGlobalFollowUpPerson] = useState<PersonPickerOption | null>(null);
  const [globalReachOutOpen, setGlobalReachOutOpen] = useState(false);
  const [globalReachOutPerson, setGlobalReachOutPerson] = useState<Person | undefined>();
  const routeRef = useRef(route);
  const activeHistoryStateRef = useRef<Record<string, unknown>>(window.history.state ?? {});
  const unsavedChangesRef = useRef(false);
  const navigationLockedRef = useRef(false);
  const modalBackHandlerRef = useRef<ModalBackHandler | null>(null);
  const globalAddButtonRef = useRef<HTMLButtonElement>(null);
  const reachOutCaptureOpenerRef = useRef<HTMLElement | null>(null);
  const captureOriginRef = useRef<string | undefined>(
    typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : undefined
  );

  const setUnsavedCapture = useCallback((dirty: boolean) => {
    unsavedChangesRef.current = dirty;
  }, []);

  const setNavigationLocked = useCallback((locked: boolean) => {
    navigationLockedRef.current = locked;
  }, []);

  useEffect(() => {
    routeRef.current = route;
    activeHistoryStateRef.current = window.history.state ?? {};
  }, [route]);

  useEffect(() => {
    const registerModal = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; dismiss: () => void }>).detail;
      modalBackHandlerRef.current = {
        ...detail,
        historyState: window.history.state
      };
    };
    const unregisterModal = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (modalBackHandlerRef.current?.id === detail.id) modalBackHandlerRef.current = null;
    };
    window.addEventListener("peopleos:modal-open", registerModal);
    window.addEventListener("peopleos:modal-close", unregisterModal);
    return () => {
      window.removeEventListener("peopleos:modal-open", registerModal);
      window.removeEventListener("peopleos:modal-close", unregisterModal);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const modal = modalBackHandlerRef.current;
      if (modal) {
        window.history.pushState(modal.historyState, "", routeRef.current.path);
        activeHistoryStateRef.current = (modal.historyState as Record<string, unknown> | null) ?? {};
        modal.dismiss();
        return;
      }
      if (navigationLockedRef.current) {
        window.history.pushState(activeHistoryStateRef.current, "", routeRef.current.path);
        return;
      }
      if (unsavedChangesRef.current) {
        if (!window.confirm("Discard changes?")) {
          window.history.pushState(activeHistoryStateRef.current, "", routeRef.current.path);
          return;
        }
        setUnsavedCapture(false);
      }
      activeHistoryStateRef.current = window.history.state ?? {};
      setRoute(routeFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setUnsavedCapture]);

  useEffect(() => {
    getDatabase().then(async (db) => {
      const settings = await db.get("appSettings", "app");
      const included = settings?.relationshipContexts ?? ["personal", "professional"];
      setRelationshipContexts([...included]);
      if (included.length === 1) setActiveRelationshipMode(included[0]);
    }).catch(() => setStorageError(true));
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      const included = (event as CustomEvent<Array<"personal" | "professional">>).detail;
      setRelationshipContexts([...included]);
      if (included.length === 1) setActiveRelationshipMode(included[0]);
      else if (!included.includes(activeRelationshipMode as "personal" | "professional")) setActiveRelationshipMode("all");
    };
    window.addEventListener("peopleos:relationship-contexts", update);
    return () => window.removeEventListener("peopleos:relationship-contexts", update);
  }, [activeRelationshipMode]);

  useEffect(() => {
    document.title = route.id === "today" ? "PeopleOS" : `${route.label} · PeopleOS`;
    if (route.id !== "add-person") {
      document.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
    }
  }, [route]);

  function navigate(next: Route, options: { replace?: boolean; state?: Record<string, unknown> } = {}) {
    if (navigationLockedRef.current) return;
    if (next.path === route.path) return;
    setGlobalAddOpen(false);
    if (unsavedChangesRef.current) {
      if (!window.confirm("Discard changes?")) return;
      setUnsavedCapture(false);
    }
    if (next.id === "add-person") captureOriginRef.current = route.path;
    let defaultState: Record<string, unknown> = {};
    if (next.id === "add-person") {
      defaultState = { fromPath: captureOriginRef.current };
    } else if (next.id === "import-contacts") {
      const existingOrigin = window.history.state?.fromPath;
      const fromPath = route.id === "import-results" && typeof existingOrigin === "string"
        ? existingOrigin
        : ["today", "people", "settings"].includes(route.id)
          ? route.path
          : "/people";
      defaultState = { fromPath };
    } else if (next.id === "import-results") {
      const existingOrigin = window.history.state?.fromPath;
      defaultState = { fromPath: typeof existingOrigin === "string" ? existingOrigin : "/people" };
    } else if (next.id === "person-profile") {
      const existingOrigin = window.history.state?.fromPath;
      const fromPath = route.id === "add-person"
        ? captureOriginRef.current ?? "/people"
        : route.id === "contact-methods" && typeof existingOrigin === "string"
          ? existingOrigin
          : route.path;
      const returnsToList = ["today", "reach-out", "people", "upcoming"].includes(route.id)
        || route.id === "add-person";
      defaultState = {
        fromPath,
        ...(returnsToList ? { navigationOrigin: true } : {}),
        ...(route.id === "reach-out-detail" ? { profileOriginPrepared: true } : {})
      };
    } else if (next.id === "contact-methods") {
      const existingOrigin = window.history.state?.fromPath;
      defaultState = {
        fromPath: typeof existingOrigin === "string" ? existingOrigin : "/people",
        ...(["person-profile", "edit-person"].includes(route.id) ? { fromProfile: true } : {})
      };
    } else if (next.id === "edit-person") {
      defaultState = {
        fromProfile: route.id === "person-profile",
        fromPath: typeof window.history.state?.fromPath === "string"
          ? window.history.state.fromPath
          : "/people"
      };
    } else if (next.id === "timeline") {
      defaultState = {
        fromProfile: route.id === "person-profile",
        fromPath: typeof window.history.state?.fromPath === "string"
          ? window.history.state.fromPath
          : "/people"
      };
    } else if (next.id === "memory-facts" || next.id === "affiliations") {
      defaultState = {
        fromProfile: ["person-profile", "edit-person"].includes(route.id),
        fromPath: typeof window.history.state?.fromPath === "string"
          ? window.history.state.fromPath
          : "/people"
      };
    } else if (next.id === "person-follow-ups") {
      defaultState = {
        fromProfile: route.id === "person-profile",
        fromPath: typeof window.history.state?.fromPath === "string"
          ? window.history.state.fromPath
          : "/people"
      };
    } else if (next.id === "follow-up-detail") {
      defaultState = { fromPath: route.path };
    } else if (next.id === "reach-out-detail") {
      defaultState = { fromPath: route.path };
    } else if (next.id === "resolve-provisional") {
      defaultState = {
        fromPath: route.path,
        ...(route.id === "reach-out-detail" ? { resolverOriginPrepared: true } : {})
      };
    }
    const state = options.state ?? defaultState;
    if (options.replace) window.history.replaceState(state, "", next.path);
    else window.history.pushState(state, "", next.path);
    activeHistoryStateRef.current = state;
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function navigatePath(path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) {
    navigate(routeFromPath(path), options);
  }

  function openReachOutCapture(person?: Person, opener?: HTMLElement | null) {
    reachOutCaptureOpenerRef.current = opener ?? null;
    setGlobalReachOutPerson(person);
    setGlobalReachOutOpen(true);
  }

  function restoreReachOutCaptureFocus() {
    const opener = reachOutCaptureOpenerRef.current;
    reachOutCaptureOpenerRef.current = null;
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
      else if (globalAddButtonRef.current?.isConnected) globalAddButtonRef.current.focus();
    });
  }

  function dismissCapture() {
    if (navigationLockedRef.current) return;
    if (unsavedChangesRef.current && !window.confirm("Discard changes?")) return;
    setUnsavedCapture(false);
    setSuspendedCapture(null);
    const fromPath = captureOriginRef.current ?? window.history.state?.fromPath;
    if (typeof fromPath === "string") {
      window.history.back();
      return;
    }
    navigate(routeFromPath("/people"), { replace: true });
  }

  function openExistingFromCapture(personId: string, capture: ManualCaptureResumeState) {
    setSuspendedCapture(capture);
    setUnsavedCapture(false);
    setNavigationLocked(false);
    window.history.replaceState(
      { ...(window.history.state ?? {}), resumeCapture: true },
      "",
      route.path
    );
    const next = routeFromPath(`/people/${encodeURIComponent(personId)}`);
    window.history.pushState({ fromPath: "/people/new", resumeCapture: true }, "", next.path);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function openExistingFromContactEditor(personId: string, editor: ContactEditorResumeState) {
    setSuspendedContactEditor(editor);
    setUnsavedCapture(false);
    setNavigationLocked(false);
    window.history.replaceState(
      { ...(window.history.state ?? {}), resumeContactEditor: true },
      "",
      route.path
    );
    const next = routeFromPath(`/people/${encodeURIComponent(personId)}`);
    window.history.pushState(
      { fromPath: route.path, resumeContactEditor: true },
      "",
      next.path
    );
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderScreen() {
    switch (route.id) {
      case "today": return <TodayScreen activeMode={activeRelationshipMode} navigate={navigatePath} onAddFollowUp={() => setGlobalAddOpen(true)} />;
      case "reach-out": return <ReachOutScreen activeMode={activeRelationshipMode} navigate={navigatePath} onAdd={(opener) => openReachOutCapture(undefined, opener)} />;
      case "people": return (
        <PeopleScreen
          navigate={navigatePath}
          importedPersonIds={importedPeopleFilter}
          onClearImportedFilter={() => setImportedPeopleFilter(null)}
          activeMode={activeRelationshipMode}
        />
      );
      case "upcoming": return <UpcomingScreen activeMode={activeRelationshipMode} navigate={navigatePath} />;
      case "settings": return <SettingsScreen navigate={navigatePath} />;
      case "add-person": return (
        <AddPersonScreen
          navigate={navigatePath}
          dismiss={dismissCapture}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          initialCapture={window.history.state?.resumeCapture ? suspendedCapture : null}
          onOpenDuplicatePerson={openExistingFromCapture}
          onCaptureFinished={() => setSuspendedCapture(null)}
        />
      );
      case "person-profile": return (
        <PersonProfileScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          backPath={typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : "/people"}
          onAddToReachOut={(person, opener) => openReachOutCapture(person, opener)}
        />
      );
      case "contact-methods": return (
        <ContactMethodsScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          initialEditor={window.history.state?.resumeContactEditor ? suspendedContactEditor : null}
          autoAddPhone={window.history.state?.autoAddPhone === true}
          backLabel={window.history.state?.fromPath === "/" ? "Today" : "Person"}
          onBack={window.history.state?.fromPath === "/" ? () => {
            if (window.history.state?.todayOriginPrepared === true) {
              window.history.back();
              return;
            }
            navigate(routeFromPath("/"), {
              replace: true,
              state: {
                ...(Number.isInteger(window.history.state?.todayVisibleCount)
                  ? { todayVisibleCount: window.history.state.todayVisibleCount }
                  : {}),
                ...(typeof window.history.state?.todayFocusPersonId === "string"
                  ? { todayFocusPersonId: window.history.state.todayFocusPersonId }
                  : {})
              }
            });
          } : window.history.state?.fromProfile === true
            ? () => window.history.back()
            : undefined}
          onOpenDuplicatePerson={openExistingFromContactEditor}
          onEditorFinished={() => setSuspendedContactEditor(null)}
        />
      );
      case "edit-person": return (
        <EditPersonScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          onBack={() => {
            if (window.history.state?.fromProfile === true) {
              window.history.back();
              return;
            }
            navigatePath(personProfilePath(route.personId ?? ""), {
              replace: true,
              state: { fromPath: typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : "/people" }
            });
          }}
        />
      );
      case "timeline": return (
        <TimelineScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onBack={() => {
            if (window.history.state?.fromProfile === true) {
              window.history.back();
              return;
            }
            navigate(routeFromPath(personProfilePath(route.personId ?? "")), {
              replace: true,
              state: { fromPath: "/people" }
            });
          }}
        />
      );
      case "memory-facts": return (
        <MemoryFactsScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onBack={() => {
            if (window.history.state?.fromProfile === true) {
              window.history.back();
              return;
            }
            navigate(routeFromPath(personProfilePath(route.personId ?? "")), {
              replace: true,
              state: { fromPath: "/people" }
            });
          }}
        />
      );
      case "affiliations": return (
        <AffiliationsScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onBack={() => {
            if (window.history.state?.fromProfile === true) {
              window.history.back();
              return;
            }
            navigate(routeFromPath(personProfilePath(route.personId ?? "")), {
              replace: true,
              state: { fromPath: "/people" }
            });
          }}
        />
      );
      case "person-follow-ups": return (
        <PersonFollowUpsScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onBack={() => window.history.state?.fromProfile === true
            ? window.history.back()
            : navigatePath(personProfilePath(route.personId ?? ""), { replace: true })}
        />
      );
      case "follow-up-detail": return (
        <FollowUpDetailScreen
          followUpId={route.followUpId ?? ""}
          navigate={navigatePath}
          onBack={() => {
            const fromPath = window.history.state?.fromPath;
            if (typeof fromPath === "string" && fromPath !== route.path) window.history.back();
            else navigatePath("/upcoming", { replace: true });
          }}
        />
      );
      case "reach-out-detail": return (
        <ReachOutDetailScreen
          entryId={route.reachOutEntryId ?? ""}
          navigate={navigatePath}
          onBack={() => {
            const fromPath = window.history.state?.fromPath;
            if (typeof fromPath === "string" && fromPath !== route.path) window.history.back();
            else navigatePath("/reach-out", { replace: true });
          }}
        />
      );
      case "resolve-provisional": return (
        <ResolveProvisionalPersonScreen
          entryId={route.reachOutEntryId}
          personId={route.personId}
          profileStateAfterResolution={resolverSuccessProfileState(route)}
          navigate={navigatePath}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          onBack={() => {
            if (navigationLockedRef.current) return;
            if (unsavedChangesRef.current && !window.confirm("Discard changes?")) return;
            setUnsavedCapture(false);
            if (window.history.state?.resolverProfileReturn === true) {
              const sourcePersonId = typeof window.history.state?.resolverPersonId === "string"
                ? window.history.state.resolverPersonId
                : route.personId;
              if (sourcePersonId) {
                navigatePath(personProfilePath(sourcePersonId), {
                  replace: true,
                  state: profileStateFromResolver()
                });
                return;
              }
            }
            if (route.personId) {
              navigatePath(personProfilePath(route.personId), {
                replace: true,
                state: { fromPath: "/people" }
              });
              return;
            }
            const fromPath = window.history.state?.fromPath;
            if (window.history.state?.resolverOriginPrepared === true
              && typeof fromPath === "string"
              && fromPath !== route.path) {
              window.history.back();
            } else {
              navigatePath(reachOutDetailPath(route.reachOutEntryId ?? ""), {
                replace: true,
                state: {}
              });
            }
          }}
        />
      );
      case "import-contacts": return (
        <ImportContactsScreen
          session={importSession}
          setSession={setImportSession}
          navigate={navigatePath}
          onBusyChange={setNavigationLocked}
          originPath={typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : "/people"}
        />
      );
      case "import-results": return (
        <ImportResultsScreen
          session={importSession}
          setSession={setImportSession}
          navigate={navigatePath}
          onViewPeople={(personIds) => {
            setImportedPeopleFilter(personIds);
            navigatePath("/people");
          }}
        />
      );
      case "export-backup": return <ExportBackupScreen navigate={navigatePath} />;
      case "restore-backup": return <RestoreBackupScreen navigate={navigatePath} />;
    }
  }

  const showGlobalAdd = ["today", "reach-out", "people", "upcoming"].includes(route.id);
  const showPrimaryNavigation = ["today", "reach-out", "people", "upcoming", "settings"].includes(route.id);

  function closeGlobalAdd() {
    setGlobalAddOpen(false);
    requestAnimationFrame(() => globalAddButtonRef.current?.focus());
  }

  function closeGlobalInteraction() {
    setGlobalInteractionPerson(null);
    requestAnimationFrame(() => globalAddButtonRef.current?.focus());
  }

  function closeGlobalFollowUp() {
    setGlobalFollowUpPerson(null);
    requestAnimationFrame(() => globalAddButtonRef.current?.focus());
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate(routes[0]); }} aria-label="PeopleOS home">
          <span className="brand-mark" aria-hidden="true"><span /><span /></span>
          <span>PeopleOS</span>
        </a>
        <div className="header-actions">
          <p>Remember people.</p>
          {showGlobalAdd && (
            <button ref={globalAddButtonRef} className="header-add-person" type="button" onClick={() => setGlobalAddOpen(true)}>
              <Icon name="plus" /> Add
            </button>
          )}
        </div>
      </header>
      {relationshipContexts.length === 2 && showPrimaryNavigation && <div className="relationship-mode-bar">
        <div className="segmented-control global-mode-control" role="group" aria-label="Relationship view">
          {(["all", "personal", "professional"] as ActiveRelationshipMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={activeRelationshipMode === mode}
              onClick={() => { writeActiveRelationshipMode(mode); setActiveRelationshipMode(mode); }}
            >{mode === "all" ? "All" : mode === "personal" ? "Personal" : "Professional"}</button>
          ))}
        </div>
      </div>}

      {storageError && <p className="storage-error" role="alert">PeopleOS could not open local storage. Your data actions are unavailable.</p>}
      {renderScreen()}

      {showPrimaryNavigation && <nav className="primary-nav" aria-label="Primary navigation">
        {routes.map((item) => (
          <a
            key={item.id}
            href={item.path}
            className={item.id === route.primaryId ? "active" : undefined}
            aria-current={item.id === route.primaryId ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (item.id === "people") setImportedPeopleFilter(null);
              navigate(item);
            }}
          >
            <Icon name={item.primaryId} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>}

      {globalAddOpen && (
        <GlobalAddSheet
          activeMode={activeRelationshipMode}
          onClose={closeGlobalAdd}
          onNavigate={(path) => { setGlobalAddOpen(false); navigatePath(path); }}
          onLogInteraction={(person) => {
            setGlobalAddOpen(false);
            setGlobalInteractionPerson(person);
          }}
          onAddFollowUp={(person) => {
            setGlobalAddOpen(false);
            setGlobalFollowUpPerson(person);
          }}
          onAddReachOut={() => {
            setGlobalAddOpen(false);
            openReachOutCapture(undefined, globalAddButtonRef.current);
          }}
          preferFollowUp={route.id === "upcoming"}
          preferReachOut={route.id === "reach-out"}
        />
      )}
      {globalInteractionPerson && (
        <InteractionEditorSheet
          activeMode={activeRelationshipMode}
          personId={globalInteractionPerson.person.id}
          personName={globalInteractionPerson.person.displayName}
          onClose={closeGlobalInteraction}
          onSaved={closeGlobalInteraction}
          onDeleted={closeGlobalInteraction}
        />
      )}
      {globalFollowUpPerson && (
        <FollowUpEditorSheet
          mode="create"
          personId={globalFollowUpPerson.person.id}
          personName={globalFollowUpPerson.person.displayName}
          onClose={closeGlobalFollowUp}
          onSaved={(followUp) => {
            setGlobalFollowUpPerson(null);
            navigatePath(followUpDetailPath(followUp.id));
          }}
        />
      )}
      {globalReachOutOpen && (
        <ReachOutEditorSheet
          activeMode={activeRelationshipMode}
          mode="create"
          person={globalReachOutPerson}
          onClose={() => {
            setGlobalReachOutOpen(false);
            setGlobalReachOutPerson(undefined);
            restoreReachOutCaptureFocus();
          }}
          onSaved={(entry) => {
            setGlobalReachOutOpen(false);
            setGlobalReachOutPerson(undefined);
            reachOutCaptureOpenerRef.current = null;
            navigatePath(reachOutDetailPath(entry.id));
          }}
          onOpenExisting={(entryId) => {
            setGlobalReachOutOpen(false);
            setGlobalReachOutPerson(undefined);
            reachOutCaptureOpenerRef.current = null;
            navigatePath(reachOutDetailPath(entryId));
          }}
        />
      )}
    </div>
  );
}
