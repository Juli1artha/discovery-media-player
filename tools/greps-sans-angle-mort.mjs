// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN `grep` SUR DU CODE SAUTE UN FICHIER BINAIRE EN SILENCE — ET UN FICHIER SOURCE PEUT L'ÊTRE.
//
// ⚠️ CE QUI L'A RÉVÉLÉ (27/08). Un hôte a relu les occurrences restantes d'une forme corrigée dans
// notre `server/` et a conclu, à juste titre pour ce qu'il voyait, « quatre sites, zéro manqué ».
// Il y en avait CINQ. La cinquième vit dans `server/__tests__/etiquetteBornee.test.js`, qui contient
// un octet NUL — délibérément, puisque c'est le banc des caractères de contrôle et qu'un banc qui
// prétend éprouver un NUL sans en contenir un n'éprouve rien. GNU grep classe alors le fichier comme
// binaire, annonce « Binary file … matches » et N'IMPRIME AUCUNE LIGNE :
//
//     $ grep -rn  "String(body.action" server/ | wc -l     →  4
//     $ grep -arn "String(body.action" server/ | wc -l     →  5
//
// ⚠️ CE N'EST PAS UN FAUX NÉGATIF ORDINAIRE, C'EST UN SAUT MUET. La sonde ne dit pas « je n'ai pas
// pu lire ce fichier » : elle rend un nombre plus petit, d'apparence normale, sur lequel on conclut.
// C'est la forme que ce dépôt refuse partout — une sortie qui ressemble à un succès. Sa conclusion
// restait vraie par chance (la cinquième était, elle aussi, un commentaire) ; si ce site avait été
// un appel, le relevé l'aurait manqué sans rien signaler.
//
// ⚠️ AUCUNE DE NOS ÉTAPES N'ÉTAIT AVEUGLE LE JOUR OÙ CETTE GARDE A ÉTÉ ÉCRITE, ET C'EST PRÉCISÉMENT
// POURQUOI ELLE EXISTE. Les trois `grep` de `ci.yml` qui lisent du code visent `server/*.js` — le
// glob ne descend pas dans `__tests__/`, donc le fichier à NUL n'était pas dans leur périmètre. La
// propriété tenait par la forme du glob, pas par une décision : le jour où un fichier de premier
// niveau gagne un octet de contrôle, il DISPARAÎT de ces étapes sans qu'aucune rougisse. On garde
// donc la CLASSE — tout `grep` d'un workflow qui lit du source porte `-a` — plutôt que le cas.
//
// ⚠️ POURQUOI `-a` ET PAS UN REFUS SUR FICHIER BINAIRE. `-a` fait lire le fichier COMME DU TEXTE :
// ses lignes réapparaissent, et la garde qui l'inspecte reprend son travail. Un refus, lui,
// demanderait à chaque appelant de décider quoi faire — et un appelant qui ne sait pas décide de
// continuer. Le drapeau qui rend la sonde exhaustive vaut mieux que l'erreur qu'on apprend à ignorer.
//
// Usage : node tools/greps-sans-angle-mort.mjs [.github/workflows]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";
// ⚠️ LA MÊME ORTHOGRAPHE QUE `shell-des-workflows` POUR « LES BLOCS run: D'UN WORKFLOW ». Une
// seconde écriture de cette question serait la recopie que ce dépôt a déjà payée trois fois.
import { blocsDe } from "./shell-des-workflows.mjs";

const DOSSIER = ".github/workflows";

/** Les dossiers dont le contenu est du code de ce dépôt — ceux qu'une sonde doit lire en entier. */
export const RACINES_SOURCE = ["server", "src", "context", "bin", "tools", "build", "charge"];

// ⚠️ DES PLANCHERS STRUCTURELS, PAS UNE POPULATION. `verifier` prend une racine ARBITRAIRE : un
// nombre calibré sur ce dépôt y accuserait toute fixture qui porte moins de `grep` que lui — le
// banc de ce fichier l'a montré en une course. Ce qui est vrai de TOUTE racine qu'on soumet à
// cette garde, c'est « au moins un appel reconnu, et au moins un qui lit du source » : sans cela,
// un vert ne dit rien de la racine qu'on vient de lire.
//
// ⚠️ LA POPULATION DE CE DÉPÔT, ELLE, EST AFFIRMÉE PAR LE BANC — 25 appels reconnus le 31/08,
// dont 3 visant du source. C'est le même partage que `licence-par-fichier` : la règle vit dans la
// garde, le fait sur CE dépôt vit là où le dépôt est le sujet.
export const PLANCHER_GREPS = 1;
export const PLANCHER_SUR_SOURCE = 1;

