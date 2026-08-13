import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { PEOPLEOS_BUILD_COMMIT } from "./buildMetadata";
import { personProfilePath, reachOutDetailPath, routeFromPath, routes, type Route } from "./navigation";
import {
  appAssetPath,
  browserPathForLogicalPath,
  logicalPathFromBrowserPath
} from "./platformRouting";
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
import MemoryFactsScreen from "./MemoryFactsScreen";
import AffiliationsScreen from "./AffiliationsScreen";
import FollowUpDetailScreen from "./FollowUpDetailScreen";
import PersonFollowUpsScreen from "./PersonFollowUpsScreen";
import UpcomingScreen from "./UpcomingScreen";
import ReachOutScreen from "./ReachOutScreen";
import ReachOutDetailScreen from "./ReachOutDetailScreen";
import ResolveProvisionalPersonScreen from "./ResolveProvisionalPersonScreen";
import ReachOutEditorSheet from "./ReachOutEditorSheet";
import EditPersonScreen from "./EditPersonScreen";
import PrivacyScreen from "./PrivacyScreen";
import ConversationStarterSettingsScreen from "./ConversationStarterSettingsScreen";
import PostAddRelationshipScreen from "./PostAddRelationshipScreen";
import RelationshipFilter from "./RelationshipFilter";
import {
  prepareContactImportFromPickerResult,
  type ContactImportSession
} from "./application/contactImport";
import { getAppSettings } from "./application/peopleQueries";
import {
  getIPhoneContactsAdapter,
  isIPhoneContactsSupported,
  pickSingleIPhoneContact
} from "./contacts/capacitorAdapter";
import type { Person } from "./domain/schema";
import type { ActiveRelationshipMode } from "./domain/relationshipMode";
import { readActiveRelationshipMode, writeActiveRelationshipMode } from "./relationshipModePreference";
import { startCloudSyncService } from "./sync/service";
import {
  OPEN_TODAY_FROM_NOTIFICATION_EVENT,
  requestTodayNotificationReconcile,
  startTodayNotificationService
} from "./notifications/service";

