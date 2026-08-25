// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PLUS HAUT TAG DE VERSION — UNE SEULE SOURCE DE VÉRITÉ, STRICTE.
//
// ⚠️ Treizième audit : `git tag -l 'v*'` attrapait n'importe quel `v*` (un `v999-test` accidentel
// aurait bloqué les promotions). Et trois endroits sélectionnaient/validaient les tags avec des
// regex qui auraient divergé (validation du tag, choix du plus haut, contrôle horaire). Ce module
// est le seul à décider — semver STRICT, tri numérique, pas d'alphabétique.
//
// Usage : `git tag -l | node tools/plus-haut-tag.mjs` → imprime le plus haut `vX.Y.Z`, ou rien.
//         `node -e "import('./tools/plus-haut-tag.mjs').then(m=>...)"` pour les fonctions.

import { estExecuteDirectement } from "./execute-directement.mjs";
const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;

export function estTagValide(tag) {
  return SEMVER.test(String(tag || "").trim());
}

// Compare deux tags valides : -1 si a < b, 1 si a > b, 0 si égaux. Numérique, jamais lexical
// (« v0.1.9 » < « v0.1.10 », ce que le tri de chaînes rate).
export function comparer(a, b) {
  const [, a1, a2, a3] = SEMVER.exec(a);
  const [, b1, b2, b3] = SEMVER.exec(b);
  return (+a1 - +b1) || (+a2 - +b2) || (+a3 - +b3);
}

// Le plus haut tag VALIDE d'une liste (les invalides sont ignorés). Rend "" si aucun.
export function plusHaut(tags) {
  return (tags || [])
    .map((t) => String(t).trim())
    .filter(estTagValide)
    .sort(comparer)
    .pop() || "";
}

// Exécuté directement : lit stdin (une ligne par tag) et imprime le plus haut.
if (estExecuteDirectement(import.meta.url)) {
  let entree = "";
  process.stdin.on("data", (c) => (entree += c)).on("end", () => {
    process.stdout.write(plusHaut(entree.split("\n")));
  });
}