/**
 * Retire ce qui est CITÉ avant de chercher des chemins.
 *
 * ⚠️ SANS ÇA, LA GARDE ACCUSE LES MOTIFS. `grep -v '^server/schema.js:'` ne LIT pas `server/` : il
 * filtre une sortie sur un motif qui lui ressemble. Une sonde qui confondrait les deux inventerait
 * un coupable — la classe de défaut que ce dépôt a déjà payée trois fois.
 */
export const sansCitations = (ligne) => ligne.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");

/** Vrai si un jeton est un drapeau qui contient `-a` (seul, groupé, ou sous sa forme longue). */
export const porteLeDrapeau = (jeton) =>
  jeton === "--text" || (/^-[A-Za-z]+$/.test(jeton) && jeton.slice(1).includes("a"));

/** Vrai si un jeton désigne un fichier ou un glob sous une racine de source. */
export const viseDuSource = (jeton) =>
  RACINES_SOURCE.some((r) => jeton === r || jeton === `${r}/` || jeton.startsWith(`${r}/`));

/**
 * Les appels à `grep` d'une ligne, un par segment de tube, avec ce qu'ils lisent et leurs drapeaux.
 *
 * Le découpage sur `|` est ce qui permet de juger `grep … | grep …` : dans un tube, seul le premier
 * lit des fichiers, le second lit l'entrée standard — et n'a donc aucun angle mort à combler.
 */
