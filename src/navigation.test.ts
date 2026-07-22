import { describe, expect, it } from "vitest";
import { contactMethodsPath, personProfilePath, routeFromPath } from "./navigation";

describe("V1-03 people routes", () => {
  it("resolves manual capture as a People secondary route", () => {
    expect(routeFromPath("/people/new")).toMatchObject({ id: "add-person", primaryId: "people" });
    expect(routeFromPath("/people/new/")).toMatchObject({ id: "add-person", path: "/people/new" });
  });

  it("round-trips safe Person IDs through profile and contact-method paths", () => {
    const personId = "person-one/two";
    const profilePath = personProfilePath(personId);
    const methodsPath = contactMethodsPath(personId);
    expect(routeFromPath(profilePath)).toMatchObject({ id: "person-profile", personId, primaryId: "people" });
    expect(routeFromPath(methodsPath)).toMatchObject({ id: "contact-methods", personId, primaryId: "people" });
  });

  it("continues to fall back to Today for an unknown route", () => {
    expect(routeFromPath("/not-a-peopleos-route")).toMatchObject({ id: "today", path: "/" });
  });
});
