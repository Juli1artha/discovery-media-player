// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE VERROU DÉCLARAIT UNE VERSION DE ONZE TRAINS EN RETARD, ET RIEN NE LE DISAIT.
//
// ⚠️ CE N'EST PAS UNE CRAINTE, C'EST UNE MESURE. Le 05/09, `package.json` déclarait `0.1.156` et
// `package-lock.json` déclarait `0.1.145` — onze versions d'écart, accumulées un train à la fois,
// sans qu'aucune garde, aucun banc ni aucun préflight ne s'en aperçoive.
//
// ⚠️ ET LA CAUSE EST DANS NOTRE PROCÉDURE, PAS DANS UN OUBLI. Un train monte la version en ÉCRIVANT
// `package.json` ; `npm version` l'aurait propagée au verrou, la réécriture directe ne le fait pas.
// Le défaut est donc systématique et silencieux : il se reproduit à chaque publication, et sa
// visibilité est nulle parce que **npm ne lit pas ce champ à l'installation**. Rien ne casse. C'est
// exactement la forme que ce dépôt traque : un écart qui ne coûte rien jusqu'au jour où quelqu'un
// s'en sert pour répondre à une question.
//
// ⚠️ CE QUE L'ÉCART COÛTE QUAND IL COÛTE. Le verrou est ce que lisent les outils qui n'exécutent pas
// `npm` : `plancher-de-node.mjs` s'en sert déjà pour conclure hors ligne, un SBOM le prend pour
// source, un audit de chaîne d'approvisionnement le compare au tag. Chacun lirait `0.1.145` pour un
// artefact qui en déclare `0.1.156`, et l'incohérence ressemblerait à une falsification plutôt qu'à
// une négligence. Un dépôt qui publie des attestations de provenance ne peut pas se permettre un
// champ de version qui ment sur lui-même.
//
// La règle est donc littérale : les deux fichiers déclarent LE MÊME numéro, aux deux emplacements
// que porte un verrou de version 3 — la racine, et l'entrée `packages[""]` qui décrit le paquet
// lui-même. Le correctif ne s'écrit jamais à la main : `npm install --package-lock-only` le
// régénère, et c'est ce que le constat dit à l'auteur.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Les emplacements du verrou qui décrivent CE paquet — pas ses dépendances. */
export function versionsDuVerrou(verrou) {
  const trouvees = [];
  if (typeof verrou?.version === "string") trouvees.push({ ou: "racine", valeur: verrou.version });
  const propre = verrou?.packages?.[""];
  if (typeof propre?.version === "string") trouvees.push({ ou: 'packages[""]', valeur: propre.version });
  return trouvees;
}

export function auditer(racine = RACINE) {
  const paquet = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
  const verrou = JSON.parse(readFileSync(join(racine, "package-lock.json"), "utf8"));

  const attendue = paquet?.version;
  if (typeof attendue !== "string" || !attendue) {
    return inconclusif("package.json ne déclare pas de version lisible — il n'y a rien à confronter");
  }

  const declarees = versionsDuVerrou(verrou);
  // ⚠️ ZÉRO EMPLACEMENT RECONNU N'EST PAS UNE CONFORMITÉ. Règle anti-vacuité : un verrou dont la
  // forme change — un `lockfileVersion` futur, un champ renommé — ferait taire cette garde au lieu
  // de la faire parler, et l'écart repartirait invisible comme il l'a été onze trains durant.
  if (!declarees.length) {
    return inconclusif("package-lock.json ne déclare de version ni à la racine ni dans `packages[\"\"]`"
      + ` (lockfileVersion ${JSON.stringify(verrou?.lockfileVersion)}) — la sonde vise à côté, ou la`
      + " forme du verrou a changé : rien n'a été vérifié");
  }

  const constats = declarees
    .filter((d) => d.valeur !== attendue)
    .map((d) => `package-lock.json (${d.ou}) déclare ${d.valeur} alors que package.json déclare `
      + `${attendue}. Le verrou est ce que lisent les outils qui n'exécutent pas npm — régénérez-le `
      + "avec `npm install --package-lock-only`, jamais à la main.");

  if (constats.length) return violation(constats);
  return conforme(`package.json et package-lock.json déclarent ${attendue}, aux ${declarees.length} `
    + "emplacement(s) du verrou qui décrivent ce paquet");
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
