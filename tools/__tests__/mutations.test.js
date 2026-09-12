// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LA CAMPAGNE DE MUTATIONS REFUSE DE CONCLURE, ET POURQUOI C'EST LA PROPRIÉTÉ QUI COMPTE.
//
// ⚠️ ELLE PEUT MENTIR DE TROIS FAÇONS, ET CHACUNE REND LA CAMPAGNE PLUS VERTE QU'ELLE NE DEVRAIT.
// Une cible absente — le code a bougé, le mutant ne mute rien, et « aucun banc n'a rougi » devient
// un succès. Une cible en double — le verdict ne désigne aucune des deux. Une base déjà rouge — TOUS
// les mutants qui touchent ce banc passent pour tués, donc la campagne est d'autant plus verte que
// le dépôt est cassé. Les trois rendent NON CONCLUANT, jamais « tué ».

import { describe, it, expect } from "vitest";

import { MUTANTS, muter, bornes, empreinte } from "../mutations.mjs";

describe("poser un mutant", () => {
  it("une cible unique est remplacée", () => {
    const { mute, raison } = muter("a\nCIBLE\nb", { avant: "CIBLE", apres: "MUTÉ" });
    expect(raison).toBeUndefined();
    expect(mute).toBe("a\nMUTÉ\nb");
  });

  it("⚠️ une cible ABSENTE ne se tait pas : le code a bougé, le mutant ne mute rien", () => {
    expect(muter("a\nb", { avant: "CIBLE", apres: "X" }).raison).toMatch(/absente/);
  });

  it("⚠️ une cible en DOUBLE ne se tait pas : le verdict ne désignerait aucune des deux", () => {
    expect(muter("CIBLE\nCIBLE", { avant: "CIBLE", apres: "X" }).raison).toMatch(/2 fois/);
  });

  it("⚠️ une mutation qui ne change rien est refusée — sinon tout banc vert la « tue »", () => {
    expect(muter("CIBLE", { avant: "CIBLE", apres: "CIBLE" }).raison).toMatch(/ne change rien/);
  });
});

describe("les bornes du rapport", () => {
  // ⚠️ UNE GRANDEUR BORNÉE QUI SORT DE SES BORNES EST LE SEUL TÉMOIN GRATUIT D'UNE DÉFINITION. Un
  // contrôle positif prouve que l'instrument répond ; il ne prouve pas que le compte a un sens.
  it("un compte cohérent ne dit rien", () => {
    expect(bornes({ poses: 3, tues: 2, survivants: 1, nonConcluants: 0 })).toEqual([]);
  });

  it("⚠️ un total qui ne retombe pas sur ses pieds est relevé", () => {
    expect(bornes({ poses: 3, tues: 1, survivants: 0, nonConcluants: 0 })).toHaveLength(1);
  });

  it("⚠️ plus de tués que de posés est relevé", () => {
    expect(bornes({ poses: 1, tues: 2, survivants: 0, nonConcluants: -1 }).length).toBeGreaterThan(0);
  });

  it("⚠️ un compte négatif est relevé — c'est le défaut qu'un hôte nous a appris", () => {
    expect(bornes({ poses: 0, tues: -1, survivants: 1, nonConcluants: 0 }).some((f) => /négatif/.test(f))).toBe(true);
  });
});

describe("le manifeste", () => {
  it("il n'est pas vide — une campagne sans mutant serait verte sur rien", () => {
    expect(MUTANTS.length).toBeGreaterThanOrEqual(8);
  });

  // ⚠️ CHAQUE MUTANT EST UN DÉFAUT QUI A RÉELLEMENT EXISTÉ, et la raison le dit. Un manifeste de
  // mutants inventés pour faire nombre mesurerait la patience de qui l'a écrit, pas le dépôt.
  it("⚠️ chacun porte une raison, un fichier et au moins un banc", () => {
    for (const m of MUTANTS) {
      expect(String(m.pourquoi).length, m.id).toBeGreaterThan(40);
      expect(m.fichier, m.id).toBeTruthy();
      expect(m.bancs.length, m.id).toBeGreaterThan(0);
      expect(m.avant, m.id).not.toBe(m.apres);
    }
  });

  it("les identifiants sont uniques — deux verdicts sous un même nom n'en font qu'un", () => {
    expect(new Set(MUTANTS.map((m) => m.id)).size).toBe(MUTANTS.length);
  });

  // ⚠️ LE BANC QUI COMPTE : chaque cible existe EXACTEMENT une fois dans son fichier, ici et
  // maintenant. C'est ce qui sépare une campagne qui prouve quelque chose d'une campagne qui passe
  // parce que ses cibles ont disparu. Elle rendrait NON CONCLUANT en s'exécutant — ce banc le dit
  // plus tôt, et sans lancer cent bancs.
  it("⚠️ chaque cible existe EXACTEMENT une fois dans son fichier", async () => {
    const { readFileSync } = await import("node:fs");
    const fautes = [];
    for (const m of MUTANTS) {
      const n = readFileSync(m.fichier, "utf8").split(m.avant).length - 1;
      if (n !== 1) fautes.push(`${m.id} : cible présente ${n} fois dans ${m.fichier}`);
    }
    expect(fautes).toEqual([]);
  });
});

describe("l'empreinte de restauration", () => {
  // ⚠️ ELLE EXISTE PARCE QUE LE TÉMOIN A DÉJÀ POURRI. Une campagne manuelle interrompue a laissé un
  // fichier muté sur disque, et l'exécution suivante l'a copié COMME RÉFÉRENCE : tous les
  // « restauré, identique » d'après comparaient la corruption à elle-même et disaient vrai.
  it("deux textes différents n'ont pas la même empreinte", () => {
    expect(empreinte("a")).not.toBe(empreinte("b"));
    expect(empreinte("a")).toBe(empreinte("a"));
  });
});
