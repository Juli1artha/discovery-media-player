// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CODEOWNERS, ÉPROUVÉ SUR LE VRAI FICHIER ET SUR LES DEUX FAÇONS DE LE VIDER SANS RIEN CASSER.
//
// ⚠️ GitHub accepte une règle qui ne matche rien : la revue obligatoire ne se déclenche jamais et
// le dépôt paraît protégé. C'est un détecteur d'absence, donc sa panne ressemble à son succès —
// d'où le plancher, et deux contrôles positifs qui le font parler avant de le croire.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { regles, designeQuelqueChose, ecarts } from "../codeowners-valide.mjs";

const REEL = readFileSync("CODEOWNERS", "utf8");
const SUIVIS = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

describe("le vrai CODEOWNERS", () => {
  it("porte assez de règles pour que la sonde ait quelque chose à lire", () => {
    expect(regles(REEL).length, "zéro règle lue n'est pas un succès : l'analyse ne reconnaît plus une ligne").toBeGreaterThanOrEqual(5);
  });

  it("n'a aucune règle vide ni sans propriétaire", () => {
    expect(ecarts(REEL, SUIVIS)).toEqual([]);
  });
});

describe("⚠️ CONTRÔLES POSITIFS — elle sait reconnaître les deux façons de ne rien protéger", () => {
  it("un motif qui ne désigne aucun fichier est signalé, et nommé", () => {
    const soucis = ecarts("/zone-qui-nexiste-pas/   @Juli1artha\n", SUIVIS);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("/zone-qui-nexiste-pas/");
  });

  it("une règle sans propriétaire est signalée", () => {
    const soucis = ecarts("/server/\n", SUIVIS);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("aucun propriétaire");
  });

  it("et un motif qui désigne vraiment quelque chose passe", () => {
    expect(designeQuelqueChose("/server/", SUIVIS)).toBe(true);
    expect(designeQuelqueChose("/zone-inventee/", SUIVIS)).toBe(false);
  });
});

// ⚠️ LA BRANCHE À GLOB N'A AUCUN SUJET DANS CE DÉPÔT — le seul motif étoilé du CODEOWNERS est `*`
// nu, traité avant elle. Mesuré le 01/09 : aveugler l'échappement ou la conversion de l'étoile ne
// faisait bouger ni la garde ni ce banc. Un code que rien n'exécute est un code que rien ne
// corrige, et le jour où quelqu'un écrira `/server/*.js` il héritera de ce qu'on n'a pas éprouvé.
describe("⚠️ la conversion d'un motif à glob, que le CODEOWNERS d'aujourd'hui n'exerce pas", () => {
  const fichiers = ["server/a.js", "server/a/b.js", "docs/a.md", "a+b.js", "aab.js"];

  it("l'étoile couvre un segment, jamais une barre oblique", () => {
    expect(designeQuelqueChose("/server/*.js", fichiers)).toBe(true);
    expect(designeQuelqueChose("/server/x*.js", fichiers)).toBe(false);
  });

  it("⚠️ les métacaractères sont échappés — sinon le motif désignerait plus que ce qu'il dit", () => {
    expect(designeQuelqueChose("/a+b.js", fichiers), "un motif sans étoile se compare littéralement").toBe(true);
    // Sans échappement, « a+ » serait « un ou plusieurs a » et ce motif désignerait « aab.js ».
    expect(designeQuelqueChose("/a+*.js", ["aab.js"]), "« + » échappé : « aab.js » n'est pas désigné").toBe(false);
    expect(designeQuelqueChose("/a+*.js", ["a+b.js"]), "et il désigne bien le fichier qui porte le « + »").toBe(true);
  });

  it("un motif étoilé se compare aussi au nom de base — c'est ce que fait git", () => {
    expect(designeQuelqueChose("*.md", fichiers)).toBe(true);
    expect(designeQuelqueChose("*.txt", fichiers)).toBe(false);
  });
});
