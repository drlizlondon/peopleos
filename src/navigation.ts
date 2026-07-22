export type PrimaryRouteId = "today" | "reach-out" | "people" | "upcoming" | "settings";
export type RouteId = PrimaryRouteId | "export-backup" | "restore-backup";

export type Route = {
  id: RouteId;
  path: string;
  label: string;
  primaryId: PrimaryRouteId;
};

export const routes: Route[] = [
  { id: "today", path: "/", label: "Today", primaryId: "today" },
  { id: "reach-out", path: "/reach-out", label: "Reach Out", primaryId: "reach-out" },
  { id: "people", path: "/people", label: "People", primaryId: "people" },
  { id: "upcoming", path: "/upcoming", label: "Upcoming", primaryId: "upcoming" },
  { id: "settings", path: "/settings", label: "Settings", primaryId: "settings" }
];

const secondaryRoutes: Route[] = [
  { id: "export-backup", path: "/settings/export", label: "Export backup", primaryId: "settings" },
  { id: "restore-backup", path: "/settings/restore", label: "Restore backup", primaryId: "settings" }
];

export function routeFromPath(pathname: string): Route {
  return [...routes, ...secondaryRoutes].find((route) => route.path === pathname) ?? routes[0];
}
