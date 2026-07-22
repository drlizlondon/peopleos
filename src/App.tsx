import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { routeFromPath, routes, type Route } from "./navigation";
import { PeopleScreen, ReachOutScreen, SettingsScreen, TodayScreen, UpcomingScreen } from "./screens";

const screens: Record<Route["id"], () => JSX.Element> = {
  today: TodayScreen,
  "reach-out": ReachOutScreen,
  people: PeopleScreen,
  upcoming: UpcomingScreen,
  settings: SettingsScreen
};

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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

  const Screen = screens[route.id];

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

      <Screen />

      <nav className="primary-nav" aria-label="Primary navigation">
        {routes.map((item) => (
          <a
            key={item.id}
            href={item.path}
            className={item.id === route.id ? "active" : undefined}
            aria-current={item.id === route.id ? "page" : undefined}
            onClick={(event) => { event.preventDefault(); navigate(item); }}
          >
            <Icon name={item.id} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
