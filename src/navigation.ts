export type PrimaryRouteId = "today" | "reach-out" | "people" | "upcoming" | "settings";
export type RouteId = PrimaryRouteId
  | "add-person"
  | "person-profile"
  | "edit-person"
  | "contact-methods"
  | "memory-facts"
  | "affiliations"
  | "timeline"
  | "person-follow-ups"
  | "follow-up-detail"
  | "reach-out-detail"
  | "resolve-provisional"
  | "import-contacts"
  | "import-results"
  | "privacy"
  | "export-backup"
  | "restore-backup";

export type Route = {
  id: RouteId;
  path: string;
  label: string;
  primaryId: PrimaryRouteId;
  personId?: string;
  followUpId?: string;
  reachOutEntryId?: string;
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
  { id: "privacy", path: "/settings/privacy", label: "Privacy", primaryId: "settings" },
  { id: "export-backup", path: "/settings/export", label: "Export backup", primaryId: "settings" },
  { id: "restore-backup", path: "/settings/restore", label: "Restore backup", primaryId: "settings" }
];

export function routeFromPath(pathname: string): Route {
  const staticRoute = [...routes, ...secondaryRoutes].find((route) => route.path === pathname);
  if (staticRoute) return staticRoute;

  if (pathname === "/people/new" || pathname === "/people/new/") {
    return { id: "add-person", path: "/people/new", label: "Add person", primaryId: "people" };
  }

  const editPerson = pathname.match(/^\/people\/([^/]+)\/edit\/?$/);
  if (editPerson) {
    const personId = decodePathPart(editPerson[1]);
    return { id: "edit-person", path: pathname, label: "Edit person", primaryId: "people", personId };
  }

  const resolvePerson = pathname.match(/^\/people\/([^/]+)\/resolve\/?$/);
  if (resolvePerson) {
    const personId = decodePathPart(resolvePerson[1]);
    return { id: "resolve-provisional", path: pathname, label: "Complete identity", primaryId: "people", personId };
  }

  const contactMethods = pathname.match(/^\/people\/([^/]+)\/contact-methods\/?$/);
  if (contactMethods) {
    const personId = decodePathPart(contactMethods[1]);
    return { id: "contact-methods", path: pathname, label: "Contact details", primaryId: "people", personId };
  }

  const memoryFacts = pathname.match(/^\/people\/([^/]+)\/facts\/?$/);
  if (memoryFacts) {
    const personId = decodePathPart(memoryFacts[1]);
    return { id: "memory-facts", path: pathname, label: "Memory facts", primaryId: "people", personId };
  }

  const affiliations = pathname.match(/^\/people\/([^/]+)\/affiliations\/?$/);
  if (affiliations) {
    const personId = decodePathPart(affiliations[1]);
    return { id: "affiliations", path: pathname, label: "Affiliations", primaryId: "people", personId };
  }

  const timeline = pathname.match(/^\/people\/([^/]+)\/timeline\/?$/);
  if (timeline) {
    const personId = decodePathPart(timeline[1]);
    return { id: "timeline", path: pathname, label: "Timeline", primaryId: "people", personId };
  }

  const personFollowUps = pathname.match(/^\/people\/([^/]+)\/follow-ups\/?$/);
  if (personFollowUps) {
    const personId = decodePathPart(personFollowUps[1]);
    return { id: "person-follow-ups", path: pathname, label: "Follow-ups", primaryId: "people", personId };
  }

  const followUpDetail = pathname.match(/^\/follow-ups\/([^/]+)\/?$/);
  if (followUpDetail) {
    const followUpId = decodePathPart(followUpDetail[1]);
    return { id: "follow-up-detail", path: pathname, label: "Follow-up", primaryId: "upcoming", followUpId };
  }

  const resolveProvisional = pathname.match(/^\/reach-out\/([^/]+)\/resolve\/?$/);
  if (resolveProvisional) {
    const reachOutEntryId = decodePathPart(resolveProvisional[1]);
    return { id: "resolve-provisional", path: pathname, label: "Resolve identity", primaryId: "reach-out", reachOutEntryId };
  }

  const reachOutDetail = pathname.match(/^\/reach-out\/([^/]+)\/?$/);
  if (reachOutDetail) {
    const reachOutEntryId = decodePathPart(reachOutDetail[1]);
    return { id: "reach-out-detail", path: pathname, label: "Reach Out plan", primaryId: "reach-out", reachOutEntryId };
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

export function editPersonPath(personId: string): string {
  return `${personProfilePath(personId)}/edit`;
}

export function resolvePersonPath(personId: string): string {
  return `${personProfilePath(personId)}/resolve`;
}

export function memoryFactsPath(personId: string): string {
  return `${personProfilePath(personId)}/facts`;
}

export function affiliationsPath(personId: string): string {
  return `${personProfilePath(personId)}/affiliations`;
}

export function timelinePath(personId: string): string {
  return `${personProfilePath(personId)}/timeline`;
}

export function personFollowUpsPath(personId: string): string {
  return `${personProfilePath(personId)}/follow-ups`;
}

export function followUpDetailPath(followUpId: string): string {
  return `/follow-ups/${encodeURIComponent(followUpId)}`;
}

export function reachOutDetailPath(reachOutEntryId: string): string {
  return `/reach-out/${encodeURIComponent(reachOutEntryId)}`;
}

export function resolveProvisionalPath(reachOutEntryId: string): string {
  return `${reachOutDetailPath(reachOutEntryId)}/resolve`;
}
