// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PLANCHER DÉCLARÉ CONTRE LE PLANCHER RÉEL — ÉPROUVÉ SUR LE CAS QUI A EXISTÉ.
//
// ⚠️ LE DÉFAUT D'ORIGINE EST REJOUÉ TEL QUEL : `engines: ">=22"` face à `pdfjs-dist@6.2.108` qui
// exige `>=22.13.0 || >=24`. Une garde qu'on n'éprouve que sur des cas inventés est verte sur le
// jour où elle a été écrite ; celle-ci doit rougir sur le 25/08.
//
// ⚠️ ET SUR LE VRAI VERROU, PAS SEULEMENT SUR DES FIXTURES. Un banc qui ne lit que ses propres
// objets prouve que la fonction sait compter, jamais que le dépôt est conforme. Le dernier bloc
// lit `package-lock.json` — s'il porte un jour une dépendance de production plus exigeante que
// `engines`, c'est ici que ça se voit, sans attendre qu'un auto-hébergeur le découvre.

import { readFileSync } from "node:fs";

import semver from "semver";

import { PROMIS } from "../documents-publies.mjs";

import { describe, it, expect } from "vitest";

import {
  exigencesDu,
  tropLarges,
  plancherProuve,
  plancherEcritDans,
  OU_EST_ECRIT_LE_PLANCHER_DEV,
  OU_EST_ECRIT_LE_PLANCHER_PROD,
} from "../plancher-de-node.mjs";

/** Un verrou minimal : l'entrée `""` est le paquet lui-même, comme npm l'écrit. */
const verrou = (entrees) => ({
  packages: { "": { name: "x", engines: { node: ">=22" } }, ...entrees },
});

describe("ce que la sonde lit dans le verrou", () => {
  it("⚠️ ignore l'entrée du paquet lui-même — sinon la garde se compare à elle-même", () => {
    const { exigences } = exigencesDu(verrou({}), { production: true });
    expect(exigences).toEqual([]);
  });

  it("sépare la production du développement sur le drapeau `dev`", () => {
    const v = verrou({
      "node_modules/moteur": { engines: { node: ">=22.13.0" } },
      "node_modules/banc": { dev: true, engines: { node: ">=24" } },
    });
    expect(exigencesDu(v, { production: true }).exigences.map((e) => e.chemin)).toEqual(["node_modules/moteur"]);
    expect(exigencesDu(v, { production: false }).exigences.map((e) => e.chemin)).toEqual([
      "node_modules/moteur",
      "node_modules/banc",
    ]);
  });

  it("saute sans bruit ce qui ne déclare aucun engines.node", () => {
    const { exigences, illisibles } = exigencesDu(verrou({ "node_modules/muet": {} }), { production: true });
    expect(exigences).toEqual([]);
    expect(illisibles).toEqual([]);
  });

  it("⚠️ SIGNALE ce qu'il ne sait pas lire au lieu de l'ignorer — une portée sautée en silence fait un vert non mérité", () => {
    const { illisibles } = exigencesDu(verrou({ "node_modules/bizarre": { engines: { node: ["22", "24"] } } }), {
      production: true,
    });
    expect(illisibles).toHaveLength(1);
    expect(illisibles[0]).toContain("node_modules/bizarre");
  });
});

describe("une déclaration plus permissive que ses dépendances", () => {
  it("⚠️ REJOUE LE 25/08 : engines >=22 contre pdfjs-dist >=22.13.0 || >=24", () => {
    const constats = tropLarges(">=22", [
      { chemin: "node_modules/pdfjs-dist", portee: ">=22.13.0 || >=24" },
    ]);
    expect(constats).toHaveLength(1);
    expect(constats[0]).toContain("pdfjs-dist");
    // Le témoin est ce qui rend le constat vérifiable en une commande.
    expect(constats[0]).toContain("node 22.0.0");
  });

  it("se tait dès que la déclaration est resserrée au plancher réel — le correctif de la même journée", () => {
    expect(tropLarges(">=22.13.0", [{ chemin: "node_modules/pdfjs-dist", portee: ">=22.13.0 || >=24" }])).toEqual([]);
  });

  it("accepte une dépendance plus permissive que nous", () => {
    expect(tropLarges(">=22.13.0", [{ chemin: "node_modules/canvas", portee: ">= 10" }])).toEqual([]);
  });

  it("nomme chaque dépendance fautive, pas seulement la première", () => {
    const constats = tropLarges(">=22", [
      { chemin: "node_modules/a", portee: ">=22.13.0" },
      { chemin: "node_modules/b", portee: ">=24" },
      { chemin: "node_modules/c", portee: ">=20" },
    ]);
    expect(constats).toHaveLength(2);
    expect(constats.join("\n")).toContain("node_modules/a");
    expect(constats.join("\n")).toContain("node_modules/b");
  });

  it("⚠️ raisonne sur l'INTERVALLE, pas sur son minimum : >=22.13.0 admet 23, que ^22 || >=24 refuse", () => {
    expect(tropLarges(">=22.13.0", [{ chemin: "node_modules/d", portee: "^22.13.0 || >=24" }])).toHaveLength(1);
  });
});

