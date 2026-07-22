export type RouteId = "today" | "reach-out" | "people" | "upcoming" | "settings";

export type Route = {
  id: RouteId;
  path: string;
  label: string;
};

export const routes: Route[] = [
  { id: "today", path: "/", label: "Today" },
  { id: "reach-out", path: "/reach-out", label: "Reach Out" },
  { id: "people", path: "/people", label: "People" },
  { id: "upcoming", path: "/upcoming", label: "Upcoming" },
  { id: "settings", path: "/settings", label: "Settings" }
];

export function routeFromPath(pathname: string): Route {
  return routes.find((route) => route.path === pathname) ?? routes[0];
}
