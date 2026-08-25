// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN FICHIER GÉNÉRÉ DOIT ÊTRE DÉCLARÉ COMME TEL — ET LA LISTE VIENT DU CONSTRUCTEUR.
//
// `server/browser.generated.js` et `server/shared.generated.js` sont produits par
// `build/bundle.mjs`. Non marqués, ils comptent dans les statistiques de langage du dépôt et
// leur diff s'ouvre en entier dans chaque PR qui les régénère — des milliers de lignes qui
// noient la revue du code réellement écrit (P2, audit externe du 21/08).
//
// ⚠️ LA LISTE DES GÉNÉRÉS NE S'ÉCRIT PAS ICI. Elle se DÉRIVE de `build/bundle.mjs`, qui déclare
// ses sorties. Une garde qui énumère les fichiers qu'elle connaît devient verte le jour où un
// troisième bundle apparaît : elle ne le voit pas, donc elle ne le réclame pas, donc elle est
// d'autant plus verte qu'elle sert moins.
//
// ⚠️ ET LE MOTIF DE `.gitattributes` EST DÉLIBÉRÉMENT LARGE (`*.generated.js`). Fermer vaut
// mieux que vérifier : un futur bundle nommé selon la convention est couvert sans que personne
// ait à revenir ici. Cette garde ne surveille donc pas l'oubli d'une ligne — elle surveille le
// cas où le constructeur écrirait AILLEURS, sous un nom que le motif ne couvre pas.

import { readFileSync } from "node:fs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Les chemins que le constructeur déclare écrire — dérivés de sa source, jamais listés. */
export function sortiesDuConstructeur(source) {
  const chemins = [];
  const motif = /resolve\s*\(\s*ROOT\s*,\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let m;
  while ((m = motif.exec(source)) !== null) chemins.push(m[1]);
  return [...new Set(chemins)].filter((c) => /\.(js|mjs|cjs)$/.test(c));
}

/** Les motifs de .gitattributes qui posent `linguist-generated`. */
export function motifsGeneres(gitattributes) {
  return gitattributes
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .filter((l) => /linguist-generated\s*=\s*true/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

/** Un motif gitattributes couvre-t-il ce chemin ? (le sous-ensemble réellement utilisé ici) */
export function couvre(motif, chemin) {
  const base = chemin.split("/").pop();
  const cible = motif.includes("/") ? chemin : base;
  const re = new RegExp("^" + motif.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
  return re.test(cible);
}

export function nonCouverts(sorties, motifs) {
  return sorties.filter((s) => !motifs.some((m) => couvre(m, s)));
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const sorties = sortiesDuConstructeur(readFileSync("build/bundle.mjs", "utf8"));

    // ⚠️ ZÉRO SORTIE N'EST PAS UN SUCCÈS. Si le constructeur change de forme — un `join()` au
    // lieu d'un `resolve(ROOT, …)` — cette sonde ne lit plus rien et n'a plus rien à réclamer.
    // Verte, vide, et muette sur le seul cas qu'elle existe pour attraper.
    if (!sorties.length) {
      return inconclusif("aucune sortie dérivée de build/bundle.mjs — la sonde ne lit plus le constructeur, ou il a changé de forme");
    }

    const motifs = motifsGeneres(readFileSync(".gitattributes", "utf8"));
    if (!motifs.length) {
      return violation([".gitattributes ne pose `linguist-generated` sur aucun motif : les bundles comptent comme du code écrit et noient chaque revue"]);
    }

    const orphelins = nonCouverts(sorties, motifs);
    if (orphelins.length) {
      return violation(orphelins.map((c) => `${c} est écrit par build/bundle.mjs et n'est couvert par aucun motif \`linguist-generated\` de .gitattributes`));
    }
    return conforme(`fichiers générés : ${sorties.length} sortie(s) déclarée(s) par le constructeur, toutes couvertes par ${motifs.length} motif(s)`);
  }));
}
