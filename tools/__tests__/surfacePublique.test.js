// LA SURFACE PUBLIQUE, CONFRONTÉE À CE QUE LE PAQUET EXPOSE VRAIMENT.
//
// ⚠️ `package.json#exports` portait dix sous-chemins, dont cinq que docs/API.md ne mentionnait
// nulle part (troisième audit externe, 21/08). Une donnée exposée est une promesse ; une promesse
// que personne ne peut lire n'engage que celui qui la découvre — et il la découvre en production.
// Ce banc éprouve la logique de confrontation, puis l'applique au paquet réel : les cas
// synthétiques prouvent la règle, le dernier prouve qu'elle porte sur ce qu'on publie.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { SURFACE, publics, ecartsExports, ecartsDoc, ecartsInternes, formeImportee, INTERNES_TOLERES } from "../surface-publique.mjs";

describe("le manifeste et package.json se confrontent", () => {
  const paquet = JSON.parse(readFileSync("package.json", "utf8"));

  it("s'accordent sur le paquet réel", () => {
    expect(ecartsExports(paquet.exports)).toEqual([]);
  });

  it("refuse un export ajouté sans être classé — le trou d'origine", () => {
    const soucis = ecartsExports({ ...paquet.exports, "./nouveau": "./server/nouveau.js" });
    expect(soucis.join(" ")).toMatch(/« \.\/nouveau ».*sans le classer/);
  });

  it("refuse un classement qui ne correspond à aucun export", () => {
    const ampute = { ...paquet.exports };
    delete ampute["./brands"];
    expect(ecartsExports(ampute).join(" ")).toMatch(/classe « \.\/brands ».*n'expose pas/);
  });

  it("chaque entrée porte un statut connu et une description", () => {
    for (const [sousChemin, d] of Object.entries(SURFACE)) {
      expect(["stable", "experimental", "document", "manifeste"], sousChemin).toContain(d.statut);
      expect(d.quoi, sousChemin).toBeTruthy();
    }
  });
});

describe("la documentation doit nommer ce qui est exposé", () => {
  it("docs/API.md les nomme tous", () => {
    expect(ecartsDoc(readFileSync("docs/API.md", "utf8"))).toEqual([]);
  });

  it("rougit si un export public disparaît de la doc", () => {
    const ampute = readFileSync("docs/API.md", "utf8").replaceAll("`discovery-media-player/shares`", "(retiré)");
    expect(ecartsDoc(ampute).join(" ")).toMatch(/« \.\/shares »/);
  });

  it("cherche la forme qu'un intégrateur écrit, pas la notation de package.json", () => {
    // « ./shares » est la notation d'exports ; personne n'écrit require("...././shares").
    expect(formeImportee("./shares")).toBe("discovery-media-player/shares");
    expect(formeImportee(".")).toBe("discovery-media-player");
  });

  it("ne réclame rien pour les documents et le manifeste", () => {
    expect(publics()).not.toContain("./contrat");
    expect(publics()).not.toContain("./package.json");
  });
});

describe("les symboles internes exposés — le préfixe dit, il n'empêche pas", () => {
  it("tolère ceux qui sont déclarés", () => {
    expect(ecartsInternes(".", ["handler", "init", ...INTERNES_TOLERES["."]])).toEqual([]);
  });

  it("refuse un nouveau symbole interne non décidé", () => {
    expect(ecartsInternes(".", ["handler", "__nouvelInterne"]).join(" ")).toMatch(/__nouvelInterne.*décidez-le/);
  });

  it("ne dit rien des symboles publics ordinaires", () => {
    expect(ecartsInternes("./shares", ["createShare", "getShareBySlug"])).toEqual([]);
  });

  it("le point d'entrée réel n'expose que les internes tolérés", () => {
    // ⚠️ La garde de la garde : si quelqu'un ajoute un `__quelqueChose` au handler, ce test le
    // dit ici, avant que la CI ne le dise sur la forge.
    const mod = require("../../server/handler.js");
    expect(ecartsInternes(".", Object.keys(mod))).toEqual([]);
  });
});
