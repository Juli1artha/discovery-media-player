// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ACCORD ENTRE LES TITRES DU CHANGELOG ET LEURS RÉFÉRENCES DE COMPARAISON.
//
// ⚠️ Cette logique vivait EN LIGNE dans ci.yml. Le préflight de publication en a besoin aussi —
// et deux exemplaires d'une règle sont exactement ce que ce dépôt refuse partout ailleurs : ils
// divergent, personne ne les confronte, et le jour où l'un se corrige l'autre continue de bénir.
// Même raison que tools/plus-haut-tag.mjs, écrite après que trois endroits eurent chacun leur
// regex de tag. Un seul module décide, la forge et le préflight l'appellent.
//
// Rappel de ce qui a rendu cette garde nécessaire : les références se sont arrêtées à la 0.1.41
// pendant 77 versions — 76 titres pointaient dans le vide, et rien ne le disait. Puis une
// deuxième passe a montré qu'une référence PRÉSENTE pouvait être fausse : `compare/v0.1.40...
// v0.1.42` passait, alors que la version qui précède la 0.1.42 est la 0.1.41.

import { readFileSync } from "node:fs";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

export const DEPOT = "https://github.com/Juli1artha/discovery-media-player";

/** Les versions, dans l'ordre du fichier — la plus récente d'abord. */
export const sections = (txt) => [...txt.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);

/**
 * TOUS les titres de section tels qu'écrits — `[Unreleased]` compris, pas seulement les versions.
 *
 * ⚠️ CE QUE `sections` NE VOIT PAS, ET QUI EST ARRIVÉ. `sections` ne relève que les numéros de
 * version : `## [Unreleased]` écrit DEUX fois lui était invisible. C'est exactement ce que deux
 * branches produisent quand chacune ouvre la sienne — git fusionne les deux sans conflit, parce
 * qu'elles ne touchent pas les mêmes lignes.
 */
export const titres = (txt) => [...txt.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);

/**
 * Les titres écrits plus d'une fois.
 *
 * ⚠️ ET LA CONSÉQUENCE N'EST PAS COSMÉTIQUE : `sectionDe()` s'arrête au titre SUIVANT, donc elle
 * rend la première moitié et le préflight de sortie publie des notes amputées — sans que rien ne
 * manque à l'œil, puisque le fichier, lui, contient tout.
 */
export function titresRepetes(txt) {
  const comptes = new Map();
  for (const t of titres(txt)) comptes.set(t, (comptes.get(t) || 0) + 1);
  return [...comptes]
    .filter(([, n]) => n > 1)
    .map(([t, n]) => `section « ${t} » écrite ${n} fois — les notes de sortie s'arrêtent à la première, et la suite ne se publierait pas`);
}

/** Les références de bas de page, telles qu'écrites. */
export const references = (txt) =>
  new Map([...txt.matchAll(/^\[(\d+\.\d+\.\d+)\]: (.+)$/gm)].map((m) => [m[1], m[2].trim()]));

/**
 * L'URL qu'une version DOIT porter, dérivée de l'ORDRE RÉEL des sections.
 *
 * ⚠️ Jamais « patch − 1 » : l'historique a au moins une discontinuité (la 0.1.85 suit la 0.1.83),
 * et un calcul naïf accuserait une référence parfaitement juste. La version précédente est celle
 * que le fichier place en dessous, point.
 */
export function urlAttendue(versions, i) {
  const v = versions[i], precedente = versions[i + 1];
  return precedente ? `${DEPOT}/compare/v${precedente}...v${v}` : `${DEPOT}/releases/tag/v${v}`;
}

