// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE ROUGE QUI ARRIVE SANS QUE PERSONNE N'AIT RIEN POUSSÉ.
//
// ⚠️ LA GARDE VOISINE COMPARE LES EXEMPLES AU REGISTRE VIVANT, PAS AU CONTENU DE LA BRANCHE.
// `exemples-epingles.mjs` autorise les DEUX dernières versions publiées. La conséquence est une
// bombe à retardement dont l'horloge est chez npm, pas chez nous :
//
//     exemples sur 0.1.127, registre sert 0.1.128   → vert (avant-dernière, tolérée)
//     0.1.129 est publiée                           → ROUGE, sur TOUTES LES PR OUVERTES,
//                                                      dont aucune n'a touché aux exemples
//
// C'est arrivé le 21/08 : deux PR sont passées au rouge pendant que 0.1.127 puis 0.1.128
// sortaient. Le refus est JUSTE — fusionner une de ces branches laisserait `main` deux versions
// derrière — mais il tombe sur des gens qui n'y sont pour rien, à un moment qu'ils n'ont pas
// choisi. Et ce dépôt sait ce que ça produit : « une alerte qui sonne quand tout va bien apprend
// aux gens à cliquer à côté ». Ici c'est pire, l'alerte sonne chez le voisin.
//
// ⚠️ CE FICHIER NE GARDE RIEN, IL PRÉVIENT. Il n'a pas de vote dans la CI des PR : il tourne sur
// l'horloge de `publication.yml` et dit s'il reste du SURSIS. Le sursis, c'est exactement la
// fenêtre entre « les exemples ne sont plus sur la dernière » et « ils ne sont plus dans les deux
// dernières » — une publication de marge. La sentinelle sert à ce que quelqu'un l'utilise.
//
// ⚠️ LA RÈGLE N'EST PAS RECOPIÉE ICI. Elle vit dans `exemples-epingles.mjs`, une fois, et ce
// fichier l'importe. Un deuxième exemplaire de « les deux dernières » divergerait du premier — et
// une sentinelle qui prévient d'après une règle périmée est pire qu'aucune sentinelle.
//
// Usage : node tools/exemples-en-retard.mjs

import { appendFileSync } from "node:fs";

import { estStable, comparerVersions, exemplesDuDepot, versionsPubliees } from "./exemples-epingles.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

export const A_JOUR = "a-jour";
/** Encore accepté par la garde — mais la prochaine publication le refuse. */
export const SURSIS = "sursis";
/** Déjà refusé : la garde est rouge maintenant, sur toutes les PR ouvertes. */
export const ROUGE = "rouge";

/** Les deux dernières versions STABLES servies, la plus récente d'abord. */
export const deuxDernieres = (publiees) =>
  (publiees || []).filter(estStable).sort(comparerVersions).slice(-2).reverse();

export function etatDe(version, [derniere, avant]) {
  if (version === derniere) return A_JOUR;
  if (avant !== undefined && version === avant) return SURSIS;
  return ROUGE;
}

/**
 * Le diagnostic complet. `null` si le registre n'a rien rendu : on ne conclut pas sur une absence
 * de réponse (voir la note de sortie plus bas).
 */
export function diagnostic(publiees, exemples) {
  const paires = deuxDernieres(publiees);
  if (!paires.length) return null;
  const [derniere, avant] = paires;
  const etats = exemples.map((e) => ({ ...e, etat: etatDe(e.version, paires) }));
  return {
    derniere,
    avant: avant ?? null,
    etats,
    enSursis: etats.filter((e) => e.etat === SURSIS),
    rouges: etats.filter((e) => e.etat === ROUGE),
    // ⚠️ CE BOOLÉEN EST LA RAISON D'ÊTRE DU FICHIER : y a-t-il quelque chose à faire AVANT que la
    // prochaine publication ne fasse rougir des branches qui n'y sont pour rien ?
    aSignaler: etats.some((e) => e.etat !== A_JOUR),
  };
}

