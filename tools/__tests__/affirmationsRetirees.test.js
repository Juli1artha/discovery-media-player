// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LA GARDE DES AFFIRMATIONS RETIRÉES SAIT VOIR, ET CE QU'ELLE NE PRÉTEND PAS SAVOIR.
//
// ⚠️ ELLE NE CONFRONTE PAS UNE PHRASE À CE QU'ELLE DÉCRIT. AGENTS.md dit qu'aucune garde ici ne sait
// faire ça, et ça reste vrai : le fait qu'une migration existe ne dit à aucun programme quel
// paragraphe ment. Ce qui est mécanisable, c'est la sous-classe où NOUS AVONS DÉJÀ DÉCIDÉ qu'une
// affirmation est retirée — la garde confronte le dépôt à cette décision, pas à la réalité. C'est
// beaucoup moins, et c'est exactement ce qui a échoué quatre fois en deux jours.

import { describe, it, expect } from "vitest";

import { RETIREES, MARQUEURS, REGARD_ARRIERE, nonMarquees, estArchive, estLaGardeElleMeme, fichiersDe } from "../affirmations-retirees.mjs";

const UNE = [{ nom: "essai", motif: /le ciel est vert/i, pourquoi: "x".repeat(40), retiree: "2026-01-01" }];

describe("relever une affirmation retirée", () => {
  it("une affirmation nue est relevée, avec sa ligne", () => {
    const f = nonMarquees("a\nle ciel est vert\nb", UNE);
    expect(f).toHaveLength(1);
    expect(f[0].ligne).toBe(2);
  });

  it("la même phrase MARQUÉE sur sa ligne passe", () => {
    expect(nonMarquees("ce paragraphe disait que le ciel est vert", UNE)).toEqual([]);
  });

  // ⚠️ UNE CITATION S'ENROULE. Exiger le marqueur sur la ligne EXACTE forcerait un formatage tordu
  // et apprendrait à glisser un mot-marqueur par réflexe — une garde qu'on satisfait par un tic ne
  // garde plus rien.
  it("⚠️ le marqueur vaut sur les deux lignes PRÉCÉDENTES", () => {
    expect(nonMarquees("ce paragraphe disait\nque\nle ciel est vert", UNE)).toEqual([]);
    expect(nonMarquees("ce paragraphe disait\nune\nautre\nchose, le ciel est vert", UNE), "trois lignes : trop loin")
      .toHaveLength(1);
  });

  // ⚠️ ON REGARDE EN ARRIÈRE SEULEMENT. Une rétractation qui SUIT ne protège pas : un lecteur qui
  // abandonne à la phrase fausse ne lira jamais la correction. Ce dépôt a déjà écrit la règle de
  // distance — « très loin, on ne fait pas le lien ; très près, on croit qu'il a déjà été fait ».
  it("⚠️ un marqueur APRÈS l'affirmation ne la protège pas", () => {
    expect(nonMarquees("le ciel est vert\nce paragraphe disait n'importe quoi", UNE)).toHaveLength(1);
  });

  it("plusieurs affirmations sur une même ligne sont toutes relevées", () => {
    const deux = [...UNE, { nom: "b", motif: /la mer est rouge/i, pourquoi: "y".repeat(40), retiree: "2026-01-01" }];
    expect(nonMarquees("le ciel est vert et la mer est rouge", deux)).toHaveLength(2);
  });
});

describe("le périmètre", () => {
  // ⚠️ LES ARCHIVES SONT EXCLUES, ET C'EST LA SEULE EXCLUSION. Un CHANGELOG et un rapport d'audit
  // SONT des récits datés : ils citent ce qui était vrai à leur date. Les réécrire falsifierait
  // l'histoire qu'ils portent — et c'est cette histoire qui permet à un hôte de comprendre ce qu'il
  // a cru.
  it("⚠️ le CHANGELOG et les rapports d'audit sont hors périmètre", () => {
    expect(estArchive("CHANGELOG.md")).toBe(true);
    expect(estArchive("docs/AUDIT-2026-08-15-SECONDE-PASSE.md")).toBe(true);
    expect(estArchive("docs/HOST-CONTRACT.md")).toBe(false);
    expect(estArchive("SECURITY.md")).toBe(false);
  });

  it("la garde et son banc s'excluent eux-mêmes — ils DÉFINISSENT les motifs", () => {
    expect(estLaGardeElleMeme("tools/affirmations-retirees.mjs")).toBe(true);
    expect(estLaGardeElleMeme("tools/__tests__/affirmationsRetirees.test.js")).toBe(true);
    expect(estLaGardeElleMeme("tools/changelog.mjs")).toBe(false);
  });

  it("la sonde trouve réellement des fichiers dans ce dépôt", () => {
    const f = fichiersDe(".", ["docs", "server"]);
    expect(f.length, "une sonde qui ne lit rien conclurait vert sur rien").toBeGreaterThan(50);
    expect(f.some((x) => x.startsWith("docs/"))).toBe(true);
    expect(f.includes("CHANGELOG.md")).toBe(false);
  });
});

describe("les entrées elles-mêmes", () => {
  // ⚠️ UNE ENTRÉE SANS RAISON EST UNE EXEMPTION MUETTE. La différence tient tout entière là : une
  // exemption dit « ceci est en ordre » ; une entrée datée et motivée dit « ceci a cessé d'être vrai
  // tel jour, voici pourquoi ». Les deux laissent passer une relecture, une seule l'explique.
  it("⚠️ chaque affirmation retirée porte une raison et une date", () => {
    for (const r of RETIREES) {
      expect(String(r.pourquoi).length, r.nom).toBeGreaterThan(30);
      expect(r.retiree, r.nom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.motif.test("")).toBe(false);
    }
  });

  it("le vocabulaire des marqueurs reste PAUVRE — une liste riche rendrait la garde verte sur tout", () => {
    expect(MARQUEURS.length).toBeLessThan(30);
    expect(MARQUEURS.some((m) => m.test("une phrase ordinaire sans rétractation")), "aucun marqueur ne doit matcher une phrase neutre")
      .toBe(false);
  });

  it("le regard en arrière est court", () => {
    expect(REGARD_ARRIERE).toBeLessThanOrEqual(3);
  });
});

// ⚠️ LE DÉPÔT LUI-MÊME, PARCE QUE C'EST LA PROPRIÉTÉ QUI COMPTE — et parce qu'elle a été fausse
// quatre fois. Le premier passage de cette garde a trouvé une occurrence que DEUX audits humains
// avaient manquée : l'en-tête d'un banc, quatrième copie d'une phrase corrigée trois fois ailleurs.
describe("⚠️ le dépôt lui-même", () => {
  it("aucune affirmation retirée n'est écrite comme vraie", async () => {
    const { readFileSync } = await import("node:fs");
    const fautes = [];
    for (const f of fichiersDe(".", ["server", "context", "src", "docs", "tools", "supabase", "base", "charge", "bin", "build"])) {
      let t;
      try { t = readFileSync(f, "utf8"); } catch { continue; }
      for (const x of nonMarquees(t)) fautes.push(`${f}:${x.ligne} — ${x.nom}`);
    }
    expect(fautes).toEqual([]);
  });
});
