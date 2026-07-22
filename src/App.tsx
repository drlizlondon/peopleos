import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { followUpDetailPath, personProfilePath, routeFromPath, routes, type Route } from "./navigation";
import { ReachOutScreen, SettingsScreen } from "./screens";
import {
  AddPersonScreen,
  ContactMethodsScreen,
  PeopleScreen,
  PersonProfileScreen,
  TodayScreen,
  type ContactEditorResumeState,
  type ManualCaptureResumeState
} from "./peopleScreens";
import { ExportBackupScreen, RestoreBackupScreen } from "./dataScreens";
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
import type { PersonPickerOption } from "./application/interactionQueries";
import type { ContactImportSession } from "./application/contactImport";

type ModalBackHandler = {
  id: string;
  dismiss: () => void;
  historyState: unknown;
};

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [storageError, setStorageError] = useState(false);
  const [importSession, setImportSession] = useState<ContactImportSession | null>(null);
  const [importedPeopleFilter, setImportedPeopleFilter] = useState<string[] | null>(null);
  const [suspendedCapture, setSuspendedCapture] = useState<ManualCaptureResumeState | null>(null);
  const [suspendedContactEditor, setSuspendedContactEditor] = useState<ContactEditorResumeState | null>(null);
  const [globalAddOpen, setGlobalAddOpen] = useState(false);
  const [globalInteractionPerson, setGlobalInteractionPerson] = useState<PersonPickerOption | null>(null);
  const [globalFollowUpPerson, setGlobalFollowUpPerson] = useState<PersonPickerOption | null>(null);
  const routeRef = useRef(route);
  const unsavedChangesRef = useRef(false);
  const navigationLockedRef = useRef(false);
  const modalBackHandlerRef = useRef<ModalBackHandler | null>(null);
  const globalAddButtonRef = useRef<HTMLButtonElement>(null);
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
        modal.dismiss();
        return;
      }
      if (navigationLockedRef.current) {
        window.history.pushState(
          captureOriginRef.current ? { fromPath: captureOriginRef.current } : {},
          "",
          routeRef.current.path
        );
        return;
      }
      if (unsavedChangesRef.current) {
        if (!window.confirm("Discard changes?")) {
          window.history.pushState(
            captureOriginRef.current ? { fromPath: captureOriginRef.current } : {},
            "",
            routeRef.current.path
          );
          return;
        }
        setUnsavedCapture(false);
      }
      setRoute(routeFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setUnsavedCapture]);

  useEffect(() => {
    getDatabase().catch(() => setStorageError(true));
  }, []);

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
      defaultState = { fromPath };
    } else if (next.id === "contact-methods") {
      const existingOrigin = window.history.state?.fromPath;
      defaultState = { fromPath: typeof existingOrigin === "string" ? existingOrigin : "/people" };
    } else if (next.id === "timeline") {
      defaultState = {
        fromProfile: route.id === "person-profile",
        fromPath: typeof window.history.state?.fromPath === "string"
          ? window.history.state.fromPath
          : "/people"
      };
    } else if (next.id === "memory-facts" || next.id === "affiliations") {
      defaultState = {
        fromProfile: route.id === "person-profile",
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
    }
    const state = options.state ?? defaultState;
    if (options.replace) window.history.replaceState(state, "", next.path);
    else window.history.pushState(state, "", next.path);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function navigatePath(path: string, options?: { replace?: boolean }) {
    navigate(routeFromPath(path), options);
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
      case "today": return <TodayScreen navigate={navigatePath} />;
      case "reach-out": return <ReachOutScreen />;
      case "people": return (
        <PeopleScreen
          navigate={navigatePath}
          importedPersonIds={importedPeopleFilter}
          onClearImportedFilter={() => setImportedPeopleFilter(null)}
        />
      );
      case "upcoming": return <UpcomingScreen navigate={navigatePath} />;
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
        />
      );
      case "contact-methods": return (
        <ContactMethodsScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          initialEditor={window.history.state?.resumeContactEditor ? suspendedContactEditor : null}
          onOpenDuplicatePerson={openExistingFromContactEditor}
          onEditorFinished={() => setSuspendedContactEditor(null)}
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

      {storageError && <p className="storage-error" role="alert">PeopleOS could not open local storage. Your data actions are unavailable.</p>}
      {renderScreen()}

      <nav className="primary-nav" aria-label="Primary navigation">
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
      </nav>

      {globalAddOpen && (
        <GlobalAddSheet
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
          preferFollowUp={route.id === "upcoming"}
        />
      )}
      {globalInteractionPerson && (
        <InteractionEditorSheet
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
    </div>
  );
}
