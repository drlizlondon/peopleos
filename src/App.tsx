import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { routeFromPath, routes, type Route } from "./navigation";
import { ReachOutScreen, SettingsScreen, UpcomingScreen } from "./screens";
import {
  AddPersonScreen,
  ContactMethodsScreen,
  PeopleScreen,
  PersonProfileScreen,
  TodayScreen
} from "./peopleScreens";
import { ExportBackupScreen, RestoreBackupScreen } from "./dataScreens";
import { getDatabase } from "./data/client";

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [storageError, setStorageError] = useState(false);
  const routeRef = useRef(route);
  const unsavedChangesRef = useRef(false);
  const navigationLockedRef = useRef(false);
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
    const onPopState = () => {
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
    if (unsavedChangesRef.current) {
      if (!window.confirm("Discard changes?")) return;
      setUnsavedCapture(false);
    }
    if (next.id === "add-person") captureOriginRef.current = route.path;
    let defaultState: Record<string, unknown> = {};
    if (next.id === "add-person") {
      defaultState = { fromPath: captureOriginRef.current };
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
    const fromPath = captureOriginRef.current ?? window.history.state?.fromPath;
    if (typeof fromPath === "string") {
      window.history.back();
      return;
    }
    navigate(routeFromPath("/people"), { replace: true });
  }

  function renderScreen() {
    switch (route.id) {
      case "today": return <TodayScreen navigate={navigatePath} />;
      case "reach-out": return <ReachOutScreen />;
      case "people": return <PeopleScreen navigate={navigatePath} />;
      case "upcoming": return <UpcomingScreen />;
      case "settings": return <SettingsScreen navigate={navigatePath} />;
      case "add-person": return (
        <AddPersonScreen
          navigate={navigatePath}
          dismiss={dismissCapture}
          onDirtyChange={setUnsavedCapture}
          onSavingChange={setNavigationLocked}
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
        />
      );
      case "export-backup": return <ExportBackupScreen navigate={navigatePath} />;
      case "restore-backup": return <RestoreBackupScreen navigate={navigatePath} />;
    }
  }

  const showGlobalAdd = ["today", "reach-out", "people", "upcoming"].includes(route.id);

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
            <a className="header-add-person" href="/people/new" onClick={(event) => { event.preventDefault(); navigatePath("/people/new"); }}>
              <Icon name="plus" /> Add person
            </a>
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
            onClick={(event) => { event.preventDefault(); navigate(item); }}
          >
            <Icon name={item.primaryId} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
