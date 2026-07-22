import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { routeFromPath, routes, type Route } from "./navigation";
import { PeopleScreen, ReachOutScreen, SettingsScreen, TodayScreen, UpcomingScreen } from "./screens";
import { ExportBackupScreen, RestoreBackupScreen } from "./dataScreens";
import { getDatabase } from "./data/client";

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    getDatabase().catch(() => setStorageError(true));
  }, []);

  useEffect(() => {
    document.title = route.id === "today" ? "PeopleOS" : `${route.label} · PeopleOS`;
    document.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
  }, [route]);

  function navigate(next: Route) {
    if (next.path === route.path) return;
    window.history.pushState({}, "", next.path);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderScreen() {
    switch (route.id) {
      case "today": return <TodayScreen />;
      case "reach-out": return <ReachOutScreen />;
      case "people": return <PeopleScreen />;
      case "upcoming": return <UpcomingScreen />;
      case "settings": return <SettingsScreen navigate={(path) => navigate(routeFromPath(path))} />;
      case "export-backup": return <ExportBackupScreen navigate={(path) => navigate(routeFromPath(path))} />;
      case "restore-backup": return <RestoreBackupScreen navigate={(path) => navigate(routeFromPath(path))} />;
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate(routes[0]); }} aria-label="PeopleOS home">
          <span className="brand-mark" aria-hidden="true"><span /><span /></span>
          <span>PeopleOS</span>
        </a>
        <p>Remember people.</p>
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
