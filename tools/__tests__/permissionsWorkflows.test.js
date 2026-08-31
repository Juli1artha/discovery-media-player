// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE PERMISSION D'ÉCRITURE À LA RACINE EST UN PRIVILÈGE QUI S'ACCORDE PAR OUBLI.
//
// ⚠️ Cinq des huit workflows étaient dans ce cas (relevé du 22/08). Aucun n'était fautif dans son
// intention — chacun avait un job qui avait vraiment besoin du droit. Ce qu'ils laissaient ouvert,
// c'est le job SUIVANT : celui que personne n'a encore écrit hérite du droit sans le demander, et
// son auteur ne le verra pas.
//
// `release.yml` en a déjà fait la démonstration coûteuse : son job qui exécute un tarball
// téléchargé du registre tournait avec de quoi publier sur npm, précisément parce que les droits
// vivaient à la racine.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ecrituresRacine, ecartsDuFichier, releve, blocsLus } from "../permissions-workflows.mjs";

const AVEC = (bloc) => `name: T\non:\n  push:\n${bloc}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n`;

describe("⚠️ CE QUI COMPTE COMME UNE ÉCRITURE", () => {
  it("n'importe quelle portée en write", () => {
    expect(ecrituresRacine({ contents: "read", "security-events": "write" })).toEqual(["security-events"]);
    expect(ecrituresRacine({ contents: "write", issues: "write" })).toEqual(["contents", "issues"]);
  });

  it("⚠️ `write-all`, qui les accorde toutes d'un mot", () => {
    // Il se lit comme une abréviation anodine et vaut plus que tout ce qu'on écrirait à la main.
    expect(ecrituresRacine("write-all")).toEqual(["write-all (toutes les portées)"]);
  });

  it("`read-all`, `{}` et l'absence de bloc ne donnent rien", () => {
    expect(ecrituresRacine("read-all")).toEqual([]);
    expect(ecrituresRacine({})).toEqual([]);
    expect(ecrituresRacine(undefined)).toEqual([]);
    expect(ecrituresRacine(null)).toEqual([]);
  });

  it("`read` explicite non plus", () => {
    expect(ecrituresRacine({ contents: "read", packages: "read" })).toEqual([]);
  });
});

describe("le verdict par fichier", () => {
  it("refuse une écriture racine, en nommant la portée ET la ligne", () => {
    const soucis = ecartsDuFichier(AVEC("permissions:\n  contents: read\n  packages: write\n"), "w.yml");
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toMatch(/w\.yml:\d+ : « packages » en écriture à la RACINE/);
  });

  it("⚠️ ne dit pas seulement CE QUI cloche, mais QUOI FAIRE", () => {
    // Un refus sans geste se contourne en supprimant la garde plutôt qu'en corrigeant le fichier.
    expect(ecartsDuFichier(AVEC("permissions:\n  issues: write\n"), "w.yml")[0])
      .toMatch(/Déplacez-le sur le job qui s'en sert/);
  });

  it("laisse passer une racine en lecture seule, quel que soit ce que font les jobs", () => {
    const txt = `name: T\non:\n  push:\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      packages: write\n    steps:\n      - run: 'true'\n`;
    expect(ecartsDuFichier(txt, "w.yml")).toEqual([]);
  });

  it("laisse passer un fichier sans bloc permissions", () => {
    expect(ecartsDuFichier(AVEC(""), "w.yml")).toEqual([]);
  });

  it("⚠️ LÈVE sur un document illisible plutôt que de le sauter", () => {
    // Un workflow qu'on n'a pas su lire n'est pas un workflow sans permissions. Sauter en silence
    // est ce qui a coûté trois lecteurs à ce dépôt.
    expect(() => ecartsDuFichier("jobs:\n  a:\n   - x\n  b: [1,\n", "w.yml")).toThrow(/YAML illisible/);
  });
});

describe("⚠️ SUR LES VRAIS WORKFLOWS", () => {
  it("aucun ne porte d'écriture à la racine", () => {
    const { fichiers, soucis } = releve();
    expect(fichiers.length).toBeGreaterThanOrEqual(8);
    expect(soucis).toEqual([]);
  });

  it("⚠️ et les droits n'ont pas DISPARU en chemin — ils sont sur les jobs", () => {
    // La contrepartie qui compte : on pourrait satisfaire la garde en supprimant les permissions
    // au lieu de les déplacer, et casser les workflows sans qu'aucun test ne le dise.
    const attendus = {
      "cla.yml": ["contents: write", "pull-requests: write", "issues: write"],
      "codeql.yml": ["security-events: write"],
      "image.yml": ["packages: write", "attestations: write"],
      "image-reconcile.yml": ["packages: write"],
      "publication.yml": ["issues: write"],
      "release.yml": ["id-token: write", "contents: write"],
    };
    for (const [fichier, droits] of Object.entries(attendus)) {
      const txt = readFileSync(`.github/workflows/${fichier}`, "utf8");
      for (const droit of droits) expect(txt, `${fichier} → ${droit}`).toContain(droit);
    }
  });
});


// ⚠️ LE TÉMOIN DE LA RÈGLE — ET IL EST DISTINCT DE CELUI DU PÉRIMÈTRE.
//
// Cette garde affirme une ABSENCE sur neuf fichiers. Sa panne la plus probable — un lecteur qui ne
// reconnaît plus la forme d'un bloc — produit elle aussi une absence : neuf workflows verts sans
// rien avoir mesuré. Le plancher qui existait compte les FICHIERS LUS, jamais la FORME RECONNUE, et
// ne peut donc pas les distinguer.
//
// Mesuré le 31/08 en aveuglant la sonde : l'outil imprimait « 9 workflows, aucune écriture à la
// racine » et sortait 0. Ces bancs-ci rougissaient déjà — la RÈGLE était donc protégée. C'est le
// VERDICT IMPRIMÉ qui ne l'était pas, et c'est lui qui va dans le journal de la forge.
describe("le témoin de la règle : la sonde reconnaît-elle encore la forme ?", () => {
  it("compte un bloc « permissions: » à la racine", () => {
    expect(blocsLus("permissions:\n  contents: read\njobs:\n  a:\n    steps: []\n", "w.yml")).toBe(1);
  });

  it("n'en compte aucun quand il n'y en a pas — et ce n'est pas une faute", () => {
    expect(blocsLus("jobs:\n  a:\n    steps: []\n", "w.yml")).toBe(0);
  });

  // ⚠️ UN BLOC SUR UN JOB N'EST PAS UN BLOC À LA RACINE. Le compter gonflerait le témoin sans que
  // la sonde de la RÈGLE — qui ne juge que la racine — ait rien reconnu.
  it("⚠️ ne compte pas un bloc porté par un job : ce n'est pas la forme que la règle juge", () => {
    expect(blocsLus("jobs:\n  a:\n    permissions:\n      contents: read\n    steps: []\n", "w.yml")).toBe(0);
  });

  it("⚠️ le dépôt réel en porte, sinon le vert de cette garde ne prouverait rien", () => {
    const { fichiers, blocs } = releve();
    expect(fichiers.length, "aucun workflow lu : la sonde vise à côté").toBeGreaterThan(5);
    expect(blocs, "zéro bloc reconnu : ce n'est pas une absence d'écriture, c'est une sonde aveugle").toBeGreaterThan(0);
  });
});
