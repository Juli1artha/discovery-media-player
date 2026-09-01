// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// AUCUN DOCUMENT N'ANNONCE UNE VERSION QUI N'EXISTE PAS, ÉPROUVÉ.
//
// ⚠️ CE QUE CETTE GARDE AURAIT ATTRAPÉ. Le 01/09, dix-huit affirmations au passé, dans quatre
// documents lus par les intégrateurs, portaient sur deux versions jamais publiées. Un hôte a lu
// `docs/RETENTION.md`, a cru l'arrêt d'écriture livré, et sa direction juridique lui a demandé
// d'appliquer des migrations qui n'étaient dans aucun paquet. C'est lui qui l'a mesuré.

import { describe, it, expect } from "vitest";
import { versionsCitees, plusGrand, annoncesEnAvance, documentsParRacine, SUIVIS }
  from "../versions-annoncees.mjs";

describe("les versions qu'un texte annonce", () => {
  it("relève les numéros du produit, avec leur ligne", () => {
    expect(versionsCitees("rien\ndepuis 0.1.140\nni v0.1.99 ni rien"))
      .toEqual([{ version: "0.1.140", ligne: 2 }, { version: "0.1.99", ligne: 3 }]);
  });

  // ⚠️ ET ELLE NE CONFOND PAS AVEC LES VERSIONS DES AUTRES. Les documents citent Node, PostgreSQL
  // et des actions tierces ; les relever ferait une garde qui accuse au hasard, et une garde qui
  // accuse au hasard apprend à être ignorée.
  it("⚠️ ignore les versions qui ne sont pas celles de ce paquet", () => {
    expect(versionsCitees("Node 22.11.0, PostgreSQL 16.13, actions/checkout v4.2.2")).toEqual([]);
    expect(versionsCitees("0.2.3 et 1.1.145 ne sont pas de cette série")).toEqual([]);
  });

  it("compare champ par champ, pas lexicographiquement", () => {
    expect(plusGrand("0.1.146", "0.1.145")).toBe(true);
    expect(plusGrand("0.1.99", "0.1.145"), "99 < 145 : une comparaison de texte dirait l'inverse")
      .toBe(false);
    expect(plusGrand("0.1.145", "0.1.145")).toBe(false);
  });
});

describe("⚠️ la règle : passé ou présent, jamais à venir", () => {
  const lire = (f) => ({ "a.md": "vu en 0.1.140, et encore en 0.1.145", "b.md": "depuis 0.1.146" }[f]);

  it("accepte une version passée ou courante", () => {
    expect(annoncesEnAvance(["a.md"], "0.1.145", lire).soucis).toEqual([]);
  });

  it("⚠️ refuse une version à venir, en nommant le fichier et la ligne", () => {
    const { soucis } = annoncesEnAvance(["b.md"], "0.1.145", lire);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("b.md:1");
    expect(soucis[0], "le message doit dire quoi écrire à la place").toContain("the next release");
  });

  // ⚠️ LA FENÊTRE DE SORTIE SE REFERME D'ELLE-MÊME, et c'est ce qui rend la règle tenable. Pendant
  // la PR de sortie, `package.json` monte dans le même commit que la section du CHANGELOG : les
  // phrases qui parlaient de la nouvelle version deviennent légales à la seconde où elle devient
  // réelle, sans exception à écrire ni à lever ensuite.
  it("⚠️ et la même phrase devient légale quand le dépôt monte la version", () => {
    expect(annoncesEnAvance(["b.md"], "0.1.146", lire).soucis).toEqual([]);
  });

  it("compte ce qu'elle a lu — un zéro ne serait pas une absence d'annonce", () => {
    expect(annoncesEnAvance(["a.md"], "0.1.145", lire).citations).toBe(2);
  });
});

// ⚠️ LE PÉRIMÈTRE, QUE CETTE GARDE A RATÉ À SA PREMIÈRE EXÉCUTION. Un pathspec à double étoile ne
// développe pas comme un shell : `docs` ne rendait AUCUN fichier, les seize documents où l'erreur
// vivait n'étaient pas lus, et le total non nul du CHANGELOG faisait passer le plancher. Une garde
// écrite contre un défaut de périmètre l'a reproduit dans sa propre première ligne.
describe("⚠️ le périmètre couvre chaque racine déclarée", () => {
  it("chaque racine suivie rend au moins un document", () => {
    const par = documentsParRacine();
    for (const racine of SUIVIS) {
      expect(par.get(racine), `« ${racine} » est déclarée suivie`).toBeTruthy();
      expect(par.get(racine).length, `« ${racine} » ne rend aucun document — la sonde vise à côté`)
        .toBeGreaterThan(0);
    }
  });

  it("⚠️ et `docs` en rend plusieurs — c'est la racine qui manquait", () => {
    expect(documentsParRacine(["docs"]).get("docs").length).toBeGreaterThan(5);
  });

  it("ne rend que des markdown", () => {
    for (const f of documentsParRacine().get("docs")) expect(f).toMatch(/\.md$/);
  });
});
