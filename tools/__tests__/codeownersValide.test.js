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
