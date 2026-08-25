// UN NOM AFFIRME UN FORMAT, DONC LE FORMAT SE VÉRIFIE D'ABORD.
//
// ⚠️ Le suffixe `.sigstore.json` est ce à quoi Scorecard reconnaît une signature de release. Le
// poser sur autre chose ferait de la note un mensonge — le mensonge d'étiquette que les gardes
// d'actions refusent ailleurs.

import { describe, it, expect } from "vitest";

import { mediaTypeDe, ecart } from "../bundle-sigstore.mjs";

describe("le mediaType déclaré", () => {
  it("se lit quand il est là", () => {
    expect(mediaTypeDe({ mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.3" }))
      .toBe("application/vnd.dev.sigstore.bundle+json;version=0.3");
  });

  it("rend null plutôt qu'une chaîne vide — « absent » et « vide » ne se confondent pas", () => {
    expect(mediaTypeDe({})).toBeNull();
    expect(mediaTypeDe({ mediaType: "" })).toBeNull();
    expect(mediaTypeDe({ mediaType: 3 })).toBeNull();
  });
});

describe("le verdict", () => {
  it("accepte un bundle Sigstore, quelle que soit sa version", () => {
    for (const v of ["0.1", "0.2", "0.3"]) {
      expect(ecart({ mediaType: `application/vnd.dev.sigstore.bundle+json;version=${v}` })).toBeNull();
    }
  });

  it("⚠️ refuse un fichier sans mediaType — on ne prétend pas un format absent", () => {
    expect(ecart({})).toMatch(/aucun mediaType/);
  });

  it("⚠️ refuse un autre format EN DISANT lequel — « ce n'est pas un bundle » n'aide personne", () => {
    const souci = ecart({ mediaType: "application/vnd.in-toto+json" });
    expect(souci).toContain("application/vnd.in-toto+json");
    expect(souci).toContain("application/vnd.dev.sigstore.bundle");
  });
});