describe("le plancher qu'on prouve", () => {
  it("rend la plus haute des exigences quand toutes l'acceptent", () => {
    const plancher = plancherProuve([
      { chemin: "a", portee: ">=22.13.0" },
      { chemin: "b", portee: ">=22.22.2" },
      { chemin: "c", portee: ">= 10" },
    ]);
    expect(plancher.version).toBe("22.22.2");
    expect(plancher.du).toBe("b");
  });

  it("⚠️ REND null SUR DES INTERVALLES DISJOINTS au lieu d'un nombre non éprouvé — le candidat est vérifié, pas supposé", () => {
    // 24.15.0 est le plus haut minimum, et `^22.22.2` ne l'accepte pas : aucune version commune.
    expect(plancherProuve([{ chemin: "a", portee: "^22.22.2" }, { chemin: "b", portee: "^24.15.0" }])).toBeNull();
  });

  it("rend null sur une liste vide — il n'y a rien à prouver", () => {
    expect(plancherProuve([])).toBeNull();
  });
});

describe("le plancher écrit dans le document", () => {
  it("le reconnaît quand il y est", () => {
    expect(plancherEcritDans("**Node ≥ 22.22.2** — or ≥ 24.15.0.", "22.22.2")).toBe(true);
  });

  it("le reconnaît en fin de ligne et en début de texte", () => {
    expect(plancherEcritDans("22.22.2", "22.22.2")).toBe(true);
    expect(plancherEcritDans("floor: 22.22.2", "22.22.2")).toBe(true);
  });

  it("⚠️ REFUSE UNE SOUS-CHAÎNE : « 22.2.2 » vit dans « 22.22.2 », et bénir ça écrirait un plancher PLUS BAS que le vrai", () => {
    expect(plancherEcritDans("Node ≥ 22.22.2", "22.2.2")).toBe(false);
  });

  it("refuse un numéro plus long qui contient le nôtre", () => {
    expect(plancherEcritDans("Node ≥ 122.22.29", "22.22.2")).toBe(false);
  });

  it("refuse un document qui ne le dit pas du tout", () => {
    expect(plancherEcritDans("Node ≥ 22.", "22.22.2")).toBe(false);
  });

  it("⚠️ CHERCHE UNE SOUS-CHAÎNE LITTÉRALE, PAS UN MOTIF — refusé par CodeQL sur la PR qui l'a introduite", () => {
    // La première écriture construisait une expression régulière en échappant le point, et rien
    // d'autre. `\d` y aurait été une classe de chiffres au lieu de deux caractères.
    expect(plancherEcritDans("plancher 22\\d2 ici", "22\\d2")).toBe(true);
    expect(plancherEcritDans("plancher 2242 ici", "22\\d2")).toBe(false);
  });

  it("trouve une occurrence bornée même quand une occurrence collée la précède", () => {
    expect(plancherEcritDans("122.22.2 puis 22.22.2", "22.22.2")).toBe(true);
  });
});

describe("le dépôt tel qu'il est", () => {
  const paquet = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

  it("aucune dépendance de production n'exige plus que ce que engines déclare", () => {
    const { exigences, illisibles } = exigencesDu(lock, { production: true });
    expect(illisibles).toEqual([]);
    expect(exigences.length).toBeGreaterThan(0);
    expect(tropLarges(paquet.engines.node, exigences)).toEqual([]);
  });

  it("⚠️ le plancher de production est écrit dans le SEUL document où un hôte puisse le lire hors ligne", () => {
    // `engines` est machine-lisible et npm ne fait qu'AVERTIR en dessous. Le badge du README qui
    // l'affichait est une image distante : invisible dans `node_modules`, là où l'hôte lit.
    const plancher = semver.minVersion(paquet.engines.node).version;
    expect(plancherEcritDans(readFileSync(OU_EST_ECRIT_LE_PLANCHER_PROD, "utf8"), plancher)).toBe(true);
  });

  it("⚠️ et ce document VOYAGE — un plancher écrit dans un fichier que le tarball laisse ne sert à personne", () => {
    // Pas une heuristique sur `files` : la liste de ce qui part est déjà décidée et gardée
    // ailleurs, avec la raison de chaque entrée. On interroge CETTE liste, pas une seconde copie.
    expect(Object.keys(PROMIS)).toContain(OU_EST_ECRIT_LE_PLANCHER_PROD);
  });

  it("⚠️ le plancher de développement mesuré est écrit dans le document que lit un contributeur", () => {
    const { exigences } = exigencesDu(lock, { production: false });
    const plancher = plancherProuve(exigences);
    expect(plancher).not.toBeNull();
    expect(readFileSync(OU_EST_ECRIT_LE_PLANCHER_DEV, "utf8")).toContain(plancher.version);
  });
});
