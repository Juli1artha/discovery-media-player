// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN RENVOI PAR NUMÉRO DE LIGNE EST UN NOMBRE AU PRÉSENT — IL ROUILLE À LA PREMIÈRE ÉDITION.
//
// ⚠️ CE QUI EST ARRIVÉ, ET C'EST `AGENTS.md` QUI L'A FAIT. Ce fichier porte, depuis le 27/08, une
// section entière intitulée « A number in the present tense rots; a number in the past tense is a
// fact ». Deux cents lignes plus haut, il renvoyait DEUX FOIS à `docs/HOST-CONTRACT.md` par numéro
// de ligne. Les deux étaient faux — pas « devenus faux un jour », faux dès le commit suivant qui a
// touché la page visée, donc quelques heures après avoir été écrits :
//
//     « line 243 of docs/HOST-CONTRACT.md was a table row swallowed… »   → y trouvait « |---|---| »
//     « …while line 268 explains the fifth at length »                   → une ligne vide, puis un
//                                                                          autre sujet ; l'explication
//                                                                          avait glissé de trente lignes
//
// ⚠️ UN NUMÉRO DE LIGNE EST LE NOMBRE AU PRÉSENT LE PLUS FRAGILE QUI SOIT. Un compte de tests
// survit à une édition qui n'ajoute pas de test ; un numéro de ligne ne survit à AUCUNE insertion
// au-dessus de lui, dans un fichier qu'on n'édite même pas. Trois commits de documentation ont
// suffi, dont un qui ajoutait neuf lignes en tête de la page visée.
//
// ⚠️ ET IL ROUILLE EN SILENCE, DU CÔTÉ DU LECTEUR. C'est un hôte qui l'a nommé, en vérifiant nos
// renvois : « un lecteur qui ouvre 84 en cherchant les deux instruments lit le décompte, ne trouve
// pas ce qu'il cherche, et peut conclure à une ABSENCE ». Le renvoi périmé ne rend pas une erreur :
// il rend un autre contenu, plausible, et fabrique un constat de manque là où il n'y a rien qui
// manque. C'est le champ « que personne ne relit parce qu'il est presque toujours juste ».
//
// ⚠️ LE REMÈDE EST DE DÉSIGNER PAR L'OBJET, JAMAIS PAR LA POSITION : citer la phrase, nommer la
// ligne du tableau, donner le titre de section. Un renvoi par l'objet se répare tout seul quand le
// texte bouge, et se voit quand le texte disparaît.
//
// ⚠️ CE QUE CETTE GARDE LIT, ET POURQUOI PAS LE RESTE. Elle vise les documents dont on se sert pour
// NAVIGUER AUJOURD'HUI — `AGENTS.md`, `README.md`, `docs/`. Elle laisse `CHANGELOG.md` et les
// commentaires de code, et ce n'est pas une liste blanche d'exceptions : c'est une classe. Une
// section de changelog est DATÉE ET FIGÉE — « l'index unique (ligne 62) tournait avant l'ALTER de
// rattrapage (ligne 410) » décrit `init.sql` tel qu'il était en 0.1.64, au passé, et personne n'y
// va pour trouver son chemin. Le renvoi que cette garde refuse est celui qui PRÉTEND désigner
// l'état courant, dans une page qu'on ouvre pour s'orienter.
//
// ⚠️ ET ELLE ATTRAPE LE RENVOI NU, PAS SEULEMENT CELUI QUI NOMME UN FICHIER — mesuré, parce que la
// première écriture ne prenait que le second et laissait passer l'autre défaut réel. Un renvoi nu
// est PIRE : le lecteur ne sait même pas quelle page ouvrir.
//
// Usage : node tools/renvois-par-position.mjs [racine]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const IGNORES = new Set(["node_modules", ".git", "dist", "coverage", ".github"]);

/**
 * Un renvoi qui désigne une position — « line 243 », « ligne 62 » — qu'il nomme un fichier ou non.
 *
 * ⚠️ LA PREMIÈRE ÉCRITURE EXIGEAIT LE NOM DU FICHIER, ET RATAIT LA MOITIÉ DU DÉFAUT QUI L'A MOTIVÉE.
 * Sur les deux renvois périmés d'`AGENTS.md`, elle n'en voyait qu'un : l'autre — « while line 268
 * explains the fifth at length » — ne nomme rien, et c'est le PIRE des deux, puisque le lecteur ne
 * sait même pas quelle page ouvrir. Mesuré en rejouant la sonde sur la version d'avant correction :
 * 1 trouvé sur 2 existants. Le motif est donc nu, et c'est la PORTÉE (`estUnGuide`) qui empêche
 * cette garde d'accuser la prose qui la raconte.
 */
export const MOTIF = /\b(?:lines?|lignes?)\s+\d+/gi;

/** Les documents dont on se sert pour NAVIGUER — ceux où un renvoi prétend désigner l'état courant. */
export const estUnGuide = (chemin) =>
  /^(AGENTS\.md|README\.md|CONTRIBUTING\.md|SECURITY\.md)$/.test(chemin) || chemin.startsWith("docs/");

/** Les renvois par position d'un texte, avec leur numéro de ligne à eux. */
export function renvois(texte) {
  const trouves = [];
  texte.split("\n").forEach((ligne, i) => {
    for (const m of ligne.matchAll(MOTIF)) trouves.push({ ligne: i + 1, extrait: m[0] });
  });
  return trouves;
}

/** Tous les fichiers Markdown sous une racine, chemins relatifs. */
export function markdowns(racine, lister = readdirSync, decrire = statSync) {
  const vus = [];
  const descendre = (dossier) => {
    for (const entree of lister(dossier)) {
      if (IGNORES.has(entree)) continue;
      const chemin = join(dossier, entree);
      if (decrire(chemin).isDirectory()) descendre(chemin);
      else if (/\.md$/i.test(entree)) vus.push(relative(racine, chemin));
    }
  };
  descendre(racine);
  return vus;
}

export function verifier(racine = ".", lire = readFileSync, lister = readdirSync, decrire = statSync) {
  return tenter(() => {
    const fichiers = markdowns(racine, lister, decrire).filter(estUnGuide);
    // ⚠️ LE PLANCHER. Zéro document relevé et la garde dirait « aucun renvoi fautif » — sur un dépôt
    // dont elle n'aurait rien lu. C'est la vacuité que ce dépôt refuse partout.
    if (!fichiers.length) return inconclusif(`aucun document de navigation relevé sous ${racine} — la sonde vise à côté`);

    const constats = [];
    for (const f of fichiers) {
      for (const r of renvois(String(lire(join(racine, f), "utf8")))) {
        constats.push(
          `${f}:${r.ligne} renvoie par POSITION — « ${r.extrait} ». Un numéro de ligne est un nombre ` +
          "au présent : il rouille à la première insertion au-dessus de lui, et un lecteur qui suit " +
          "le renvoi périmé lit autre chose et conclut à une absence. Désignez par l'objet — citez la " +
          "phrase, nommez la ligne du tableau, donnez le titre de section.",
        );
      }
    }
    if (constats.length) return violation(constats);
    return conforme(`${fichiers.length} document(s) de navigation relus, aucun renvoi par numéro de ligne`);
  });
}

if (estExecuteDirectement(import.meta.url)) conclure(verifier(process.argv[2] || "."));
