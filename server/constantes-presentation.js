// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE FEUILLE, ET C'EST TOUT CE QU'ELLE EST — ELLE N'IMPORTE RIEN, DONC ELLE NE PEUT FERMER AUCUN CYCLE.
//
// ⚠️ CE FICHIER NAÎT D'UN CYCLE MESURÉ, PAS D'UN GOÛT POUR LE RANGEMENT. Un audit externe a relevé
// le 11/09 le seul cycle du graphe serveur : `schema.js` ↔ `presentations.js`, par cinq `require()`
// DYNAMIQUES croisés — écrits dans le corps des fonctions précisément parce qu'un `require` en tête
// aurait rendu le cycle visible à l'initialisation. Un cycle qu'on contourne par le placement de
// l'import est un cycle qu'on a caché, pas retiré.
//
// ⚠️ ET LA MOITIÉ DU CYCLE ÉTAIT UN PUR DÉTOUR. `schema.js` allait chercher `signatureAbsente` DANS
// `presentations.js`, qui l'importe lui-même de `erreurs-base.js` : trois modules pour une fonction
// qui en habite un. Corrigé en important à la source. L'autre moitié est ce fichier : un seuil de
// domaine que deux modules lisent, et qui n'appartenait qu'à l'un d'eux par accident d'écriture.

/**
 * Au-delà de ce silence, une présentation est ABANDONNÉE — pas muette.
 *
 * ⚠️ UN SEUL NOMBRE, PARCE QUE DEUX AURAIENT DIVERGÉ. Le présentateur bat toutes les 30 s
 * (`present-touch`). Ce seuil définit « vivante » pour le balayage des présentations orphelines ET
 * pour le comptage des présentations actives de la carte d'identité. Les deux doivent répondre la
 * même chose : une carte qui compte « actives » selon un autre seuil que celui qui les clôt
 * afficherait des présentations que le balayage vient de retirer.
 */
const STALE_MS = 3 * 60 * 1000;

module.exports = { STALE_MS };
