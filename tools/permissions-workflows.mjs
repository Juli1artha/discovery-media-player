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
import { pathToFileURL } from "node:url";
import { workflows, ligneDe } from "./workflows-yaml.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";

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
export function ecartsDuFichier(texte, fichier) {
  const docs = parseAllDocuments(texte);
  const soucis = [];
  for (const doc of docs) {
    if (doc.errors.length) {
      const e = doc.errors[0];
      throw new Error(`${fichier} : YAML illisible ligne ${ligneDe(texte, e.pos?.[0] ?? 0)} — ${e.message}`);
    }
    if (!isMap(doc.contents)) continue;
    const paire = doc.contents.items.find((p) => isScalar(p.key) && String(p.key.value) === "permissions");
    if (!paire) continue;
    const ecritures = ecrituresRacine(paire.value?.toJSON?.() ?? paire.value?.value);
    if (!ecritures.length) continue;
    soucis.push(
      `${fichier}:${ligneDesPermissions(texte)} : « ${ecritures.join(", ")} » en écriture à la RACINE — ce droit est accordé à tous les jobs du fichier, y compris à ceux que personne n'a encore écrits. Déplacez-le sur le job qui s'en sert.`,
    );
  }
  return soucis;
}

/** Le relevé complet : combien de fichiers vus, et lesquels clochent. */
export function releve(dossier = ".github/workflows") {
  const fichiers = workflows(dossier);
  return { fichiers, soucis: fichiers.flatMap((f) => ecartsDuFichier(readFileSync(f, "utf8"), f)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = process.argv[2] || ".github/workflows";
  conclure(tenter(() => {
    const { fichiers, soucis } = releve(dossier);
    // Le refus sur zéro fichier vit dans `workflows()`, qui lève ; celui-ci est le filet du cas où
    // la liste reviendrait vide sans lever.
    if (!fichiers.length) return inconclusif(`aucun workflow dans ${dossier} — la sonde vise à côté`);
    if (soucis.length) return violation(soucis);
    return conforme(`permissions : ${fichiers.length} workflows, aucune écriture à la racine`);
  }));
}
