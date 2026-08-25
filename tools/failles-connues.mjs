// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES FAILLES CONNUES DES DÉPENDANCES — ET LA DIFFÉRENCE ENTRE « AUCUNE » ET « JE N'AI PAS PU VOIR ».
//
// ⚠️ CE QUE FAISAIT L'ÉTAPE QUE CE FICHIER REMPLACE. Elle lisait le code de sortie de
// `npm audit` :
//
//     if ! npm audit --omit=dev --audit-level=low; then
//       echo "::error::arbre de PRODUCTION : faille connue"; exit 1
//
// Or `npm audit` sort en NON-ZÉRO pour deux raisons qui n'ont rien à voir : des failles trouvées,
// ou un registre injoignable. Le second cas rougissait donc en accusant la branche d'une « faille
// connue » qui n'existe pas — et le commentaire posé juste au-dessus promettait le contraire :
// « c'est la garde qui n'a pas pu regarder — pas la branche. On le DIT ». Le commentaire disait
// vrai sur l'intention, faux sur ce que la ligne faisait.
//
// ⚠️ CE DÉPÔT A DÉJÀ LE MÉCANISME POUR ÇA, et c'est ce qui rend l'écart gênant :
// `resultat-garde.mjs` distingue depuis longtemps « vérifié et violé » (1) de « pas pu vérifier »
// (2), précisément pour qu'un rouge de sonde n'apprenne à personne à cliquer à côté du prochain.
//
// ⚠️ ON NE LIT PLUS LE CODE DE SORTIE, ON LIT LA RÉPONSE. `npm audit --json` rend `metadata.
// vulnerabilities` quand il a vu, et `{ message, error }` sans `metadata` quand il n'a pas pu.
// C'est la présence du relevé qui tranche, pas un entier qui confond deux causes — la même leçon
// que le `$?` après un tube, qui rendait l'état du dernier maillon.
//
// Les deux seuils et leurs raisons vivent dans docs/DEPENDENCIES.md ; ils sont rappelés ici parce
// qu'un seuil sans sa raison finit par être relevé « juste pour cette fois ».
//
// Usage : node tools/failles-connues.mjs

import { spawnSync } from "node:child_process";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";

/**
 * Le relevé, ou un refus. ⚠️ LÈVE plutôt que de rendre zéro : un audit qu'on n'a pas su lire n'est
 * pas un audit sans faille. `tenter()` transforme ce refus en code 2.
 */
export function comptesDe(sortie, quoi) {
  let doc;
  try {
    doc = JSON.parse(sortie);
  } catch {
    throw new Error(`arbre de ${quoi} : « npm audit --json » n'a pas rendu du JSON — le registre, le réseau ou npm lui-même, mais pas cette branche`);
  }
  const v = doc && doc.metadata && doc.metadata.vulnerabilities;
  if (!v) {
    const raison = (doc && doc.message) || "sans message";
    throw new Error(`arbre de ${quoi} : le registre n'a rendu aucun relevé — ${raison}`);
  }
  return v;
}

/**
 * ⚠️ AUCUNE, QUELLE QUE SOIT LA GRAVITÉ. L'arbre de production tourne à côté des documents d'un
 * exploitant et tient deux dépendances : il est assez petit pour qu'on le lise en entier, donc
 * assez petit pour n'en tolérer aucune.
 */
export function ecartsProduction(v) {
  if (!v.total) return [];
  return [`arbre de PRODUCTION : ${v.total} faille(s) connue(s) — seuil « aucune » (${detail(v)}), voir docs/DEPENDENCIES.md`];
}

/**
 * ⚠️ HAUTE OU CRITIQUE SEULEMENT. L'arbre de développement ne quitte jamais le dépôt (`files`
 * filtre le tarball) : une faille y menace nos machines, pas les instances. Bloquer sur une
 * modérée dans un plugin de test arrêterait la livraison de correctifs pour une menace qui ne les
 * concerne pas — et une CI qu'on apprend à contourner ne garde plus rien.
 */
export function ecartsDeveloppement(v) {
  const graves = (v.high || 0) + (v.critical || 0);
  if (!graves) return [];
  return [`arbre de DÉVELOPPEMENT : ${graves} faille(s) haute(s) ou critique(s) — seuil « high » (${detail(v)}), voir docs/DEPENDENCIES.md`];
}

const detail = (v) => ["critical", "high", "moderate", "low", "info"]
  .filter((n) => v[n]).map((n) => `${v[n]} ${n}`).join(", ") || "aucune";

/** L'appel réel. Séparé pour que le banc éprouve les verdicts sans réseau. */
export function auditer(args) {
  const r = spawnSync("npm", ["audit", "--json", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`« npm audit » n'a pas pu être lancé — ${r.error.message}`);
  return String(r.stdout || "");
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const prod = comptesDe(auditer(["--omit=dev"]), "PRODUCTION");
    const dev = comptesDe(auditer([]), "DÉVELOPPEMENT");
    const soucis = [...ecartsProduction(prod), ...ecartsDeveloppement(dev)];
    if (soucis.length) return violation(soucis);
    return conforme(`failles connues : aucune en production (${prod.total} au total), aucune haute ni critique en développement`);
  }));
}
