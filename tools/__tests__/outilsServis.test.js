// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN OUTIL LANCÉ PAR UN WORKFLOW A CE DONT IL A BESOIN POUR TOURNER.
//
// ⚠️ Le garde horaire `publication.yml` ne fait qu'un `checkout`. Quand `exemples-epingles.mjs` a
// gagné une dépendance à `semver` (0.1.137), sa dernière étape s'est mise à jeter
// ERR_MODULE_NOT_FOUND avant d'avoir rien mesuré — pendant dix-neuf heures, sur un workflow
// PLANIFIÉ dont personne n'ouvre la page. L'issue qu'elle entretient est restée figée sur son
// dernier état vrai : elle annonçait 0.1.128 pendant que le registre servait 0.1.138.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { outilsLances, nonServis, paquetsRequis, estPaquet, INSTALLATION, PLANCHER_DEPENDANTS } from "../outils-servis.mjs";

const wf = (corps) => `name: T\non: push\njobs:\n${corps}`;
const etape = (run) => `      - run: ${run}\n`;

describe("relever ce qu'un job lance", () => {
  it("trouve un `node tools/…` et dit si le job installe", () => {
    const t = wf("  j:\n    steps:\n" + etape("npm ci") + etape("node tools/x.mjs"));
    expect(outilsLances("ci.yml", t)).toEqual([{ fichier: "ci.yml", job: "j", outil: "tools/x.mjs", installe: true }]);
  });

  it("voit l'absence d'installation", () => {
    const t = wf("  j:\n    steps:\n" + etape("node tools/x.mjs"));
    expect(outilsLances("p.yml", t)[0].installe).toBe(false);
  });

  it("⚠️ l'installation vaut pour le JOB, pas pour l'étape — elle vit dans une étape à part", () => {
    const t = wf("  j:\n    steps:\n" + etape("node tools/x.mjs") + etape("npm ci"));
    expect(outilsLances("ci.yml", t)[0].installe, "l'ordre des étapes n'est pas la question ici").toBe(true);
  });

  it("n'invente rien sur un job sans `run:`", () => {
    expect(outilsLances("t.yml", wf("  j:\n    steps:\n      - uses: actions/checkout@abc\n"))).toEqual([]);
  });
});

describe("suivre la dépendance à travers les imports", () => {
  // ⚠️ LE CŒUR DU DÉFAUT. `exemples-en-retard` n'importe PAS `semver` : il importe
  // `exemples-epingles`, qui l'importe. Une sonde qui ne lirait que le fichier nommé par la
  // commande aurait rendu vert sur le défaut exact qu'elle vient chercher.
  const faux = {
    "/d/direct.mjs": 'import { parse } from "yaml";\n',
    "/d/indirect.mjs": 'import { x } from "./profond.mjs";\n',
    "/d/profond.mjs": 'import semver from "semver";\nimport { readFileSync } from "node:fs";\n',
    "/d/autonome.mjs": 'import { readFileSync } from "node:fs";\nimport { y } from "./voisin.mjs";\n',
    "/d/voisin.mjs": 'import { join } from "node:path";\n',
    "/d/boucle.mjs": 'import { z } from "./boucle.mjs";\nimport semver from "semver";\n',
  };
  const lire = (f) => { if (!(f in faux)) throw new Error("absent"); return faux[f]; };

  it("un paquet importé en direct", () => {
    expect(paquetsRequis("/d/direct.mjs", lire)).toEqual(["yaml"]);
  });

  it("⚠️ un paquet importé PAR UN IMPORT — le cas de `semver` via `exemples-epingles`", () => {
    expect(paquetsRequis("/d/indirect.mjs", lire)).toEqual(["semver"]);
  });

  it("un outil qui ne dépend que de Node n'a besoin de rien", () => {
    expect(paquetsRequis("/d/autonome.mjs", lire)).toEqual([]);
  });

  it("un import circulaire ne fait pas tourner la sonde en rond", () => {
    expect(paquetsRequis("/d/boucle.mjs", lire)).toEqual(["semver"]);
  });

  it("un fichier illisible ne fait pas jeter la garde — elle rendrait rouge pour la mauvaise raison", () => {
    expect(paquetsRequis("/d/absent.mjs", lire)).toEqual([]);
  });

  it("distingue un paquet d'un chemin et d'un module Node", () => {
    expect([estPaquet("semver"), estPaquet("./x.mjs"), estPaquet("node:fs")]).toEqual([true, false, false]);
  });
});

