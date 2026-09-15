// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA COHORTE ATTACHÉE À UNE RELEASE DOIT MESURER *CE* TAG — ET CE BANC LANCE LE VRAI SCRIPT.
//
// ⚠️ CE QUI EST ARRIVÉ (14/09). J'ai relayé aux hôtes le relevé de la course d'une PR — version
// 0.1.167, commit 8e9e37c — en le présentant comme celui du tag 0.1.168 (commit f5f0ae7). Les deux
// campagnes étaient vraies ; une seule mesurait le tag ; RIEN DANS L'OUTILLAGE NE POUVAIT LES
// DISTINGUER. Le validateur juge la cohérence INTERNE d'une campagne — même course, positions
// continues, conditions constantes — et il aurait jugé conforme n'importe laquelle des deux.
// Relevé par un auditeur externe (CODEX, 15/09). La provenance se contrôle, elle ne se relit pas.
//
// ⚠️ ET CE BANC EXÉCUTE LE SCRIPT TEL QU'IL EST ÉCRIT DANS LE WORKFLOW, pas une copie. Un contrôle
// qui ne s'exerce qu'un jour de sortie est un contrôle qu'on découvre cassé un jour de sortie : la
// première version de ce script découpait `process.argv` comme pour `node fichier.js` alors que
// `node -e` décale d'un cran — chaque comparaison portait sur la mauvaise valeur, et la garde
// refusait TOUTE cohorte, y compris la bonne. Verte sur rien, rouge sur tout, invisible jusqu'au
// pire moment. C'est ce banc qui l'a trouvée, en jouant le script pour de vrai.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));

/** Le script `node -e` du contrôle de provenance, extrait du workflow — pas recopié. */
const scriptDeProvenance = () => {
  const etape = (workflow.jobs.attester.steps || []).find(
    (e) => typeof e.run === "string" && e.run.includes("identity.runId"),
  );
  expect(etape, "aucune étape d'attester ne contrôle identity.runId").toBeTruthy();
  const m = etape.run.match(/node -e '([\s\S]*?)'\s*"\$f"/);
  expect(m, "le script de provenance n'a pas la forme attendue dans release.yml").toBeTruthy();
  return m[1];
};

const dossier = mkdtempSync(join(tmpdir(), "provenance-"));
const poser = (nom, objet) => {
  const chemin = join(dossier, `${nom}.json`);
  writeFileSync(chemin, JSON.stringify(objet));
  return chemin;
};

/** Rend le code de sortie du script sur ce fichier, pour ce tag et cette course. */
const juger = (fichier, { version = "0.1.168", sha = "f5f0ae7", run = "34897302599" } = {}) => {
  try {
    execFileSync("node", ["-e", scriptDeProvenance(), fichier, version, sha, run], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return { code: e.status, sortie: String(e.stdout || "") };
  }
};

const TAG = { identity: { packageVersion: "0.1.168", commitSha: "f5f0ae7", runId: "gha-34897302599-1" } };

describe("⚠️ ON N'ATTACHE PAS À UNE RELEASE LA MESURE D'UN AUTRE COMMIT", () => {
  it("la cohorte du tag passe — sans quoi tout le reste de ce banc ne prouverait rien", () => {
    // Le témoin positif est indispensable ici : une garde qui refuse TOUT satisferait chacun des
    // refus ci-dessous tout en étant totalement cassée. C'est exactement ce qui est arrivé.
    expect(juger(poser("tag", TAG))).toBe(0);
  });

  it("⚠️ la cohorte de la PR — la confusion RÉELLE du 14/09 — est refusée, et les deux écarts sont nommés", () => {
    const r = juger(poser("pr", { identity: { packageVersion: "0.1.167", commitSha: "8e9e37c", runId: "gha-34894663303-1" } }));
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/identity\.packageVersion vaut "0\.1\.167", le tag porte "0\.1\.168"/);
    expect(r.sortie).toMatch(/identity\.commitSha vaut "8e9e37c", le tag porte "f5f0ae7"/);
  });

  it("une cohorte du bon commit mais d'une AUTRE course est refusée", () => {
    // Deux courses du même commit donnent deux campagnes légitimes et différentes ; attacher un
    // mélange des deux, ou celle qu'on n'a pas retenue, rendrait le relevé inexplicable.
    const r = juger(poser("autre-course", { identity: { ...TAG.identity, runId: "gha-99999-1" } }));
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/identity\.runId vaut "gha-99999-1"/);
  });

  it("un artefact sans identité est refusé, pas toléré", () => {
    // `undefined !== "0.1.168"` doit REFUSER. Une comparaison laxiste ferait passer le pire cas :
    // un fichier dont on ne sait rien.
    const r = juger(poser("vide", {}));
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/identity\.packageVersion vaut undefined/);
  });

  it("⚠️ le runId est comparé sur le PRÉFIXE de course, pas sur l'égalité — la tentative fait partie du nom", () => {
    // `gha-<course>-<tentative>` : un rejeu de la même course rend `-2`, et c'est toujours la
    // course retenue. Exiger l'égalité stricte refuserait une cohorte parfaitement légitime.
    expect(juger(poser("tentative-2", { identity: { ...TAG.identity, runId: "gha-34897302599-2" } }))).toBe(0);
    // Mais un préfixe qui n'en est pas un ne passe pas : `gha-348972…` ne doit pas valider `34897`.
    expect(juger(poser("prefixe-trompeur", { identity: { ...TAG.identity, runId: "gha-348972995991-1" } })).code).toBe(1);
  });
});
