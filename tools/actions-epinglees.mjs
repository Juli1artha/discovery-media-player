// LES ACTIONS ÉPINGLÉES — SUR LA STRUCTURE DU FICHIER, PLUS SUR SON TEXTE.
//
// ⚠️ CETTE GARDE EXISTAIT ET ELLE ÉTAIT AVEUGLE. Elle faisait un `grep` sur les fichiers de
// workflow, et un `grep` ne sait pas où il regarde. Deux défauts, de sens opposés :
//
//   1. IL VOYAIT DES COMMENTAIRES. Écrire « le contrôle refuse `uses: machin@v3` » dans un
//      commentaire rendait la CI rouge. C'est ainsi que le défaut a été trouvé : en documentant
//      la règle voisine (PR de l'épinglage des images), le commentaire s'est fait attraper par
//      elle. Une garde qui rougit sur sa propre documentation apprend à être contournée.
//
//   2. IL NE VOYAIT PAS DES ACTIONS. Et c'est le vrai défaut. Son motif exigeait littéralement
//      `uses: ` suivi d'un nom non quoté ; ces trois lignes-ci passaient SANS UN MOT :
//
//          - uses: "actions/checkout@v4"      (guillemets doubles)
//          - uses: 'actions/cache@main'       (guillemets simples)
//          - uses:  actions/setup-node@v3     (deux espaces)
//
//      Constaté, pas supposé : les trois posées dans un workflow de sonde, la garde d'origine
//      rend « rien à signaler ». Or c'est la garde la plus sensible du dépôt — une étiquette
//      d'action peut être redéplacée par son auteur, ou par qui prend son compte, et l'action
//      s'exécute avec les droits de cette forge, qui PUBLIE sur npm.
//
// C'est le même défaut que le lexer de `tools/env-lues.mjs`, corrigé pour la même raison : on ne
// lit pas un format structuré avec une expression régulière. Faute d'analyseur YAML dans les
// dépendances — et ce dépôt n'en ajoute pas une pour ça —, on lit les lignes en sachant CE QU'ON
// NE SAIT PAS : les commentaires sont retirés, les blocs scalaires (`run: |`) sont sautés, et
// `uses:` n'est reconnu qu'en POSITION DE CLÉ. Les limites sont énumérées plus bas plutôt que
// tues.
//
// Usage : node tools/actions-epinglees.mjs [.github/workflows]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Retire le commentaire d'une ligne. Un `#` n'ouvre un commentaire que s'il est en début de
 * contenu ou précédé d'un blanc, et hors chaîne quotée — `uses: "a#b"` n'a pas de commentaire.
 */
export function sansCommentaire(ligne) {
  let quote = null;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(ligne[i - 1]))) return ligne.slice(0, i);
  }
  return ligne;
}

/**
 * Les lignes où une clé YAML peut vivre : hors blocs scalaires, commentaires retirés.
 *
 * ⚠️ LES BLOCS `run: |` SONT DU TEXTE, PAS DU YAML. Ce fichier-ci en contient : le script d'une
 * étape peut écrire `uses: quelque-chose@v1` dans un message, et ce n'est pas une action. On les
 * saute par l'indentation, comme YAML les délimite.
 */
export function lignesDeCle(txt) {
  const lignes = txt.split("\n");
  const gardees = [];
  let blocA = null; // indentation minimale du contenu d'un bloc scalaire en cours
  for (const brute of lignes) {
    const vide = brute.trim() === "";
    const indent = brute.length - brute.replace(/^\s*/, "").length;
    if (blocA !== null) {
      if (vide || indent >= blocA) continue;
      blocA = null;
    }
    if (vide) continue;
    const ligne = sansCommentaire(brute);
    if (ligne.trim() === "") continue;
    // `clé: |`, `clé: >-`, `clé: |2` … ouvrent un bloc dont le contenu est plus indenté.
    if (/:\s*[|>][-+]?\d*\s*$/.test(ligne)) { blocA = indent + 1; continue; }
    gardees.push(ligne);
  }
  return gardees;
}

/** Les valeurs de `uses:`, en position de clé seulement — quotées ou non, espacées ou non. */
export function references(txt) {
  const trouvees = [];
  for (const ligne of lignesDeCle(txt)) {
    const m = /^\s*(?:-\s+)?uses\s*:\s*(.+?)\s*$/.exec(ligne);
    if (!m) continue;
    trouvees.push(m[1].replace(/^["'](.*)["']$/, "$1"));
  }
  return trouvees;
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * ⚠️ CE QUI DOIT ÊTRE ÉPINGLÉ, ET CE QUI N'A PAS À L'ÊTRE.
 *   - une action LOCALE (`./.github/actions/x`) vit dans ce dépôt, au commit courant : rien à
 *     épingler, et exiger un SHA serait impossible à satisfaire ;
 *   - une action distante (`owner/repo@ref`, `owner/repo/chemin@ref`, y compris un workflow
 *     réutilisable) doit porter un SHA de 40 caractères — une étiquette se redéplace ;
 *   - une image (`docker://…`) doit porter un condensat, pour la raison du Dockerfile ;
 *   - une référence distante SANS `@` pointe la branche par défaut : c'est le pire cas, elle
 *     change sous nos pieds sans que rien ne bouge chez nous.
 */
export function ecartEpinglage(reference) {
  if (reference.startsWith("./") || reference.startsWith("../")) return null;
  if (reference.startsWith("docker://")) {
    return /@sha256:[0-9a-f]{64}$/.test(reference)
      ? null
      : `« ${reference} » n'est pas épinglée sur un condensat — ajoutez @sha256:…`;
  }
  const at = reference.lastIndexOf("@");
  if (at <= 0) return `« ${reference} » n'a pas de référence — elle suit la branche par défaut, qui change sans nous`;
  const ref = reference.slice(at + 1);
  if (!SHA.test(ref)) return `« ${reference} » est épinglée sur « ${ref} », pas sur un commit — une étiquette se redéplace, un SHA ne désigne qu'un arbre`;
  return null;
}

export function ecarts(txt, fichier) {
  return references(txt).map(ecartEpinglage).filter(Boolean).map((e) => `${fichier} : ${e}`);
}

export function workflows(dossier) {
  return readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dossier, f));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = process.argv[2] || ".github/workflows";
  const fichiers = workflows(dossier);
  if (!fichiers.length) {
    console.error(`::error::aucun workflow dans ${dossier} — la sonde vise à côté`);
    process.exit(1);
  }
  const soucis = fichiers.flatMap((f) => ecarts(readFileSync(f, "utf8"), f));
  if (soucis.length) {
    for (const s of soucis) console.error("::error::" + s);
    process.exit(1);
  }
  const n = fichiers.flatMap((f) => references(readFileSync(f, "utf8"))).length;
  console.log(`actions : ${n} référence(s) dans ${fichiers.length} workflows, toutes épinglées sur un commit`);
}
