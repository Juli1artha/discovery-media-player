// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN LIEN RELATIF DANS UN DOCUMENT PUBLIÉ DOIT MENER QUELQUE PART DANS LE PAQUET.
//
// ⚠️ NEUF DES DOUZE LIENS RELATIFS DU README POINTAIENT DANS LE VIDE une fois le paquet installé
// (constaté en 0.1.134). `docs/API.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`,
// le CLA — aucun de ces fichiers ne voyage. Sur npmjs.com la page se rend et les liens sont
// réécrits vers le dépôt ; dans `node_modules`, il n'y a rien contre quoi les résoudre.
//
// ⚠️ ET C'EST EXACTEMENT LE LECTEUR AU NOM DUQUEL ON ARGUMENTAIT. La discussion sur le CHANGELOG
// portait sur « l'intégrateur qui n'a pas de réseau » ; celui-là, précisément, ouvrait le README
// livré et cliquait dans le vide. Le document qu'on lui donne renvoyait vers douze autres dont
// trois seulement existaient chez lui.
//
// ⚠️ LA RÈGLE N'EST PAS « PAS DE LIEN RELATIF ». Un lien relatif vers un fichier QUI VOYAGE est le
// bon outil : il fonctionne dans le dépôt, sur npmjs.com et hors ligne. C'est le lien relatif vers
// un fichier ABSENT qui ment. La règle se dérive donc de l'inventaire, elle ne se liste pas : un
// document qu'on ajoute au paquet rend légitimes les liens qui le visent, sans rien à modifier ici.
//
// Usage : node tools/liens-des-documents.mjs

import { readFileSync } from "node:fs";
import { posix } from "node:path";

import { fichiersDuTarball } from "./inventaire-tarball.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Un lien externe, une ancre ou un courriel ne se résout pas dans le paquet — ils ne nous regardent pas. */
const EXTERNE = /^(https?:|#|mailto:|tel:|ftp:)/i;

/**
 * Les liens relatifs d'un Markdown, AVEC LEUR LIGNE.
 *
 * ⚠️ La ligne n'est pas un ornement : trois gardes de ce dépôt connaissaient la position d'un
 * défaut et ne la disaient pas, et c'est un correctif entier (#348). On la porte dès l'origine.
 *
 * ⚠️ Les blocs de code sont NEUTRALISÉS PAR DES LIGNES BLANCHES, pas supprimés — sans quoi toutes
 * les lignes suivantes seraient décalées et la garde désignerait un endroit faux. Une position
 * fausse se lit comme une position juste ; c'est pire que pas de position du tout.
 */
export function liensRelatifs(texte) {
  const lignes = String(texte).split("\n");
  let dansUnBloc = false;
  const trouves = [];
  lignes.forEach((ligne, i) => {
    if (/^\s*```/.test(ligne)) { dansUnBloc = !dansUnBloc; return; }
    if (dansUnBloc) return;
    for (const [, texteDuLien, cible] of ligne.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (EXTERNE.test(cible)) continue;
      trouves.push({ ligne: i + 1, texte: texteDuLien, cible });
    }
  });
  return trouves;
}

/** Où mène un lien, vu depuis le document qui le porte — sans son ancre. */
export const cibleResolue = (documentSource, cible) =>
  posix.normalize(posix.join(posix.dirname(documentSource), cible.split("#")[0])).replace(/\/+$/, "");

/**
 * Les liens qui mentent, nommés `fichier:ligne`.
 * `lire` est injectable : les cas synthétiques du banc n'ont pas de fichiers sur le disque.
 */
export function* liensLus(inventaire, lire = (f) => readFileSync(f, "utf8")) {
  for (const document of inventaire.filter((f) => /\.md$/i.test(f))) {
    for (const lien of liensRelatifs(lire(document))) yield { document, ...lien };
  }
}

// ⚠️ UN PLANCHER À UN, ET LE RELEVÉ DIT POURQUOI. Deux liens relatifs reconnus le 31/08 dans les
// trois documents du tarball, tous deux du README vers ses licences (LICENSE, LICENSE-MIT). « Au
// moins un » est vrai de tout état sain d'un paquet qui doit embarquer ses licences et les
// nommer ; un plancher plus haut serait collé au relevé du jour, sur une population de deux.
export const PLANCHER_LIENS = 1;

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — combien de liens relatifs la sonde RECONNAÎT.
 *
 * Cette garde affirme une absence. Sa panne la plus probable — une expression qui ne reconnaît
 * plus la forme `[texte](cible)` — produit elle aussi une absence : les documents publiés verts
 * sans qu'un seul lien ait été suivi. Le plancher qui existait comptait les DOCUMENTS PUBLIÉS,
 * pas la FORME RECONNUE.
 *
 * Mesuré le 31/08 en vidant la boucle de `matchAll` : l'outil imprimait « 3 document(s)
 * publié(s), aucun lien relatif ne mène hors du paquet » et sortait 0. Il affirmait une propriété
 * de liens qu'il n'avait pas lus.
 */
export const temoinsDeForme = (inventaire, lire = (f) => readFileSync(f, "utf8")) =>
  [...liensLus(inventaire, lire)].length;

export function liensMorts(inventaire, lire = (f) => readFileSync(f, "utf8")) {
  const present = new Set(inventaire);
  const soucis = [];
  for (const { document, ligne, texte, cible } of liensLus(inventaire, lire)) {
    const resolue = cibleResolue(document, cible);
    if (!present.has(resolue)) {
      soucis.push(`${document}:${ligne} — « ${texte} » mène à « ${cible} », qui ne voyage pas dans le paquet : le lecteur hors ligne clique dans le vide (mettre une URL absolue, ou publier le fichier)`);
    }
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : `npm pack` peut échouer et l'inventaire vide LÈVE. Ni l'un ni l'autre ne dit
  // qu'un lien ment — ils disent qu'on n'a pas pu regarder.
  conclure(tenter(() => {
    const inventaire = fichiersDuTarball();
    // ⚠️ LE PLANCHER DE FORME, AVANT LE VERDICT. Il compte ce que la sonde RECONNAÎT ; le compte
    // des documents ne dit que ce qui a été OUVERT.
    const vus = temoinsDeForme(inventaire);
    const docs = inventaire.filter((f) => /\.md$/i.test(f));
    if (vus < PLANCHER_LIENS) {
      return inconclusif(`${vus} lien(s) relatif(s) reconnu(s) dans ${docs.length} document(s) publié(s), moins que ${PLANCHER_LIENS} — ce n'est pas une absence de lien mort, c'est une sonde qui ne lit plus la forme d'un lien`);
    }
    const soucis = liensMorts(inventaire);
    if (soucis.length) return violation(soucis);
    return conforme(`liens : ${vus} lien(s) relatif(s) reconnu(s) dans ${docs.length} document(s) publié(s), aucun ne mène hors du paquet`);
  }));
}