describe("le verdict", () => {
  const lire = (f) => (f.endsWith("dependant.mjs") ? 'import semver from "semver";' : 'import { readFileSync } from "node:fs";');

  it("⚠️ refuse un outil dépendant lancé sans installation, et dit ce qui se passera", () => {
    const [souci] = nonServis([{ fichier: "publication.yml", job: "ecart", outil: "tools/dependant.mjs", installe: false }], lire);
    expect(souci).toContain("semver");
    expect(souci).toContain("ERR_MODULE_NOT_FOUND");
    expect(souci, "le message doit dire pourquoi ce rouge-là ne se voit pas").toContain("n'est lu par personne");
  });

  it("se tait quand le job installe", () => {
    expect(nonServis([{ fichier: "ci.yml", job: "check", outil: "tools/dependant.mjs", installe: true }], lire)).toEqual([]);
  });

  it("⚠️ se tait sur un outil AUTONOME sans installation — c'est légitime, et l'accuser serait un faux positif", () => {
    expect(nonServis([{ fichier: "image.yml", job: "image", outil: "tools/autonome.mjs", installe: false }], lire)).toEqual([]);
  });
});

describe("les workflows réels du dépôt", () => {
  const dossier = ".github/workflows";
  const fichiers = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).sort();
  const lances = fichiers.flatMap((f) => outilsLances(f, readFileSync(join(dossier, f), "utf8")));

  it("la sonde lit un dossier peuplé", () => {
    // Sans ce plancher, un renommage rendrait la garde verte en n'analysant rien.
    expect(fichiers.length).toBeGreaterThan(5);
    expect(lances.length).toBeGreaterThan(20);
  });

  it("⚠️ chaque outil lancé a ce qu'il lui faut", () => {
    const soucis = nonServis(lances);
    expect(soucis, soucis.join("\n")).toEqual([]);
  });

  it("⚠️ et le défaut réel EST attrapé par la règle", () => {
    // L'état exact d'hier : `publication.yml` lançait `exemples-en-retard` sans `npm ci`, et cet
    // outil dépend de `semver` par `exemples-epingles`. Le chemin est réel, pas une fixture.
    expect(paquetsRequis("tools/exemples-en-retard.mjs")).toContain("semver");
    const avant = [{ fichier: "publication.yml", job: "ecart", outil: "tools/exemples-en-retard.mjs", installe: false }];
    expect(nonServis(avant)).toHaveLength(1);
  });

  it("le garde horaire installe bien, désormais", () => {
    const p = readFileSync(resolve(dossier, "publication.yml"), "utf8");
    expect(p, `sans \`${INSTALLATION}\`, sa dernière étape meurt en silence`).toContain(INSTALLATION);
  });
});

// ⚠️ LE PLANCHER SUR CE QUE LA LECTURE DES `import` RECONNAÎT. Mesuré le 01/09 en aveuglant le
// lecteur : `paquetsRequis` rend la liste vide pour TOUS les outils, `nonServis` n'a plus rien à
// dire, et la garde sort VERTE en annonçant que chacun « n'a besoin d'aucune » installation. Le
// résumé PORTAIT le signal — le compte des outils nus passait de 4 à 35 — mais rien ne l'affirmait.
describe("⚠️ la lecture des « import » reconnaît une population, pas un cas isolé", () => {
  it(`au moins ${PLANCHER_DEPENDANTS} outils lancés dépendent d'un paquet`, () => {
    const dossier = ".github/workflows";
    const lances = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => outilsLances(f, readFileSync(join(dossier, f), "utf8")));
    const lire = (f) => readFileSync(f, "utf8");
    const dependants = new Set(lances.map((l) => l.outil).filter((o) => paquetsRequis(o, lire).length)).size;
    expect(dependants, "17 le 01/09 — si ce compte s'effondre, la sonde ne lit plus les « import »")
      .toBeGreaterThanOrEqual(PLANCHER_DEPENDANTS);
  });
});
