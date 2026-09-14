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

import { ORDRE_DECLARE, classerRejeu, confronter, fichiersEnEchec, fichiersVus, grainePourJour, grainesDemandees, verdict } from "../ordre-des-bancs.mjs";

// ⚠️ UN RAPPORT STRUCTURÉ, JAMAIS LA SORTIE TEXTE. La première écriture cherchait « FAIL <chemin> »
// dans tout ce que vitest imprimait — y compris ce que les bancs impriment eux-mêmes en lançant des
// gardes. Elle classait ces fichiers « déjà rouges », rendait NON CONCLUANT, et ce non-concluant
// passait avant une violation confirmée : une vraie dépendance d'ordre est restée masquée (audit
// externe, graine 20260913, 13/09). Ces bancs fixent les trois défauts.
const RACINE_X = "/home/user/x";
const RAPPORT = {
  numTotalTestSuites: 900,
  testResults: [
    { name: "/home/user/x/server/__tests__/a.test.js", status: "failed", assertionResults: [{ status: "failed" }] },
    { name: "/home/user/x/charge/b.test.js", status: "failed", assertionResults: [{ status: "failed" }, { status: "failed" }] },
    { name: "/home/user/x/tools/__tests__/c.test.js", status: "passed", assertionResults: [{ status: "passed" }] },
  ],
};

describe("lire le rapport JSON de vitest", () => {
  it("relève les fichiers en échec, relatifs à la racine, sans doublon", () => {
    expect(fichiersEnEchec(RAPPORT, RACINE_X).sort()).toEqual(["charge/b.test.js", "server/__tests__/a.test.js"]);
  });

  it("⚠️ une ligne « FAIL » IMPRIMÉE par un banc n'est pas un échec : seul le statut compte", () => {
    const rapport = { testResults: [
      { name: "/home/user/x/tools/__tests__/planchers.test.js", status: "passed",
        assertionResults: [{ status: "passed", title: "la garde imprime FAIL  server/__tests__/piege.test.js et sort en 1" }],
        console: [{ type: "stdout", content: " FAIL  server/__tests__/piege.test.js > un faux rouge\n" }] },
    ] };
    expect(fichiersEnEchec(rapport, RACINE_X)).toEqual([]);
  });

  it("relève le nombre de fichiers de bancs VUS — c'est l'objet de la sonde", () => {
    expect(fichiersVus(RAPPORT)).toBe(3);
  });

  it("⚠️ un rapport illisible ne rend pas zéro, il rend `null`", () => {
    expect(fichiersVus(null)).toBe(null);
    expect(fichiersVus({ testResults: [] })).toBe(null);
    expect(fichiersVus("vitest a explosé")).toBe(null);
  });
});

