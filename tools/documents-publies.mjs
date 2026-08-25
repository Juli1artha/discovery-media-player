// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LE PAQUET PROMET DE PORTER, CONFRONTÉ À CE QU'IL PORTE.
//
// ⚠️ LE CHANGELOG NE VOYAGE PAS, ET C'EST DÉSORMAIS DÉCIDÉ (0.1.134). Il ne partait pas, et
// personne ne l'avait décidé : `package.json#files` nommait le README, les licences et deux
// documents de `docs/` ajoutés par #176 avec leur raison écrite ; le CHANGELOG n'apparaissait dans
// aucune de ces discussions. Il a d'abord été ajouté ici, au motif que #176 s'appliquait « mot pour
// mot ». C'ÉTAIT FAUX, et l'essai qui les sépare est celui-ci : retire le document — une
// OBLIGATION devient-elle invérifiable ? Retirer le contrat d'hôte ou la politique de rétention,
// oui : l'intégrateur ne peut plus vérifier sa conformité hors ligne. Retirer le CHANGELOG, non :
// il perd une histoire, pas une obligation. « Une promesse, pas une supposition » parle de la
// surface d'ENGAGEMENT ; un journal n'en est pas une.
//
// ⚠️ ET LE PRIX ÉTAIT MESURÉ : 257 Ko, +29 % sur le tarball compressé (320 660 → 414 680 octets),
// 21,5 % du paquet déballé, payé à chaque installation, à croissance non bornée — une section de
// plus par version. Pour de la prose dont le meilleur lecteur est mieux servi par
// `git log vX..vY`. L'argument « sans réseau » ne tenait pas non plus : qui peut faire
// `npm install` a du réseau, donc a le dépôt.
//
// ⚠️ CE QUI A TRANCHÉ N'EST PAS LE RAISONNEMENT, C'EST UN RELEVÉ. L'hôte de production a monté
// quatre versions (0.1.131 à 0.1.134) et ouvert le CHANGELOG ZÉRO fois : la question qu'il avait à
// trancher était « sommes-nous exposés ? », et la réponse n'était pas dans un journal — elle était
// dans le corps du commit puis dans une requête sur ses propres données. Une ligne de changelog lui
// aurait appris qu'un correctif existe, pas s'il était concerné.
//
// ⚠️ ET UNE ABSENCE RESSEMBLE À UNE DÉCISION. C'est ce qui rend ce défaut coûteux : rien ne
// distinguait « on a choisi de ne pas l'envoyer » de « personne n'y a pensé ». Retirer une ligne
// de `files` reste aujourd'hui indolore ; la garde de langue rendrait quatre documents au lieu de
// cinq et resterait verte. La promesse s'évaporerait sans bruit.
//
// ⚠️ LA CONFRONTATION VA DANS LES DEUX SENS, ET LE CONTRAIRE ÉTAIT ÉCRIT ICI. La première version
// refusait une promesse rompue et TOLÉRAIT un document voyageant sans être promis, au motif que
// `docs/README.md` partait « parce que npm développe `docs/` » — donc légitimement.
//
// C'ÉTAIT FAUX SUR LES DEUX POINTS. `files` ne nomme pas `docs/`, et la mesure donne la vraie
// raison : une entrée NUE de `files` n'est pas un chemin, c'est un MOTIF, et npm le fait
// correspondre à n'importe quelle profondeur. `"README.md"` valait donc `**/README.md` et ramenait
// `docs/README.md` avec lui. Isolé en quatre essais :
//
//     files: ["docs/HOST-CONTRACT.md"]               → docs/README.md absent
//     files: ["README.md", "docs/HOST-CONTRACT.md"]  → docs/README.md PART
//     files: ["./README.md", …] ou ["/README.md", …] → docs/README.md absent
//
// Ce document ne voyageait donc pas par décision : il voyageait par accident, et j'ai pris
// l'accident pour une intention au point d'en tirer une règle. Il partait en portant un SOMMAIRE
// DE DIX-SEPT DOCUMENTS QUE LE PAQUET NE CONTIENT PAS — un index vers du vide chez l'intégrateur.
//
// La ligne `README.md` a été retirée de `files` : npm inclut TOUJOURS le README racine, ce que
// cette garde vérifie à chaque exécution plutôt que de le supposer.
//
// ⚠️ ET C'EST LA SYMÉTRIE QUI MANQUAIT. Le défaut d'origine était « une absence ressemble à une
// décision » ; son miroir est « une présence aussi ». Un document qui voyage sans être promis n'a
// été voulu par personne — on l'accuse donc, et l'accusation nomme le document.
//
// ⚠️ LA SYMÉTRIE NE PORTE QUE SUR LES DOCUMENTS, PAS SUR LES 62 FICHIERS. Exiger la liste exacte
// de tout ce qui part serait un second exemplaire de `files` que rien ne confronterait — la faute
// même que ce fichier corrige. Le périmètre est ce qu'un HUMAIN LIT : les Markdown et les
// licences. Le code, lui, est décrit par `exports` et gardé par `surface-publique`.
//
// Usage : node tools/documents-publies.mjs

