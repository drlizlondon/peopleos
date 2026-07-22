import { describe, expect, it } from "vitest";
import {
  affiliationsPath,
  contactMethodsPath,
  memoryFactsPath,
  personProfilePath,
  routeFromPath,
  timelinePath
} from "./navigation";

describe("People secondary routes", () => {
  it("resolves manual capture as a People secondary route", () => {
    expect(routeFromPath("/people/new")).toMatchObject({ id: "add-person", primaryId: "people" });
    expect(routeFromPath("/people/new/")).toMatchObject({ id: "add-person", path: "/people/new" });
  });

  it("resolves vCard preview and results as People secondary routes", () => {
    expect(routeFromPath("/people/import")).toMatchObject({ id: "import-contacts", primaryId: "people" });
    expect(routeFromPath("/people/import/results")).toMatchObject({ id: "import-results", primaryId: "people" });
  });

  it("round-trips safe Person IDs through every Person-owned secondary path", () => {
    const personId = "person-one/two";
    const profilePath = personProfilePath(personId);
    const methodsPath = contactMethodsPath(personId);
    const factsPath = memoryFactsPath(personId);
    const workPath = affiliationsPath(personId);
    const historyPath = timelinePath(personId);
    expect(routeFromPath(profilePath)).toMatchObject({ id: "person-profile", personId, primaryId: "people" });
    expect(routeFromPath(methodsPath)).toMatchObject({ id: "contact-methods", personId, primaryId: "people" });
    expect(routeFromPath(factsPath)).toMatchObject({ id: "memory-facts", personId, primaryId: "people" });
    expect(routeFromPath(workPath)).toMatchObject({ id: "affiliations", personId, primaryId: "people" });
    expect(routeFromPath(historyPath)).toMatchObject({ id: "timeline", personId, primaryId: "people" });
  });

  it("continues to fall back to Today for an unknown route", () => {
    expect(routeFromPath("/not-a-peopleos-route")).toMatchObject({ id: "today", path: "/" });
  });
});
