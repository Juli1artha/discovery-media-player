// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE PERMISSION D'ÉCRITURE VA AU JOB QUI S'EN SERT — JAMAIS À LA RACINE D'UN WORKFLOW.
//
// ⚠️ CE QUE COÛTE UNE PERMISSION POSÉE À LA RACINE : elle est accordée à TOUS les jobs du fichier,
// y compris à ceux que personne n'a encore écrits. Le jour où quelqu'un ajoute une étape, elle
// hérite d'un droit d'écriture qu'elle n'a pas demandé et que son auteur ne verra pas — le
// privilège s'accorde par oubli, ce qui est exactement l'inverse du refus-par-défaut que ce dépôt
// applique à ses entrées.
//
// Cinq des huit workflows étaient dans ce cas (relevé du 22/08) : `cla.yml` portait `contents`,
// `pull-requests` et `issues` en écriture pour son unique job, `codeql.yml` `security-events`,
// `image.yml` et `image-reconcile.yml` `packages`, `publication.yml` `issues`. Aucun n'était
// fautif dans son intention ; tous laissaient la porte ouverte au job suivant.
//
// ⚠️ ET LA RAISON N'EST PAS LE SCORE. OpenSSF Scorecard compte ce point, et c'est ce qui l'a fait
// remarquer — mais une règle qu'on ne tient que parce qu'un tiers la mesure se relâche dès qu'il
// cesse de mesurer. Celle-ci se tient parce que `release.yml` a déjà servi de démonstration : son
// job qui exécute un tarball téléchargé tournait avec de quoi publier sur npm, précisément parce
// que les droits vivaient à la racine.
//
// Usage : node tools/permissions-workflows.mjs [.github/workflows]

import { parseAllDocuments, isMap, isScalar } from "yaml";
import { readFileSync } from "node:fs";

import { workflows, ligneDe } from "./workflows-yaml.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * ⚠️ CE QUI COMPTE COMME UNE ÉCRITURE. `write` sur n'importe quelle portée, bien sûr — mais aussi
 * `write-all`, qui les accorde toutes d'un mot et se lit comme une abréviation anodine.
 *
 * `read-all`, `{}` et l'absence de bloc ne donnent aucun droit d'écriture : ils sont acceptés.
 * ⚠️ En revanche, `{}` et `read-all` ne sont PAS équivalents pour la suite — `{}` retire tout, y
 * compris la lecture, ce qui oblige chaque job à déclarer même ce qu'il lit. C'est plus strict, et
 * cette garde ne tranche pas entre les deux : elle ne refuse que l'écriture.
 */
export function ecrituresRacine(permissions) {
  if (permissions === "write-all") return ["write-all (toutes les portées)"];
  if (!permissions || typeof permissions !== "object") return [];
  return Object.entries(permissions)
    .filter(([, valeur]) => String(valeur) === "write")
    .map(([portee]) => portee);
}

/** La ligne du bloc `permissions:` racine, pour nommer où corriger plutôt que quoi corriger. */
export function ligneDesPermissions(texte) {
  const m = /^permissions:/m.exec(texte);
  return m ? ligneDe(texte, m.index) : 1;
}

/**
 * Les écarts d'un fichier. ⚠️ On LÈVE sur un document illisible plutôt que de le sauter : un
 * workflow qu'on n'a pas su lire n'est pas un workflow sans permissions.
 */
/**
 * Les blocs `permissions:` à la RACINE d'un document — LA FORME QUE CETTE GARDE DOIT SAVOIR LIRE.
 *
 * ⚠️ SÉPARÉE POUR SERVIR DEUX FOIS, ET LE SECOND USAGE EST UN TÉMOIN. `ecartsDuFichier` s'en sert
 * pour juger ; `blocsLus` s'en sert pour prouver que la sonde voit encore quelque chose. Un seul
 * parcours, donc un seul exemplaire de « où vit un bloc de permissions » — deux copies de ce fait
 * divergeraient, et c'est le témoin qui deviendrait faux en silence.
 */
