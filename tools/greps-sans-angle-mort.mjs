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

/** Les blocs `run:` où un `grep` lit du source sans `-a`. */
export function angesMorts(blocs) {
  const soucis = [];
  for (const b of blocs) {
    for (const ligne of b.run.split("\n")) {
      // Une ligne de commentaire shell n'est pas exécutée : l'accuser inventerait un coupable.
      if (/^\s*#/.test(ligne)) continue;
      for (const appel of appelsGrep(ligne)) {
        if (!appel.chemins.length || appel.arme) continue;
        soucis.push(
          `${b.fichier} › ${b.job} › ${b.nom} : « grep » lit ${appel.chemins.join(", ")} sans « -a » — ` +
          "un fichier contenant un octet de contrôle en disparaîtrait SANS un mot",
        );
      }
    }
  }
  return soucis;
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
    const soucis = angesMorts(blocs);
    if (soucis.length) return violation(soucis);
    return conforme(`${blocs.length} bloc(s) « run: » relus, aucun « grep » ne lit du source sans « -a »`);
  });
}

if (estExecuteDirectement(import.meta.url)) conclure(verifier(process.argv[2] || DOSSIER));
