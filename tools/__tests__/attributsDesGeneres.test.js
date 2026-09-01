// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES FICHIERS GÉNÉRÉS, ÉPROUVÉS SUR LE VRAI CONSTRUCTEUR ET SUR CE QUI POURRAIT LE CASSER.
//
// ⚠️ La garde dérive sa liste de `build/bundle.mjs`. Sa panne la plus probable n'est pas de rater
// un fichier non couvert : c'est de ne plus rien lire du constructeur — et de rendre alors une
// absence de reproche qui ressemble à un succès. Les deux premiers cas visent ça.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { sortiesDuConstructeur, motifsGeneres, couvre, nonCouverts } from "../attributs-des-generes.mjs";

const CONSTRUCTEUR = readFileSync("build/bundle.mjs", "utf8");
const ATTRIBUTS = readFileSync(".gitattributes", "utf8");

describe("la liste des générés vient du constructeur, jamais de la garde", () => {
  it("lit bien les sorties du vrai build/bundle.mjs", () => {
    const s = sortiesDuConstructeur(CONSTRUCTEUR);
    expect(s.length, "la sonde ne lit plus le constructeur : elle n'aurait plus rien à réclamer").toBeGreaterThanOrEqual(2);
    expect(s).toContain("server/browser.generated.js");
  });

  it("⚠️ CONTRÔLE POSITIF — un constructeur qu'elle ne sait plus lire rend zéro, pas un succès", () => {
    expect(sortiesDuConstructeur("const OUT = join(ROOT, \"server/x.generated.js\");")).toEqual([]);
  });
});

describe("la couverture est réclamée pour chaque sortie", () => {
  it("le vrai .gitattributes couvre toutes les vraies sorties", () => {
    expect(nonCouverts(sortiesDuConstructeur(CONSTRUCTEUR), motifsGeneres(ATTRIBUTS))).toEqual([]);
  });

  it("⚠️ CONTRÔLE POSITIF — une sortie hors convention est signalée, et nommée", () => {
    const orphelins = nonCouverts(["server/browser.generated.js", "server/autre-bundle.js"], motifsGeneres(ATTRIBUTS));
    expect(orphelins).toEqual(["server/autre-bundle.js"]);
  });

  it("⚠️ CONTRÔLE POSITIF — un .gitattributes sans marquage laisse TOUT découvert", () => {
    const sansMarquage = "* text=auto eol=lf\n# rien de généré ici\n";
    expect(motifsGeneres(sansMarquage)).toEqual([]);
    expect(nonCouverts(["server/browser.generated.js"], motifsGeneres(sansMarquage))).toHaveLength(1);
  });

  it("le motif ne déborde pas sur un fichier écrit à la main", () => {
    expect(couvre("*.generated.js", "server/browser.generated.js")).toBe(true);
    expect(couvre("*.generated.js", "server/handler.js")).toBe(false);
  });
});

// ⚠️ L'ÉCHAPPEMENT DU MOTIF N'ÉTAIT ÉPROUVÉ NULLE PART. `couvre` convertit un glob en expression
// régulière : les métacaractères sont échappés, puis `*` devient `[^/]*`. Mesuré le 01/09 en
// aveuglant l'échappement : ni la garde ni ce banc ne bougeaient — parce que le seul motif du
// dépôt est `*.generated.js` et que ses sorties le vérifient dans les deux cas. La direction de
// la panne est pourtant la mauvaise : sans échappement, le point est un joker, donc le motif
// couvre PLUS que ce qu'il dit, donc `nonCouverts` réclame MOINS. Un fichier généré non déclaré
// passerait pour couvert.
describe("⚠️ un glob converti en expression régulière ne doit pas devenir plus permissif", () => {
  it("le point d'un motif est un point, pas un joker", () => {
    expect(couvre("*.generated.js", "browser.generated.js")).toBe(true);
    expect(couvre("*.generated.js", "browserXgeneratedYjs"),
      "sans échappement, « . » matcherait n'importe quel caractère et ce nom passerait pour couvert")
      .toBe(false);
  });

  it("l'étoile ne franchit pas une barre oblique", () => {
    expect(couvre("*.generated.js", "server/browser.generated.js"),
      "un motif sans « / » se compare au nom de base").toBe(true);
    expect(couvre("server/*.js", "server/a/b.js")).toBe(false);
    expect(couvre("server/*.js", "server/a.js")).toBe(true);
  });

  it("un motif littéral ne couvre que lui-même", () => {
    expect(couvre("a+b.js", "a+b.js")).toBe(true);
    expect(couvre("a+b.js", "aab.js"), "« + » échappé ne répète pas le « a »").toBe(false);
  });
});
