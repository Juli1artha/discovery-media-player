// LE PLUS HAUT TAG : SEMVER STRICT, TRI NUMÉRIQUE, INVALIDES IGNORÉS (treizième audit).
import { estTagValide, comparer, plusHaut } from "../../tools/plus-haut-tag.mjs";

describe("sélection stricte du plus haut tag de version", () => {
  it("n'accepte que vX.Y.Z", () => {
    for (const bon of ["v0.1.83", "v1.0.0", "v12.34.567"]) expect(estTagValide(bon), bon).toBe(true);
    for (const faux of ["v999-test", "v0.1", "0.1.83", "v0.1.83-rc1", "vlatest", ""]) expect(estTagValide(faux), faux).toBe(false);
  });

  it("compare NUMÉRIQUEMENT — v0.1.9 < v0.1.10 (ce que le tri de chaînes rate)", () => {
    expect(comparer("v0.1.9", "v0.1.10")).toBeLessThan(0);
    expect(comparer("v0.2.0", "v0.1.99")).toBeGreaterThan(0);
    expect(comparer("v1.0.0", "v1.0.0")).toBe(0);
  });

  it("rend le plus haut en ignorant un tag accidentel", () => {
    expect(plusHaut(["v0.1.9", "v0.1.10", "v0.1.83", "v999-test", "vlatest"])).toBe("v0.1.83");
    expect(plusHaut(["v0.1.83", "v0.1.84", "v0.2.0"])).toBe("v0.2.0");
  });

  it("rend \"\" si aucun tag valide — pas de promotion sur du vide", () => {
    expect(plusHaut(["v999-test", "brouillon", ""])).toBe("");
    expect(plusHaut([])).toBe("");
  });
});
