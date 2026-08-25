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
import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
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
export function liensMorts(inventaire, lire = (f) => readFileSync(f, "utf8")) {
  const present = new Set(inventaire);
  const soucis = [];
  for (const document of inventaire.filter((f) => /\.md$/i.test(f))) {
    for (const { ligne, texte, cible } of liensRelatifs(lire(document))) {
      const resolue = cibleResolue(document, cible);
      if (!present.has(resolue)) {
        soucis.push(`${document}:${ligne} — « ${texte} » mène à « ${cible} », qui ne voyage pas dans le paquet : le lecteur hors ligne clique dans le vide (mettre une URL absolue, ou publier le fichier)`);
      }
    }
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : `npm pack` peut échouer et l'inventaire vide LÈVE. Ni l'un ni l'autre ne dit
  // qu'un lien ment — ils disent qu'on n'a pas pu regarder.
  conclure(tenter(() => {
    const inventaire = fichiersDuTarball();
    const soucis = liensMorts(inventaire);
    if (soucis.length) return violation(soucis);
    const docs = inventaire.filter((f) => /\.md$/i.test(f));
    return conforme(`liens : ${docs.length} document(s) publié(s), aucun lien relatif ne mène hors du paquet`);
  }));
}