/** Tout ce qui cloche, en clair. Liste vide = le fichier est d'accord avec lui-même. */
export function ecarts(txt) {
  const versions = sections(txt);
  const refs = references(txt);
  const soucis = titresRepetes(txt);
  if (!versions.length) return ["aucune section de version — ce n'est pas un changelog"];

  versions.forEach((v, i) => {
    const attendu = urlAttendue(versions, i);
    const reel = refs.get(v);
    if (reel === undefined) soucis.push(`section ${v} sans référence`);
    else if (reel !== attendu) soucis.push(`référence ${v} : « ${reel} » au lieu de « ${attendu} »`);
    refs.delete(v);
  });
  for (const orpheline of refs.keys()) soucis.push(`référence ${orpheline} sans section`);

  const unreleased = [...txt.matchAll(/^\[Unreleased\]: (.+)$/gm)].map((m) => m[1].trim());
  const unrAttendu = `${DEPOT}/compare/v${versions[0]}...HEAD`;
  if (unreleased.length !== 1) soucis.push(`${unreleased.length} référence(s) [Unreleased] au lieu de 1`);
  else if (unreleased[0] !== unrAttendu) soucis.push(`[Unreleased] : « ${unreleased[0]} » au lieu de « ${unrAttendu} »`);

  return soucis;
}

/** Le bloc de références entier, régénéré depuis les titres. Ce qu'une sortie doit écrire. */
export function blocReferences(txt) {
  const versions = sections(txt);
  return [`[Unreleased]: ${DEPOT}/compare/v${versions[0]}...HEAD`,
    ...versions.map((_, i) => `[${versions[i]}]: ${urlAttendue(versions, i)}`)].join("\n");
}

/**
 * Le corps de la section d'une version — ce que la Release publie. Vide si absente.
 *
 * ⚠️ LA DERNIÈRE SECTION S'ARRÊTE AUSSI AU BLOC DE RÉFÉRENCES. Sans cette borne, extraire les
 * notes de la version la plus ancienne emporte TOUT le bloc de liens de bas de page — une ligne
 * par version publiée, donc il grossit à chaque sortie : la Release publierait un mur d'URL en
 * guise de notes. (Ce commentaire annonçait un compte de lignes PRÉCIS ; il avait dérivé de
 * quatre, et il n'apportait rien à ce qu'il explique. Un nombre écrit à côté du code est une
 * MESURE, pas une explication : il se démode, et il n'a aucun moyen de le dire. Le chiffre exact
 * n'est pas répété ici — le réécrire ressèmerait le motif que ce correctif retire.) Trouvé par le test de ce module, pas en
 * production — la plus ancienne version ne se republie jamais, donc rien ne l'aurait révélé.
 */
export function sectionDe(txt, version) {
  const debut = txt.indexOf(`## [${version}]`);
  if (debut === -1) return "";
  const apres = txt.slice(debut);
  const bornes = [apres.indexOf("\n## ["), apres.search(/\n\[(?:Unreleased|\d+\.\d+\.\d+)\]: /)]
    .filter((i) => i > 0);
  const fin = bornes.length ? Math.min(...bornes) : -1;
  return (fin === -1 ? apres : apres.slice(0, fin)).split("\n").slice(1).join("\n").trim();
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const txt = readFileSync("CHANGELOG.md", "utf8");
    // ⚠️ « AUCUNE SECTION » N'EST PAS UNE VIOLATION, C'EST UNE SONDE QUI NE VOIT RIEN. Le fichier
    // peut être illisible, renommé, ou son format d'entête avoir changé : dans les trois cas
    // l'auteur d'une branche n'y est pour rien, et lui rendre « corrige ta branche » lui apprend
    // que le rouge de cette garde est parfois du bruit. On le sépare AVANT d'appeler `ecarts`,
    // plutôt qu'en reconnaissant sa propre phrase d'erreur — une garde qui s'identifie à son
    // texte se casse au premier reformulage.
    const vues = sections(txt);
    if (!vues.length) return inconclusif("aucune section de version dans CHANGELOG.md — la sonde vise à côté, ou le fichier a changé de forme");
    const soucis = ecarts(txt);
    if (soucis.length) return violation(soucis.map((s) => "CHANGELOG désaccordé — " + s));
    return conforme(`changelog : ${vues.length} sections, aucun titre en double, chaque référence exacte, [Unreleased] à jour`);
  }));
}
