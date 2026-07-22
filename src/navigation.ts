export type PrimaryRouteId = "today" | "reach-out" | "people" | "upcoming" | "settings";
export type RouteId = PrimaryRouteId
  | "add-person"
  | "person-profile"
  | "contact-methods"
  | "import-contacts"
  | "import-results"
  | "export-backup"
  | "restore-backup";

export type Route = {
  id: RouteId;
  path: string;
  label: string;
  primaryId: PrimaryRouteId;
  personId?: string;
};

export const routes: Route[] = [
  { id: "today", path: "/", label: "Today", primaryId: "today" },
  { id: "reach-out", path: "/reach-out", label: "Reach Out", primaryId: "reach-out" },
  { id: "people", path: "/people", label: "People", primaryId: "people" },
  { id: "upcoming", path: "/upcoming", label: "Upcoming", primaryId: "upcoming" },
  { id: "settings", path: "/settings", label: "Settings", primaryId: "settings" }
];

const secondaryRoutes: Route[] = [
  { id: "import-contacts", path: "/people/import", label: "Import contacts", primaryId: "people" },
  { id: "import-results", path: "/people/import/results", label: "Import results", primaryId: "people" },
  { id: "export-backup", path: "/settings/export", label: "Export backup", primaryId: "settings" },
  { id: "restore-backup", path: "/settings/restore", label: "Restore backup", primaryId: "settings" }
];

export function routeFromPath(pathname: string): Route {
  const staticRoute = [...routes, ...secondaryRoutes].find((route) => route.path === pathname);
  if (staticRoute) return staticRoute;

  if (pathname === "/people/new" || pathname === "/people/new/") {
    return { id: "add-person", path: "/people/new", label: "Add person", primaryId: "people" };
  }

  const contactMethods = pathname.match(/^\/people\/([^/]+)\/contact-methods\/?$/);
  if (contactMethods) {
    const personId = decodePathPart(contactMethods[1]);
    return { id: "contact-methods", path: pathname, label: "Contact details", primaryId: "people", personId };
  }

  const profile = pathname.match(/^\/people\/([^/]+)\/?$/);
  if (profile) {
    const personId = decodePathPart(profile[1]);
    return { id: "person-profile", path: pathname, label: "Person", primaryId: "people", personId };
  }

  return routes[0];
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function personProfilePath(personId: string): string {
  return `/people/${encodeURIComponent(personId)}`;
}

export function contactMethodsPath(personId: string): string {
  return `${personProfilePath(personId)}/contact-methods`;
}