export function appelsGrep(ligne) {
  // ⚠️ LES CITATIONS D'ABORD, LA PONCTUATION ENSUITE — L'ORDRE EST LOAD-BEARING. Un motif cité peut
  // contenir une parenthèse (`'aLaColonne('`) : neutraliser la ponctuation avant de retirer les
  // citations couperait le motif en deux et ferait apparaître des jetons qui n'existent pas.
  const nue = sansCitations(ligne);
  const appels = [];
  for (const segment of nue.split("|")) {
    // ⚠️ ET LA PONCTUATION DOIT PARTIR, SINON LA GARDE EST VERTE SUR SES PROPRES CAS. Première
    // écriture de ce fichier : elle cherchait le jeton `grep` et rendait « aucun angle mort » sur un
    // dépôt qui en portait trois — parce que le jeton réel est `sans_commentaires=$(grep`, jamais
    // `grep`. Verte, et fausse. C'est la question 2 d'`AGENTS.md` (« le sujet pouvait-il être là ? »)
    // sur la garde qui vient l'écrire ; le banc porte ce cas nommément.
    const jetons = segment.replace(/&&|\|\||[$`(){};]/g, " ").trim().split(/\s+/).filter(Boolean);
    const debut = jetons.findIndex((j) => j === "grep" || j.endsWith("/grep"));
    if (debut < 0) continue;
    const suite = jetons.slice(debut + 1);
    appels.push({
      chemins: suite.filter(viseDuSource),
      arme: suite.some(porteLeDrapeau),
    });
  }
  return appels;
}

/**
 * Tous les appels à `grep` des blocs, chacun avec le bloc qui le porte.
 *
 * ⚠️ UNE SEULE TRAVERSÉE POUR LE JUGE ET POUR LE TÉMOIN, et c'est la raison d'être de cette
 * fonction. Un témoin qui referait ce parcours éprouverait une COPIE de la sonde : dévier
 * l'originale le laisserait vert sur son exemplaire intact, et le compte qu'il imprime serait
 * celui d'un chemin que personne ne juge.
 */
export function* appelsDesBlocs(blocs) {
  for (const b of blocs) {
    for (const ligne of b.run.split("\n")) {
      // Une ligne de commentaire shell n'est pas exécutée : l'accuser inventerait un coupable.
      if (/^\s*#/.test(ligne)) continue;
      for (const appel of appelsGrep(ligne)) yield { bloc: b, appel };
    }
  }
}

/** Les blocs `run:` où un `grep` lit du source sans `-a`. */
export function angesMorts(blocs) {
  const soucis = [];
  for (const { bloc: b, appel } of appelsDesBlocs(blocs)) {
    if (!appel.chemins.length || appel.arme) continue;
    soucis.push(
      `${b.fichier} › ${b.job} › ${b.nom} : « grep » lit ${appel.chemins.join(", ")} sans « -a » — ` +
      "un fichier contenant un octet de contrôle en disparaîtrait SANS un mot",
    );
  }
  return soucis;
}

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — DEUX CÉCITÉS, DONC DEUX COMPTES.
 *
 * Cette garde affirme une ABSENCE. Sa panne la plus probable — une sonde qui ne reconnaît plus la
 * forme d'un appel — produit elle aussi une absence : cent douze blocs verts sans rien avoir
 * mesuré. Le plancher qui existait comptait les BLOCS LUS, pas la FORME RECONNUE ; il est placé un
 * maillon trop tôt dans la chaîne.
 *
 * Mesuré le 31/08 en forçant `findIndex` à rendre -1 : l'outil imprimait « 112 bloc(s) « run: »
 * relus, aucun « grep » ne lit du source sans « -a » » et sortait 0. Le message AFFIRMAIT avoir
 * regardé des `grep` ; il n'en avait reconnu aucun. C'est la phrase la moins relue d'une course
 * verte, parce qu'elle porte l'autorité d'une mesure sans en porter la charge.
 *
 * ⚠️ ET DEUX SONDES SE SUCCÈDENT ICI, PAS UNE. `appelsGrep` reconnaît l'appel ; `viseDuSource`
 * reconnaît qu'il lit du code de ce dépôt. Aveugler la seconde suffit à tout blanchir sans
 * toucher à la première — un seul compte laisserait cette cécité-là ouverte.
 */
export function temoinsDeForme(blocs) {
  let greps = 0;
  let surSource = 0;
  for (const { appel } of appelsDesBlocs(blocs)) {
    greps += 1;
    if (appel.chemins.length) surSource += 1;
  }
  return { greps, surSource };
}

export function verifier(dossier = DOSSIER, lire = readFileSync, lister = readdirSync) {
  return tenter(() => {
    const fichiers = lister(dossier).filter((f) => /\.ya?ml$/.test(f));
    const blocs = fichiers.flatMap((f) => blocsDe(f, String(lire(join(dossier, f), "utf8"))));
    // ⚠️ LE PLANCHER. Un dossier renommé, un lecteur qui rend du vide, et la garde dirait « aucun
    // angle mort » sur zéro bloc lu — la vacuité qu'elle est écrite pour interdire.
    if (!blocs.length) {
      return inconclusif(`aucun bloc « run: » relevé dans ${dossier} — la sonde vise à côté`);
    }
    // ⚠️ LES DEUX PLANCHERS DE FORME, AVANT LE VERDICT. Ils comptent ce que la sonde RECONNAÎT ;
    // celui du dessus ne compte que ce que le lecteur a OUVERT.
    const { greps, surSource } = temoinsDeForme(blocs);
    if (greps < PLANCHER_GREPS) {
      return inconclusif(`aucun appel à « grep » reconnu dans ${blocs.length} bloc(s) « run: » — ce n'est pas une absence d'angle mort, c'est une sonde qui ne lit plus la forme d'un appel`);
    }
    if (surSource < PLANCHER_SUR_SOURCE) {
      return inconclusif(`aucun des ${greps} « grep » reconnus ne vise une racine de source (${RACINES_SOURCE.join(", ")}) — la règle n'a plus de sujet ici, et un vert ne dirait rien`);
    }
    const soucis = angesMorts(blocs);
    if (soucis.length) return violation(soucis);
    return conforme(`${blocs.length} bloc(s) « run: » relus, ${greps} appel(s) à « grep » reconnu(s) dont ${surSource} lisant du source, aucun sans « -a »`);
  });
}

if (estExecuteDirectement(import.meta.url)) conclure(verifier(process.argv[2] || DOSSIER));
