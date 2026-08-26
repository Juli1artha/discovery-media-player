// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QU'UN EXPLOITANT COPIE DOIT CONTENIR CE QU'ON LUI DOCUMENTE.
//
// ⚠️ `.env.example` EST CE QU'UN EXPLOITANT COPIE. Une variable documentée qui n'y figure pas
// n'existe pas pour lui — il ne la découvre qu'en cherchant pourquoi quelque chose ne marche pas.
// `PLAYER_AUTH_URL` a vécu une demi-journée dans ce trou, le jour même de sa sortie : la doc
// l'annonçait, le fichier à copier l'ignorait.
//
// ⚠️ CETTE RÈGLE VIVAIT EN SHELL DANS ci.yml, ET ELLE LISAIT DE LA PROSE COMME DE LA DONNÉE. Elle
// relevait TOUT jeton majuscule entre accents graves de `docs/CONFIGURATION.md`. Le jour où la page
// a mentionné `SIGTERM`, `SIGINT` et `SIGKILL` — des noms de SIGNAUX, dans une phrase — elle les a
// exigés dans `.env.example`. Un contrôle qui demande de tordre la prose pour lui plaire apprend à
// ses lecteurs à écrire pour la machine.
//
// ⚠️ ET LE REMÈDE ÉVIDENT ÉTAIT PIRE QUE LE MAL — mesuré avant d'être écarté. « Ne lire que les
// titres `### `NOM`` » semblait propre : la page n'en porte que DEUX, alors qu'elle documente
// trente-neuf variables ailleurs (tableaux, mentions en ligne). La garde serait devenue verte en
// ne regardant presque plus rien. C'est le motif trop serré, quatrième fois de la semaine.
//
// ⚠️ CE QUI DISTINGUE VRAIMENT UNE VARIABLE D'UN MOT DE PROSE, c'est qu'elle EXISTE ailleurs : le
// code la lit, ou le fichier d'exemple la porte. `tools/env-lues.mjs` sait déjà lire le code par
// son AST — on lui demande plutôt que d'en tenir un second inventaire. Un jeton qui n'est ni lu ni
// présent dans l'exemple n'est pas une variable : c'est un mot. On l'écarte, et ON LE COMPTE — une
// garde qui tait ce qu'elle n'a pas regardé affirme une couverture qu'elle n'a pas.
//
// Usage : node tools/env-exemple.mjs

import { readFileSync } from "node:fs";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { inventaire } from "./env-lues.mjs";

export const DOC = "docs/CONFIGURATION.md";
export const EXEMPLE = ".env.example";

/** Les jetons que la documentation met en valeur — candidats, pas encore variables. */
export const citesDans = (texte) =>
  new Set([...texte.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]));

/** Les variables réellement posées dans le fichier d'exemple. */
export const posesDans = (texte) =>
  new Set([...texte.matchAll(/^([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]));

/**
 * Le désaccord entre les deux, plus ce qui a été écarté et pourquoi.
 *
 * `lues` vient de l'AST du code. Un candidat qui n'y est pas ET qui n'est pas dans l'exemple est
 * un mot de la langue, pas un réglage — c'est le seul critère qui ne demande à personne d'écrire
 * autrement qu'il ne parle.
 */
export function ecarts({ cites, poses, lues }) {
  // Trié : une sortie de garde se compare d'une exécution à l'autre, y compris dans un banc.
  const ecartes = [...cites].filter((n) => !lues.has(n) && !poses.has(n)).sort();
  const variables = [...cites].filter((n) => !ecartes.includes(n));
  const soucis = [];
  for (const n of variables) {
    if (!poses.has(n)) soucis.push(`${n} est documentée dans ${DOC} mais absente de ${EXEMPLE} — un exploitant qui copie ce fichier ne la découvrira qu'en cherchant pourquoi quelque chose ne marche pas`);
  }
  for (const n of poses) {
    if (!cites.has(n)) soucis.push(`${n} est posée dans ${EXEMPLE} mais n'apparaît nulle part dans ${DOC} — un réglage qu'on propose sans l'expliquer se règle au hasard`);
  }
  return { soucis, ecartes };
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const cites = citesDans(readFileSync(DOC, "utf8"));
    const poses = posesDans(readFileSync(EXEMPLE, "utf8"));
    // ⚠️ ZÉRO CANDIDAT EST UN AVERTISSEMENT, PAS UN SUCCÈS. Si la page cesse d'être lue — renommée,
    // reformatée —, la garde n'aurait plus rien à confronter et rendrait vert sur du vide.
    if (!cites.size || !poses.size) {
      return inconclusif(`${cites.size} nom(s) cité(s) dans ${DOC}, ${poses.size} posé(s) dans ${EXEMPLE} — la sonde ne lit plus ce qu'elle croit lire`);
    }
    const { lues } = inventaire();
    const { soucis, ecartes } = ecarts({ cites, poses, lues });
    if (soucis.length) return violation(soucis);
    const dit = ecartes.length ? ` (${ecartes.length} jeton(s) écarté(s) : ni lus par le code ni posés dans l'exemple — ${ecartes.join(", ")})` : "";
    return conforme(`env d'exemple : ${poses.size} variable(s) posées, toutes documentées, et toute variable documentée y figure${dit}`);
  }));
}
