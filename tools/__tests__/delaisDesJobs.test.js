// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CHAQUE JOB DE LA CI DÉCLARE SON DÉLAI — SANS QUOI UN BANC BLOQUÉ TIENT LE RUNNER DES HEURES.
//
// ⚠️ MESURÉ LE 04/10, PAS SUPPOSÉ. La montée de jsdom 30.0.1 → 30.1.1 (tirée par #551) rendait le
// banc d'un mutant de la campagne de mutation plus de vingt minutes long au lieu de 46 s ; la CI de
// #551 ne l'a pas montré parce que `npm test` y tombait avant la campagne. Aucun job de `ci.yml` ne
// déclarait `timeout-minutes` : un blocage y aurait couru jusqu'au délai par défaut de GitHub —
// 360 minutes — sans rien dire, en tenant la file de toutes les PR derrière lui.
//
// Le banc ne fixe pas les valeurs : elles sont dans `ci.yml`, à côté des durées mesurées qui les
// justifient. Il exige qu'il y en ait une par job, et qu'elle borne VRAIMENT — une valeur égale ou
// supérieure au défaut de GitHub ne protège de rien et n'aurait que l'apparence d'une borne.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** Le délai que GitHub applique à un job qui n'en déclare aucun (documentation des workflows). */
const DEFAUT_GITHUB_MINUTES = 360;

/** Les jobs d'un document de workflow qui ne bornent pas leur durée, avec la raison. */
const jobsSansDelai = (texte) =>
  Object.entries(parse(texte).jobs || {}).flatMap(([nom, job]) => {
    const d = job && job["timeout-minutes"];
    if (d === undefined) return [`${nom} : aucun timeout-minutes`];
    if (typeof d !== "number" || !(d > 0)) return [`${nom} : timeout-minutes illisible (${JSON.stringify(d)})`];
    if (d >= DEFAUT_GITHUB_MINUTES) return [`${nom} : ${d} min ne borne rien de plus que le défaut de GitHub`];
    return [];
  });

describe("la sonde voit un job sans délai — témoins fabriqués", () => {
  it("un job sans `timeout-minutes` est nommé", () => {
    const doc = "jobs:\n  a:\n    runs-on: x\n    timeout-minutes: 10\n  b:\n    runs-on: x\n";
    expect(jobsSansDelai(doc)).toEqual(["b : aucun timeout-minutes"]);
  });

  it("une valeur au défaut de GitHub n'est pas une borne", () => {
    expect(jobsSansDelai("jobs:\n  a:\n    timeout-minutes: 360\n")).toEqual(["a : 360 min ne borne rien de plus que le défaut de GitHub"]);
  });

  it("une valeur qui n'est pas un nombre est refusée plutôt que crue", () => {
    // Une expression `${{ … }}` se lit comme une chaîne : ce banc ne sait pas l'évaluer, il le dit.
    expect(jobsSansDelai("jobs:\n  a:\n    timeout-minutes: \"${{ inputs.t }}\"\n")).toHaveLength(1);
  });
});

describe("le dépôt lui-même : ci.yml", () => {
  const texte = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

  it("la sonde a un sujet : les jobs de ci.yml sont lus", () => {
    // Plancher sur la population de CE fichier : un document mal lu rendrait zéro job, et zéro job
    // sans délai se lirait comme une conformité.
    expect(Object.keys(parse(texte).jobs).length).toBeGreaterThanOrEqual(5);
  });

  it("⚠️ chaque job de ci.yml déclare un délai qui borne vraiment", () => {
    expect(jobsSansDelai(texte)).toEqual([]);
  });
});
