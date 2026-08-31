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

/**
 * ⚠️ CE QUI EST HORS PORTÉE, ET RIEN D'AUTRE — une liste de ce qui est PERMIS, jamais de ce qu'il
 * faut regarder.
 *
 * La portée était écrite dans l'autre sens : `AGENTS.md|README.md|CONTRIBUTING.md|SECURITY.md` plus
 * `docs/`. Un périmètre qui a l'air dérivé — `markdowns()` descend tout l'arbre — avec une
 * ÉNUMÉRATION dans son filtre. Une liste de ce qu'il faut REGARDER cesse de couvrir dès qu'un
 * fichier apparaît ; une liste de ce qui est PERMIS fait rougir tout fichier qui n'y est pas.
 *
 * Mesuré le 31/08, le même renvoi posé deux fois, mot pour mot :
 *
 *     docs/zz-sonde.md  « Voir la ligne 42 du fichier. »   → exit 1, vu
 *     GOUVERNANCE.md    « … à la ligne 42 de ce document » → exit 0, INVISIBLE
 *
 * Seul le chemin changeait. Cinq documents de ce dépôt étaient déjà dehors sans décision :
 * CLA, CODE_OF_CONDUCT, MAINTAINERS, ROADMAP, SUPPORT.
 *
 * ⚠️ ET L'EXCEPTION QUI RESTE EST UNE VRAIE. Un renvoi dans le journal décrit l'état d'un commit
 * passé, pas l'état courant : il ne rouille pas, il enregistre. Le corriger réécrirait l'histoire.
 * C'est le seul document du dépôt qui portait le motif hors de l'ancienne portée — mesuré, pas
 * supposé : 2 renvois dans `CHANGELOG.md`, zéro partout ailleurs.
 */
export const HORS_PORTEE = {
  "CHANGELOG.md": "journal : un renvoi y décrit l'état d'un commit passé, pas l'état courant — le corriger réécrirait l'histoire",
};

/** Les documents dont on se sert pour NAVIGUER — ceux où un renvoi prétend désigner l'état courant. */
export const estUnGuide = (chemin) => !Object.hasOwn(HORS_PORTEE, chemin);

/**
 * ⚠️ UNE EXCEPTION QUI N'A PLUS DE SUJET EST UNE PORTE OUVERTE D'AVANCE. Le jour où `CHANGELOG.md`
 * est renommé, l'entrée survit et un futur fichier à ce chemin exact serait exempté SANS décision.
 * Ce dépôt tient déjà cette règle pour `FICHIERS_MIT` et `INTERNES_TOLERES` ; elle vaut ici aussi.
 *
 * ⚠️ ET ELLE VIT DANS LE BANC, PAS DANS LA GARDE. `verifier(racine)` prend une racine QUELCONQUE et
 * les éprouvettes lui passent des dépôts temporaires : appliquée ici, elle accuserait chaque
 * éprouvette de ne pas contenir de journal. Un contrôle d'exception appartient là où le SUJET est
 * connu — la même leçon que la garde des licences a payée le 31/08.
 */
export function exceptionsSansSujet(fichiers) {
  const vus = new Set(fichiers);
  return Object.keys(HORS_PORTEE).filter((f) => !vus.has(f))
    .map((f) => `« ${f} » est déclaré hors portée et ne figure plus parmi les documents relevés — RETIREZ l'entrée de HORS_PORTEE, ou corrigez le chemin`);
}

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

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — INJECTÉ, PAS DÉRIVÉ.
 *
 * Cette garde affirme une ABSENCE. Sa panne la plus probable — une sonde qui ne reconnaît plus la
 * forme cherchée — produit elle aussi une ABSENCE : tout le périmètre vert sans rien avoir mesuré.
 * Le plancher qui existait compte les FICHIERS LUS, jamais la FORME RECONNUE. Mesuré le 31/08 en
 * aveuglant la sonde : l'outil imprimait son résumé complet et sortait 0.
 *
 * Le témoin est INJECTÉ parce que l'état sain de cette règle est justement ZÉRO occurrence de ce
 * qu'elle cherche : il n'y a rien à dériver du dépôt. On pose donc un cas dont on sait qu'il est
 * fautif, on vérifie que la sonde le VOIT, on le jette — le mécanisme de l'étape RLS de `ci.yml`,
 * qui le pratique depuis des semaines sur les politiques Postgres.
 */
export function temoinNonVu(voir = renvois) {
  // ⚠️ ÉCRIT EN CLAIR, ET C'EST SANS DANGER ICI : cette garde ne lit que les documents Markdown de
  // navigation (`estUnGuide`), jamais son propre source. C'est la PORTÉE qui la protège, comme son
  // en-tête le dit — pas une exemption, qu'il faudrait ensuite surveiller.
  return voir("voir lignes 12 du fichier").length ? null
    : "la sonde n'a pas vu un renvoi par position qu'on venait de poser";
}

export function verifier(racine = ".", lire = readFileSync, lister = readdirSync, decrire = statSync) {
  return tenter(() => {
    const tous = markdowns(racine, lister, decrire);
    const fichiers = tous.filter(estUnGuide);
    // ⚠️ LE PLANCHER. Zéro document relevé et la garde dirait « aucun renvoi fautif » — sur un dépôt
    // dont elle n'aurait rien lu. C'est la vacuité que ce dépôt refuse partout.
    if (!fichiers.length) return inconclusif(`aucun document de navigation relevé sous ${racine} — la sonde vise à côté`);

    const aveugle = temoinNonVu();
    if (aveugle) return inconclusif(`${aveugle} — ce n'est pas une absence de renvoi fautif, c'est une sonde qui ne lit plus la forme`);

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
    return conforme(`${fichiers.length} document(s) de navigation relus, sonde confirmée par un témoin posé, aucun renvoi par numéro de ligne`);
  });
}

if (estExecuteDirectement(import.meta.url)) conclure(verifier(process.argv[2] || "."));
