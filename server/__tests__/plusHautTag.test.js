// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PLUS HAUT TAG : SEMVER STRICT, TRI NUMÉRIQUE, INVALIDES IGNORÉS (treizième audit).
const { pathToFileURL } = require("node:url");
const path = require("node:path");
let M;
beforeAll(async () => { M = await import(pathToFileURL(path.join(__dirname, "..", "..", "tools", "plus-haut-tag.mjs")).href); });

describe("sélection stricte du plus haut tag de version", () => {
  it("n'accepte que vX.Y.Z", () => {
    for (const bon of ["v0.1.83", "v1.0.0", "v12.34.567"]) expect(M.estTagValide(bon), bon).toBe(true);
    for (const faux of ["v999-test", "v0.1", "0.1.83", "v0.1.83-rc1", "vlatest", ""]) expect(M.estTagValide(faux), faux).toBe(false);
  });

  it("compare NUMÉRIQUEMENT — v0.1.9 < v0.1.10 (ce que le tri de chaînes rate)", () => {
    expect(M.comparer("v0.1.9", "v0.1.10")).toBeLessThan(0);
    expect(M.comparer("v0.2.0", "v0.1.99")).toBeGreaterThan(0);
    expect(M.comparer("v1.0.0", "v1.0.0")).toBe(0);
  });

  it("rend le plus haut en ignorant un tag accidentel", () => {
    expect(M.plusHaut(["v0.1.9", "v0.1.10", "v0.1.83", "v999-test", "vlatest"])).toBe("v0.1.83");
    expect(M.plusHaut(["v0.1.83", "v0.1.84", "v0.2.0"])).toBe("v0.2.0");
  });

  it("rend \"\" si aucun tag valide — pas de promotion sur du vide", () => {
    expect(M.plusHaut(["v999-test", "brouillon", ""])).toBe("");
    expect(M.plusHaut([])).toBe("");
  });
});
