// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ÉPROUVETTE CONSOMMATEUR NE DÉRIVE PAS EN SILENCE.
//
// ⚠️ `tools/fixture-conso/` est le SEUL lockfile du dépôt que Dependabot ne surveille pas (il ne
// regarde que la racine et .zap/). Sans confrontation, le jour où pdfjs-dist ou typescript bouge
// à la racine, les bancs consommateur et types continueraient d'éprouver les ANCIENNES versions —
// verts, et faux. C'est la règle du dépôt appliquée à son propre outillage : un fait n'existe
// jamais en deux copies non confrontées, et ici les copies sont (racine) et (éprouvette).
//
// ⚠️ ET L'ÉPREUVE VÉRIFIE AUSSI CE QUE LA FIXTURE ACHÈTE : chaque paquet de son lockfile porte
// une empreinte sha512. C'était tout l'objet du passage à `npm ci` (les dépendances du
// consommateur arrivaient du registre sans empreinte — relevé par Scorecard) ; un lockfile
// régénéré un jour sans empreintes rétablirait le trou en gardant le geste.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lireJson = (p) => JSON.parse(readFileSync(join(RACINE, p), "utf8"));

const REGENERER = "cd tools/fixture-conso && npm install --package-lock-only --ignore-scripts";

describe("fixture-conso : une seule version du fait, et elle est hachée", () => {
  const racine = lireJson("package.json");
  const verrouRacine = lireJson("package-lock.json");
  const fixture = lireJson("tools/fixture-conso/package.json");
  const verrouFixture = lireJson("tools/fixture-conso/package-lock.json");

  it("la dépendance de prod de l'éprouvette est CELLE de la racine", () => {
    expect(fixture.dependencies["pdfjs-dist"],
      `l'éprouvette éprouve une autre pdfjs-dist que celle que le paquet livre — alignez tools/fixture-conso/package.json puis « ${REGENERER} »`)
      .toBe(racine.dependencies["pdfjs-dist"]);
  });

  it("le compilateur de l'éprouvette est CELUI du lockfile racine — l'incident du 22/08 ne revient pas", () => {
    // Le banc des types avait éprouvé typescript 7.0.2 un matin où le dépôt vérifiait en 5.9.3 :
    // la version vivait dans un `npm i typescript` sans épingle. Elle vit désormais ici, et DOIT
    // suivre celle qui fait foi.
    expect(fixture.dependencies.typescript,
      `le banc des types compilerait avec un autre typescript que le dépôt — alignez tools/fixture-conso/package.json puis « ${REGENERER} »`)
      .toBe(verrouRacine.packages["node_modules/typescript"].version);
  });

  it("le lockfile de l'éprouvette verrouille exactement ce que son package.json déclare", () => {
    for (const [nom, version] of Object.entries(fixture.dependencies)) {
      const verrouille = verrouFixture.packages[`node_modules/${nom}`];
      expect(verrouille, `${nom} déclaré mais absent du lockfile — « ${REGENERER} »`).toBeTruthy();
      expect(verrouille.version, `${nom} : déclaré ${version}, verrouillé ${verrouille && verrouille.version} — « ${REGENERER} »`).toBe(version);
    }
  });

  it("chaque paquet verrouillé porte son empreinte sha512 — c'est ce que l'éprouvette achète", () => {
    const sans = Object.entries(verrouFixture.packages)
      .filter(([chemin]) => chemin !== "")
      .filter(([, p]) => !p.link && !/^sha512-/.test(String(p.integrity || "")))
      .map(([chemin]) => chemin);
    expect(sans, "des paquets de l'éprouvette n'ont pas d'empreinte : le lockfile a été régénéré d'une façon qui rétablit le trou").toEqual([]);
  });
});