function* pairesRacine(texte, fichier) {
  for (const doc of parseAllDocuments(texte)) {
    if (doc.errors.length) {
      const e = doc.errors[0];
      throw new Error(`${fichier} : YAML illisible ligne ${ligneDe(texte, e.pos?.[0] ?? 0)} — ${e.message}`);
    }
    if (!isMap(doc.contents)) continue;
    const paire = doc.contents.items.find((p) => isScalar(p.key) && String(p.key.value) === "permissions");
    if (paire) yield paire;
  }
}

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — combien de blocs `permissions:` la sonde a RECONNUS.
 *
 * Cette garde affirme une ABSENCE (« aucune écriture à la racine ») sur neuf fichiers. Sa panne la
 * plus probable — un lecteur qui ne reconnaît plus la forme d'un bloc — produit elle aussi une
 * absence : neuf workflows verts sans rien avoir mesuré. Le plancher existant compte les FICHIERS
 * LUS, pas la FORME RECONNUE, et ne peut donc pas distinguer les deux.
 *
 * Mesuré le 31/08 en aveuglant la sonde : l'outil imprimait « 9 workflows, aucune écriture à la
 * racine » et sortait 0. Ses bancs, eux, rougissaient — la règle était donc protégée, mais le
 * VERDICT IMPRIMÉ ne l'était pas, et c'est lui qui va dans le journal.
 *
 * L'idée est de la session STUDIO, qui a trouvé la même chose chez elle sur 97 fichiers : notre
 * témoin d'exception prouve qu'une EXCEPTION a encore un sujet, celui-ci prouve que la RÈGLE en a
 * encore un. Deux moitiés de la même précaution.
 */
export function blocsLus(texte, fichier = "?") {
  return [...pairesRacine(texte, fichier)].length;
}

export function ecartsDuFichier(texte, fichier) {
  const soucis = [];
  for (const paire of pairesRacine(texte, fichier)) {
    const ecritures = ecrituresRacine(paire.value?.toJSON?.() ?? paire.value?.value);
    if (!ecritures.length) continue;
    soucis.push(
      `${fichier}:${ligneDesPermissions(texte)} : « ${ecritures.join(", ")} » en écriture à la RACINE — ce droit est accordé à tous les jobs du fichier, y compris à ceux que personne n'a encore écrits. Déplacez-le sur le job qui s'en sert.`,
    );
  }
  return soucis;
}

/** Le relevé complet : combien de fichiers vus, combien de blocs RECONNUS, et lesquels clochent. */
export function releve(dossier = ".github/workflows") {
  const fichiers = workflows(dossier);
  const textes = fichiers.map((f) => [f, readFileSync(f, "utf8")]);
  return {
    fichiers,
    blocs: textes.reduce((n, [f, t]) => n + blocsLus(t, f), 0),
    soucis: textes.flatMap(([f, t]) => ecartsDuFichier(t, f)),
  };
}

if (estExecuteDirectement(import.meta.url)) {
  const dossier = process.argv[2] || ".github/workflows";
  conclure(tenter(() => {
    const { fichiers, blocs, soucis } = releve(dossier);
    // Le refus sur zéro fichier vit dans `workflows()`, qui lève ; celui-ci est le filet du cas où
    // la liste reviendrait vide sans lever.
    if (!fichiers.length) return inconclusif(`aucun workflow dans ${dossier} — la sonde vise à côté`);
    // ⚠️ ET LE TÉMOIN DE LA RÈGLE, PAS SEULEMENT CELUI DU PÉRIMÈTRE. Zéro bloc reconnu sur neuf
    // workflows ne veut pas dire que le dépôt est devenu propre : ça veut dire que la sonde ne voit
    // plus la forme. Un plancher à UN, parce que « au moins un workflow déclare ses permissions »
    // est vrai de tout état sain de ce dépôt, alors que neuf serait collé au relevé du jour.
    if (!blocs) {
      return inconclusif(`aucun bloc « permissions: » reconnu dans ${fichiers.length} workflow(s) — ce n'est pas une absence d'écriture à la racine, c'est une sonde qui ne lit plus la forme`);
    }
    if (soucis.length) return violation(soucis);
    return conforme(`permissions : ${blocs} bloc(s) « permissions: » lu(s) dans ${fichiers.length} workflow(s), aucune écriture à la racine`);
  }));
}