type ModalBackHandler = {
  id: string;
  dismiss: () => boolean | void;
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
  const [route, setRoute] = useState(() => routeFromPath(logicalPathFromBrowserPath(window.location.pathname)));
  const [activeRelationshipMode, setActiveRelationshipMode] = useState<ActiveRelationshipMode>(readActiveRelationshipMode);
  const [relationshipContexts, setRelationshipContexts] = useState<Array<"personal" | "professional">>(["personal", "professional"]);
  const [storageError, setStorageError] = useState(false);
  const [importSession, setImportSession] = useState<ContactImportSession | null>(null);
  const [importedPeopleFilter, setImportedPeopleFilter] = useState<string[] | null>(null);
  const [suspendedCapture, setSuspendedCapture] = useState<ManualCaptureResumeState | null>(null);
  const [suspendedContactEditor, setSuspendedContactEditor] = useState<ContactEditorResumeState | null>(null);
  const [globalReachOutOpen, setGlobalReachOutOpen] = useState(false);
  const [globalReachOutPerson, setGlobalReachOutPerson] = useState<Person | undefined>();
  const [reachOutRefreshVersion, setReachOutRefreshVersion] = useState(0);
  const [navigationLocked, setNavigationLockedState] = useState(false);
  const routeRef = useRef(route);
  const activeHistoryStateRef = useRef<Record<string, unknown>>(window.history.state ?? {});
  const unsavedChangesRef = useRef(false);
  const navigationLockedRef = useRef(false);
  const pendingNotificationTodayRef = useRef(false);
  const modalBackHandlerRef = useRef<ModalBackHandler | null>(null);
  const globalAddButtonRef = useRef<HTMLButtonElement>(null);
  const keyboardDismissBarRef = useRef<HTMLDivElement>(null);
  const reachOutCaptureOpenerRef = useRef<HTMLElement | null>(null);
  const captureOriginRef = useRef<string | undefined>(
    typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : undefined
  );

  const replayPendingNotificationTap = useCallback(() => {
    if (!pendingNotificationTodayRef.current
      || navigationLockedRef.current
      || unsavedChangesRef.current) return;
    pendingNotificationTodayRef.current = false;
    window.setTimeout(() => {
      window.dispatchEvent(new Event(OPEN_TODAY_FROM_NOTIFICATION_EVENT));
    }, 0);
  }, []);

  const setUnsavedCapture = useCallback((dirty: boolean) => {
    unsavedChangesRef.current = dirty;
    if (!dirty) replayPendingNotificationTap();
  }, [replayPendingNotificationTap]);

  const setNavigationLocked = useCallback((locked: boolean) => {
    navigationLockedRef.current = locked;
    setNavigationLockedState(locked);
    if (!locked) replayPendingNotificationTap();
  }, [replayPendingNotificationTap]);

  useEffect(() => {
    routeRef.current = route;
    activeHistoryStateRef.current = window.history.state ?? {};
  }, [route]);

  useEffect(() => {
    const registerModal = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; dismiss: () => boolean | void }>).detail;
      modalBackHandlerRef.current = {
        ...detail,
        historyState: window.history.state
      };
    };
    const unregisterModal = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (modalBackHandlerRef.current?.id === detail.id) {
        modalBackHandlerRef.current = null;
        replayPendingNotificationTap();
      }
    };
    window.addEventListener("peopleos:modal-open", registerModal);
    window.addEventListener("peopleos:modal-close", unregisterModal);
    return () => {
      window.removeEventListener("peopleos:modal-open", registerModal);
      window.removeEventListener("peopleos:modal-close", unregisterModal);
    };
  }, [replayPendingNotificationTap]);

  useEffect(() => {
    const onPopState = () => {
      const modal = modalBackHandlerRef.current;
      if (modal) {
        window.history.pushState(modal.historyState, "", browserPathForLogicalPath(routeRef.current.path));
        activeHistoryStateRef.current = (modal.historyState as Record<string, unknown> | null) ?? {};
        modal.dismiss();
        return;
      }
      if (navigationLockedRef.current) {
        window.history.pushState(activeHistoryStateRef.current, "", browserPathForLogicalPath(routeRef.current.path));
        return;
      }
      if (unsavedChangesRef.current) {
        if (!window.confirm("Discard changes?")) {
          window.history.pushState(activeHistoryStateRef.current, "", browserPathForLogicalPath(routeRef.current.path));
          return;
        }
        setUnsavedCapture(false);
      }
      activeHistoryStateRef.current = window.history.state ?? {};
      setRoute(routeFromPath(logicalPathFromBrowserPath(window.location.pathname)));
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

  useEffect(() => startCloudSyncService(), []);

  useEffect(() => {
    const openToday = () => {
      if (navigationLockedRef.current) {
        pendingNotificationTodayRef.current = true;
        return;
      }
      if (unsavedChangesRef.current && !window.confirm("Discard changes?")) {
        pendingNotificationTodayRef.current = true;
        return;
      }
      pendingNotificationTodayRef.current = false;
      if (modalBackHandlerRef.current?.dismiss() === false) {
        pendingNotificationTodayRef.current = true;
        return;
      }
      modalBackHandlerRef.current = null;
      setUnsavedCapture(false);
      setGlobalReachOutOpen(false);
      window.history.replaceState({}, "", browserPathForLogicalPath("/"));
      activeHistoryStateRef.current = {};
      setRoute(routeFromPath("/"));
    };
    window.addEventListener(OPEN_TODAY_FROM_NOTIFICATION_EVENT, openToday);
    const stop = startTodayNotificationService();
    return () => {
      stop();
      window.removeEventListener(OPEN_TODAY_FROM_NOTIFICATION_EVENT, openToday);
    };
  }, [setUnsavedCapture]);

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

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let focusFrame = 0;

    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(0, window.innerHeight - height - offsetTop);
      root.style.setProperty("--peopleos-viewport-height", `${height}px`);
      root.style.setProperty("--peopleos-viewport-offset-top", `${offsetTop}px`);
      root.style.setProperty("--peopleos-keyboard-inset", `${keyboardInset}px`);
      const keyboardOpen = keyboardInset > 80;
      root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
      keyboardDismissBarRef.current?.toggleAttribute("hidden", !keyboardOpen);

      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || active instanceof HTMLSelectElement)) return;
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const bounds = active.getBoundingClientRect();
        const visibleTop = offsetTop + 12;
        // Keep the focused control clear of both the keyboard accessory and
        // the fixed form actions used while the iOS visual viewport is short.
        const visibleBottom = offsetTop + height - (keyboardOpen ? 148 : 16);
        if (bounds.top < visibleTop || bounds.bottom > visibleBottom) {
          active.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        }
      });
    };

    const dismissKeyboardOnBlankTap = (event: PointerEvent) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, button, a, label, [role='button']")) return;
      active.blur();
    };

    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    document.addEventListener("focusin", updateViewport);
    document.addEventListener("pointerdown", dismissKeyboardOnBlankTap);
    return () => {
      cancelAnimationFrame(focusFrame);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      document.removeEventListener("focusin", updateViewport);
      document.removeEventListener("pointerdown", dismissKeyboardOnBlankTap);
      delete root.dataset.keyboardOpen;
      keyboardDismissBarRef.current?.setAttribute("hidden", "");
      root.style.removeProperty("--peopleos-viewport-height");
      root.style.removeProperty("--peopleos-viewport-offset-top");
      root.style.removeProperty("--peopleos-keyboard-inset");
    };
  }, []);

  function navigate(next: Route, options: { replace?: boolean; state?: Record<string, unknown> } = {}) {
    if (navigationLockedRef.current) return;
    if (next.path === route.path) return;
    if (unsavedChangesRef.current) {
      if (!window.confirm("Discard changes?")) return;
      setUnsavedCapture(false);
    }
    if (next.id === "add-person") captureOriginRef.current = route.path;
    let defaultState: Record<string, unknown> = {};
    if (next.id === "add-person") {
      defaultState = { fromPath: captureOriginRef.current };
    } else if (next.id === "post-add-relationship") {
      const existingOrigin = window.history.state?.fromPath;
      defaultState = {
        fromPath: typeof existingOrigin === "string"
          ? existingOrigin
          : captureOriginRef.current ?? "/people"
      };
    } else if (next.id === "import-contacts") {
      const existingOrigin = window.history.state?.fromPath;
      const fromPath = route.id === "import-results" && typeof existingOrigin === "string"
        ? existingOrigin
        : route.id === "add-person" && typeof existingOrigin === "string"
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
    const browserPath = browserPathForLogicalPath(next.path);
    if (options.replace) window.history.replaceState(state, "", browserPath);
    else window.history.pushState(state, "", browserPath);
    activeHistoryStateRef.current = state;
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function navigatePath(path: string, options?: { replace?: boolean; state?: Record<string, unknown> }) {
    navigate(routeFromPath(path), options);
  }

  function openReachOutCapture(person?: Person, opener?: HTMLElement | null) {
    if (navigationLockedRef.current) return;
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
      browserPathForLogicalPath(route.path)
    );
    const next = routeFromPath(`/people/${encodeURIComponent(personId)}`);
    window.history.pushState(
      { fromPath: "/people/new", resumeCapture: true },
      "",
      browserPathForLogicalPath(next.path)
    );
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
      browserPathForLogicalPath(route.path)
    );
    const next = routeFromPath(`/people/${encodeURIComponent(personId)}`);
    window.history.pushState(
      { fromPath: route.path, resumeContactEditor: true },
      "",
      browserPathForLogicalPath(next.path)
    );
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function chooseFromIPhoneContacts(): Promise<"selected" | "cancelled"> {
    if (unsavedChangesRef.current && !window.confirm("Discard changes?")) return "cancelled";
    const adapter = getIPhoneContactsAdapter();
    if (!adapter) throw Object.assign(new Error("iPhone Contacts are unavailable."), { code: "unavailable" });
    const result = await pickSingleIPhoneContact(adapter);
    if (result.status === "cancelled") return "cancelled";
    const db = await getDatabase();
    const settings = await getAppSettings(db);
    const session = await prepareContactImportFromPickerResult(
      db,
      result,
      settings.defaultPhoneRegion
    );
    if (!session) return "cancelled";
    setImportSession(session);
    setUnsavedCapture(false);
    const fromPath = captureOriginRef.current
      ?? (typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : "/people");
    navigatePath("/people/import", { state: { fromPath } });
    return "selected";
  }

  function renderScreen() {
    const relationshipFilter = relationshipContexts.length === 2 ? (
      <RelationshipFilter
        value={activeRelationshipMode}
        onChange={(mode) => {
          writeActiveRelationshipMode(mode);
          setActiveRelationshipMode(mode);
        }}
      />
    ) : undefined;
    switch (route.id) {
      case "today": return (
        <TodayScreen
          activeMode={activeRelationshipMode}
          navigate={navigatePath}
          onBusyChange={setNavigationLocked}
        />
      );
      case "reach-out": return (
        <ReachOutScreen
          key={reachOutRefreshVersion}
          activeMode={activeRelationshipMode}
          navigate={navigatePath}
          onAdd={(opener) => openReachOutCapture(undefined, opener)}
          onBusyChange={setNavigationLocked}
        />
      );
      case "people": return (
        <PeopleScreen
          navigate={navigatePath}
          importedPersonIds={importedPeopleFilter}
          onClearImportedFilter={() => setImportedPeopleFilter(null)}
          activeMode={activeRelationshipMode}
          relationshipFilter={relationshipFilter}
        />
      );
      case "upcoming": return <UpcomingScreen activeMode={activeRelationshipMode} navigate={navigatePath} />;
      case "settings": return <SettingsScreen navigate={navigatePath} />;
      case "conversation-starters": return (
        <ConversationStarterSettingsScreen
          navigate={navigatePath}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
        />
      );
      case "privacy": return <PrivacyScreen navigate={navigatePath} />;
      case "add-person": return (
        <AddPersonScreen
          navigate={navigatePath}
          dismiss={dismissCapture}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
          iPhoneContactsSupported={isIPhoneContactsSupported()}
          onChooseIPhoneContacts={chooseFromIPhoneContacts}
          initialCapture={window.history.state?.resumeCapture ? suspendedCapture : null}
          defaultRelationshipMode={activeRelationshipMode === "professional" ? "professional" : "personal"}
          onOpenDuplicatePerson={openExistingFromCapture}
          onCaptureFinished={() => setSuspendedCapture(null)}
        />
      );
      case "post-add-relationship": return (
        <PostAddRelationshipScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          onSavingChange={setNavigationLocked}
          closePath={typeof window.history.state?.fromPath === "string"
            ? window.history.state.fromPath
            : undefined}
        />
      );
      case "person-profile": return (
        <PersonProfileScreen
          personId={route.personId ?? ""}
          navigate={navigatePath}
          backPath={typeof window.history.state?.fromPath === "string" ? window.history.state.fromPath : "/people"}
          onAddToReachOut={(person, opener) => openReachOutCapture(person, opener)}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
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

  const showGlobalAdd = ["today", "reach-out", "people"].includes(route.id);

  return (
    <div className="app-shell" data-build-commit={PEOPLEOS_BUILD_COMMIT}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <a className="brand" href={browserPathForLogicalPath("/")} onClick={(event) => { event.preventDefault(); navigate(routes[0]); }} aria-label="PeopleOS home">
          <img className="brand-mark" src={appAssetPath("peopleos-mark.svg")} alt="" aria-hidden="true" />
          <span>PeopleOS</span>
        </a>
        <div className="header-actions">
          <p>Remember people.</p>
          {showGlobalAdd && (
            <button
              ref={globalAddButtonRef}
              className="header-add-person"
              type="button"
              disabled={navigationLocked}
              onClick={(event) => {
                if (route.id === "reach-out") openReachOutCapture(undefined, event.currentTarget);
                else navigatePath("/people/new");
              }}
            >
              <Icon name="plus" /> Add
            </button>
          )}
        </div>
      </header>
      {showGlobalAdd && <div className="relationship-mode-bar">
        <div className="relationship-filter-pills" role="group" aria-label={route.id === "today" ? "Today filters" : "Relationship filter"}>
          {(["all", "personal", "professional"] as ActiveRelationshipMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={navigationLocked}
              aria-pressed={activeRelationshipMode === mode}
              onClick={() => {
                if (navigationLockedRef.current) return;
                writeActiveRelationshipMode(mode);
                setActiveRelationshipMode(mode);
                requestTodayNotificationReconcile();
              }}
            >{mode === "all" ? "All" : mode === "personal" ? "Personal" : "Professional"}</button>
          ))}
        </div>
      </div>}

      {storageError && <p className="storage-error" role="alert">PeopleOS could not open local storage. Your data actions are unavailable.</p>}
      {renderScreen()}

      <div ref={keyboardDismissBarRef} className="keyboard-dismiss-bar" aria-label="Keyboard controls" hidden>
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
              active.blur();
            }
          }}
        >Done</button>
      </div>

      <nav className="primary-nav" aria-label="Primary navigation">
        {routes.map((item) => (
          <a
            key={item.id}
            href={browserPathForLogicalPath(item.path)}
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
          onSaved={() => {
            setGlobalReachOutOpen(false);
            setGlobalReachOutPerson(undefined);
            reachOutCaptureOpenerRef.current = null;
            setReachOutRefreshVersion((current) => current + 1);
            if (route.id !== "reach-out") navigatePath("/reach-out");
          }}
          onOpenExisting={() => {
            setGlobalReachOutOpen(false);
            setGlobalReachOutPerson(undefined);
            reachOutCaptureOpenerRef.current = null;
            setReachOutRefreshVersion((current) => current + 1);
            if (route.id !== "reach-out") navigatePath("/reach-out");
          }}
        />
      )}
    </div>
  );
}
