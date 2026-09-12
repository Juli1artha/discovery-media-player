// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LA GARDE DE L'ORDRE DES BANCS SAIT LIRE, ET CE QU'ELLE REFUSE DE CONCLURE.
//
// ⚠️ PAS DE BANC « LE DÉPÔT LUI-MÊME » ICI, ET C'EST UNE CONTRAINTE, PAS UN CHOIX DE CONFORT. Cette
// garde LANCE la suite ; l'appeler depuis la suite l'imbriquerait dans elle-même — elle refuse donc
// de tourner quand `VITEST` est posé, et c'est ÉPROUVÉ ci-dessous. La propriété « le dépôt passe ses
// essais mélangés » est donc gardée par une étape de forge dédiée, pas par un banc. Écrit ici pour
// que personne ne conclue de l'absence que la propriété n'est pas gardée.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { ORDRE_DECLARE, confronter, fichiersEnEchec, fichiersVus, grainePourJour } from "../ordre-des-bancs.mjs";

const SORTIE = `
 RUN  v4.1.11 /home/user/x

 FAIL  server/__tests__/a.test.js > bloc > essai
 FAIL  charge/b.test.js > autre
 Test Files  2 failed | 214 passed (216)
      Tests  3 failed | 2827 passed (2830)
`;

describe("lire la sortie de vitest", () => {
  it("relève les fichiers en échec, sans doublon", () => {
    expect(fichiersEnEchec(SORTIE).sort()).toEqual(["charge/b.test.js", "server/__tests__/a.test.js"]);
  });

  it("un même fichier cité par plusieurs essais ne compte qu'une fois", () => {
    const deux = SORTIE + "\n FAIL  charge/b.test.js > encore un autre\n";
    expect(fichiersEnEchec(deux).filter((f) => f === "charge/b.test.js")).toHaveLength(1);
  });

  it("relève le nombre de fichiers de bancs VUS — c'est l'objet de la sonde", () => {
    expect(fichiersVus(SORTIE)).toBe(216);
  });

  // ⚠️ LE CAS QUI COMPTE : une sortie qui ne dit RIEN. Sans ce retour `null`, la garde conclurait
  // « aucun échec, donc vert » sur une sortie qu'elle n'a pas comprise — victoire sur rien.
  it("⚠️ une sortie illisible ne rend pas zéro, elle rend `null`", () => {
    expect(fichiersVus("vitest a explosé")).toBe(null);
    expect(fichiersVus("")).toBe(null);
  });
});

describe("confronter les rouges aux déclarations", () => {
  it("un fichier non déclaré qui passe seul est une violation", () => {
    const { constats, avertissements } = confronter(["server/__tests__/x.test.js"], []);
    expect(constats).toHaveLength(1);
    expect(constats[0]).toMatch(/dépend de son rang/);
    expect(avertissements).toHaveLength(0);
  });

  // ⚠️ UN ORDRE DÉCLARÉ N'EST PAS UNE EXEMPTION MUETTE : il est NOMMÉ à chaque exécution, avec sa
  // raison. Une exemption dit « ceci est en ordre » ; une déclaration dit « ceci dépend de son rang,
  // voici pourquoi c'est un contrat ». Les deux laissent passer, une seule le dit.
  it("un fichier déclaré passe, mais se fait nommer avec sa raison", () => {
    const [fichier, raison] = [...ORDRE_DECLARE][0];
    const { constats, avertissements } = confronter([fichier], []);
    expect(constats).toHaveLength(0);
    expect(avertissements[0]).toContain(fichier);
    expect(avertissements[0]).toContain(raison);
  });

  // ⚠️ LE CONTRÔLE DE STIMULUS, ET IL EST NÉ D'UN REFUS. La première écriture accusait tout fichier
  // rouge sous mélange ; `planchersDesGardes` l'a refusée — son éprouvette copie `tools/` en entier
  // dans un arbre VIDE, donc vitest y trouve des bancs qui échouent faute de dépôt, et la garde les
  // déclarait dépendants de leur rang. Un rouge qui existe DÉJÀ sans mélange ne dit rien sur l'ordre.
  it("⚠️ un rouge qui préexiste rend NON CONCLUANT, il n'accuse pas l'ordre", () => {
    const { constats, raisonsNonConcluance } = confronter([], ["server/__tests__/y.test.js"]);
    expect(constats).toHaveLength(0);
    expect(raisonsNonConcluance).toHaveLength(1);
    expect(raisonsNonConcluance[0]).toMatch(/échoue AUSSI dans l'ordre normal/);
  });

  it("chaque déclaration porte une raison non vide — une entrée muette serait une exemption", () => {
    for (const [fichier, raison] of ORDRE_DECLARE) {
      expect(String(raison).length, `${fichier} est déclaré sans raison`).toBeGreaterThan(30);
    }
  });
});

describe("la graine", () => {
  it("est le jour UTC, donc stable sur une journée et rejouable", () => {
    expect(grainePourJour(new Date(Date.UTC(2026, 8, 11)))).toBe(20260911);
    expect(grainePourJour(new Date(Date.UTC(2026, 0, 5)))).toBe(20260105);
  });
});

describe("le refus de s'imbriquer", () => {
  // ⚠️ LA PROPRIÉTÉ QUE L'EN-TÊTE DE CE FICHIER ANNONCE, ÉPROUVÉE PLUTÔT QU'AFFIRMÉE. Sans elle,
  // `planchersDesGardes` lance cette garde, qui lance la suite, qui contient `planchersDesGardes` :
  // mesuré avant le correctif, le banc ne finissait plus. Et le code de sortie doit être 2 — « rien
  // n'a été vérifié » — jamais 0, qui prétendrait que l'ordre a été contrôlé.
  it("⚠️ lancée depuis une exécution de bancs, elle refuse et rend 2", () => {
    const garde = join(dirname(fileURLToPath(import.meta.url)), "..", "ordre-des-bancs.mjs");
    let code = 0, sortie;
    try {
      sortie = String(execFileSync(process.execPath, [garde], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VITEST: "true" },
      }));
    } catch (e) { code = e.status ?? 1; sortie = String(e.stdout || "") + String(e.stderr || ""); }
    expect(code, "0 prétendrait que l'ordre a été contrôlé ; 1 accuserait la branche").toBe(2);
    expect(sortie).toMatch(/imbriquerait la suite dans elle-même|l'imbriquerait dans elle-même/);
  });
});