/** Le corps de l'issue — il dit ce qui va casser, quand, et le geste exact qui l'évite. */
export function message(d) {
  const lignes = [];
  if (d.rouges.length) {
    lignes.push(`**${d.rouges.length} exemple(s) sont DÉJÀ refusés** par \`tools/exemples-epingles.mjs\` :`);
    for (const e of d.rouges) lignes.push(`- \`${e.fichier}\` épingle **${e.version}** — hors des deux dernières servies (${d.derniere}, ${d.avant ?? "—"})`);
    lignes.push("", "Toute PR ouverte est rouge sur cette étape, y compris celles qui n'ont pas touché aux exemples.");
  }
  if (d.enSursis.length) {
    // ⚠️ LE TITRE N'EST PAS DÉCORATIF, ET IL MANQUAIT. Sans lui, quand les deux groupes coexistent,
    // les puces du sursis s'enchaînaient à celles du rouge : un lecteur voyait une liste qui
    // continue, sans rien pour lui dire que la seconde moitié dit l'inverse — pas encore cassé.
    if (d.rouges.length) lignes.push("");
    lignes.push(`**${d.enSursis.length} exemple(s) sont en sursis** :`);
    for (const e of d.enSursis) lignes.push(`- \`${e.fichier}\` épingle **${e.version}**, l'avant-dernière servie — accepté aujourd'hui, **refusé dès la prochaine publication**`);
    lignes.push("", "Il reste exactement une publication de marge. C'est le moment de le faire, pas après.");
  }
  lignes.push(
    "",
    `Le registre sert **${d.derniere}**. Le geste :`,
    "",
    "```bash",
    ...d.etats.filter((e) => e.etat !== A_JOUR).map((e) =>
      `npm --prefix ${e.fichier.replace(/\/package\.json$/, "")} pkg set dependencies.discovery-media-player=${d.derniere}`),
    "```",
    "",
    "_Cette issue se referme seule quand les exemples rattrapent._",
  );
  return lignes.join("\n");
}

/**
 * Pose une valeur là où la forge la lira. ⚠️ On écrit dans `$GITHUB_OUTPUT` quand il existe, et sur
 * la sortie standard sinon — le même outil doit être lançable à la main, sinon personne ne le
 * lance jamais et on découvre ses défauts le jour où il compte.
 */
export function poser(cle, valeur, fichier = process.env.GITHUB_OUTPUT) {
  const multi = String(valeur).includes("\n");
  const texte = multi ? `${cle}<<FIN_DU_CORPS\n${valeur}\nFIN_DU_CORPS\n` : `${cle}=${valeur}\n`;
  if (fichier) appendFileSync(fichier, texte);
  else process.stdout.write(texte);
}

if (estExecuteDirectement(import.meta.url)) {
  const d = diagnostic(versionsPubliees(), exemplesDuDepot());

  // ⚠️ ICI, REGISTRE INJOIGNABLE ⇒ SORTIE 0, ET C'EST VOLONTAIREMENT L'INVERSE DES GARDES.
  //
  // `tools/resultat-garde.mjs` fait échouer un résultat non concluant (code 2), parce qu'une garde
  // de PR affirme qu'une branche a été vérifiée : ne pas avoir pu vérifier doit se voir. Cette
  // sentinelle-là n'affirme rien sur une branche, et elle tourne toutes les heures. Une coupure
  // réseau à 3 h ferait rougir une exécution programmée que la suivante réparerait toute seule —
  // et c'est exactement ce qui apprend à ne plus regarder l'onglet Actions. `publication.yml`
  // tranche déjà pareil, pour la même raison, à trois pas d'ici.
  if (!d) {
    console.log("::notice::registre injoignable — on ne conclut rien sur le retard des exemples");
    poser("signaler", "indetermine");
  } else if (!d.aSignaler) {
    console.log(`exemples à jour sur ${d.derniere} — rien à signaler`);
    poser("signaler", "non");
    poser("derniere", d.derniere);
  } else {
    console.log(`::warning::${d.rouges.length} exemple(s) déjà refusés, ${d.enSursis.length} en sursis — registre sur ${d.derniere}`);
    poser("signaler", "oui");
    poser("derniere", d.derniere);
    poser("corps", message(d));
  }
}