// ⚠️ LE REJEU INDIVIDUEL CONCLUAIT SUR LE CODE DE SORTIE SEUL — « le processus a-t-il échoué ? » pour
// répondre à « qu'a rendu le banc ? ». Un audit externe a vu six fichiers déclarés « déjà rouges »
// que 6/6 rejouaient verts à la main (septième passe, 14/09). Le rapport et le processus sont
// confrontés ; tout désaccord est dit avec ses pièces et ne classe jamais.
describe("⚠️ classerRejeu : le rapport ET le processus, jamais l'un sans l'autre", () => {
  const racine = "/r";
  const rapport = (statut, nom = "a.test.js") => ({ testResults: [{ name: `/r/${nom}`, status: statut }] });
  const proc = (status, extra = {}) => ({ status, signal: null, stderr: "", ...extra });

  it("rapport vert + code 0 → passe seul", () => {
    expect(classerRejeu({ fichier: "a.test.js", r: proc(0), rapport: rapport("passed"), racine })).toEqual({ classe: "passe-seul" });
  });
  it("rapport rouge + code non nul → rouge préalable", () => {
    expect(classerRejeu({ fichier: "a.test.js", r: proc(1), rapport: rapport("failed"), racine })).toEqual({ classe: "rouge-prealable" });
  });
  it("⚠️ rapport VERT + code non nul → NON CONCLUANT, jamais « rouge préalable » — c'est le cas de l'audit", () => {
    const c = classerRejeu({ fichier: "a.test.js", r: proc(1, { signal: null, stderr: "ligne 1\nharnais : sortie forcée" }), rapport: rapport("passed"), racine });
    expect(c.classe).toBe("non-concluant");
    expect(c.raison).toMatch(/désaccord instrument\/processus sur a\.test\.js : le rapport dit passed, le processus rend le code 1/);
    expect(c.raison, "les statuts du rapport sont imprimés").toMatch(/a\.test\.js=passed/);
    expect(c.raison, "et la fin de stderr").toMatch(/harnais : sortie forcée/);
  });
  it("rapport rouge + code 0 → NON CONCLUANT (désaccord dans l'autre sens)", () => {
    const c = classerRejeu({ fichier: "a.test.js", r: proc(0), rapport: rapport("failed"), racine });
    expect(c.classe).toBe("non-concluant");
    expect(c.raison).toMatch(/le rapport dit failed, le processus rend le code 0/);
  });
  it("un signal est dit quand il y en a un", () => {
    const c = classerRejeu({ fichier: "a.test.js", r: proc(null, { signal: "SIGKILL" }), rapport: rapport("passed"), racine });
    expect(c.classe).toBe("non-concluant");
    expect(c.raison).toMatch(/signal SIGKILL/);
  });
  it("rapport absent, vide ou illisible → NON CONCLUANT", () => {
    for (const rapportNul of [null, {}, { testResults: [] }]) {
      const c = classerRejeu({ fichier: "a.test.js", r: proc(1), rapport: rapportNul, racine });
      expect(c.classe).toBe("non-concluant");
      expect(c.raison).toMatch(/rapport JSON absent ou vide/);
    }
  });
  it("un rapport qui ne contient PAS le fichier demandé → NON CONCLUANT, et dit ce qu'il contient", () => {
    const c = classerRejeu({ fichier: "b.test.js", r: proc(0), rapport: rapport("passed", "a.test.js"), racine });
    expect(c.classe).toBe("non-concluant");
    expect(c.raison).toMatch(/ne contient pas b\.test\.js \(il contient : a\.test\.js\)/);
  });
  it("un statut inattendu (ni passed ni failed) → NON CONCLUANT", () => {
    expect(classerRejeu({ fichier: "a.test.js", r: proc(0), rapport: rapport("skipped"), racine }).classe).toBe("non-concluant");
  });
});

describe("⚠️ le verdict : une violation confirmée PRIME sur un cas non concluant", () => {
  const base = { avertissements: [], entete: "graine 1", vus: 10 };
  it("violation + rouge préexistant → VIOLATION, le rouge préexistant est dit en avertissement", () => {
    const r = verdict({ ...base, constats: ["x.test.js dépend de son rang"], raisonsNonConcluance: ["y.test.js échoue AUSSI dans l'ordre normal"] });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/x\.test\.js/);
    expect(r.avertissements.join("\n")).toMatch(/non concluant par ailleurs — y\.test\.js/);
  });
  it("rouge préexistant seul → NON CONCLUANT", () => {
    expect(verdict({ ...base, constats: [], raisonsNonConcluance: ["y"] }).code).toBe(2);
  });
  it("rien → CONFORME, avec le compte de fichiers", () => {
    const r = verdict({ ...base, constats: [], raisonsNonConcluance: [] });
    expect(r.code).toBe(0);
    expect(r.resume).toMatch(/^10 fichiers/);
  });
});

describe("les graines demandées", () => {
  it("sans argument : le jour ; avec `--graine=42,jour,20260913` : les trois, `jour` résolu", () => {
    expect(grainesDemandees([], 20260911)).toEqual([20260911]);
    expect(grainesDemandees(["--graine=42,jour,20260913"], 20260911)).toEqual([42, 20260911, 20260913]);
    expect(grainesDemandees(["--graine=jour,42,20260913"], 20260913), "jour = une graine fixe : une seule fois").toEqual([20260913, 42]);
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