import { fichiersDuTarball } from "./inventaire-tarball.mjs";
import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * Les documents dont le paquet répond, et pourquoi. Une entrée n'est pas un fichier qu'on trouve
 * pratique : c'est une chose qu'un intégrateur peut lire dans `node_modules` sans réseau.
 */
export const PROMIS = {
  "README.md": "ce que fait le produit, et comment le brancher",
  "LICENSE": "les conditions sous lesquelles le paquet est utilisé",
  "LICENSE-MIT": "la seconde licence, celle du noyau",
  "docs/HOST-CONTRACT.md": "le contrat d'hôte, aussi résolvable par le sous-chemin « ./contrat »",
  "docs/RETENTION.md": "le périmètre déclaré de la rétention, aussi résolvable par « ./retention »",
};

/**
 * Ce qu'un humain LIT dans le tarball : les Markdown et les licences. Le reste est du code, décrit
 * par `exports` et gardé par `surface-publique` — ce n'est pas la matière de cette garde.
 */
export const documentsDe = (inventaire) =>
  inventaire.filter((f) => /\.md$/i.test(f) || /(^|\/)LICEN[CS]E/i.test(f));

/** Les promesses que l'inventaire ne tient pas, avec leur raison — pour qu'on lise ce qu'on perd. */
export const promessesRompues = (inventaire) =>
  Object.entries(PROMIS)
    .filter(([chemin]) => !inventaire.includes(chemin))
    .map(([chemin, pourquoi]) => `${chemin} ne part pas dans le tarball — le paquet le promet pour : ${pourquoi}`);

/** Les documents qui voyagent sans que personne l'ait décidé — le miroir du défaut d'origine. */
export const voyageursNonDecides = (inventaire) =>
  documentsDe(inventaire)
    .filter((chemin) => !(chemin in PROMIS))
    .map((chemin) => `${chemin} part dans le tarball sans être promis — personne ne l'a décidé : soit on l'inscrit ici avec sa raison, soit on l'exclut de « files »`);

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : `npm pack` peut échouer et `fichiersDuTarball` lève sur un inventaire vide.
  // Ni l'un ni l'autre ne dit qu'une promesse est rompue — ils disent qu'on n'a pas pu regarder.
  conclure(tenter(() => {
    const inventaire = fichiersDuTarball();
    const soucis = [...promessesRompues(inventaire), ...voyageursNonDecides(inventaire)];
    if (soucis.length) return violation(soucis);
    const docs = documentsDe(inventaire);
    return conforme(`documents du tarball : ${docs.length}, tous promis et tous présents — ${docs.join(", ")} (${inventaire.length} fichiers au total)`);
  }));
}
