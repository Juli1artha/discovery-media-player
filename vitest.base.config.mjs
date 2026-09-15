// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// BANC « VRAIE BASE » — séparé, et volontairement.
//
// Le double PostgREST en mémoire dit lui-même ce qu'il ne sait pas faire : pas de contraintes, pas
// de transactions, « PAS un substitut pour vérifier ce qui relève du SGBD ». Ce banc-là éprouve
// précisément ces propriétés, contre un vrai Postgres et un vrai PostgREST.
//
// `npm test` doit rester exécutable sur un poste nu : ce banc a donc sa propre commande
// (`npm run test:base`) et sa propre étape sur la forge, comme le banc navigateur.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["base/**/*.test.js"],
    // ⚠️ LA CAMPAGNE DE CHARGE VIT DANS base/ MAIS N'APPARTIENT PAS À CE BANC — et sans cette ligne
    // elle tournait DEUX FOIS sur la forge : une fois ici, à son volume par défaut, une fois à son
    // étape dédiée avec PLAYER_CHARGE_SPECTATEURS. Personne ne l'avait vu, parce que les deux
    // passages sont verts : le gaspillage d'une garde ne se signale pas tout seul.
    //
    // Ce n'est pas qu'une question de temps de forge — les deux passages écrivent dans la MÊME base
    // d'essai, et c'est exactement le genre d'interaction qui a déjà fait échouer une graine non
    // idempotente sur une clé dupliquée (le défaut symétrique, dans l'autre configuration).
    //
    // ⚠️ ET LA LIGNE NE DISAIT QU'UN TIERS DE LA VÉRITÉ. Elle n'écartait que la campagne, alors que
    // `endurance` et `statistiquesAgregees` ont eux aussi acquis leur propre configuration et leur
    // propre étape — pour exactement la même raison — sans que personne ne revienne les écarter
    // ici. Les deux tournaient donc DEUX FOIS, comme la campagne avant elle : le correctif d'un cas
    // particulier n'avait pas été transformé en règle, et rien ne pouvait le dire, puisqu'un double
    // passage est vert. C'est `tools/__tests__/configurationDesBancs.test.js` qui tient la règle
    // désormais : cette liste est confrontée aux `include` des configurations spécialisées, et
    // aucune ne peut plus naître sans être écartée d'ici. Relevé par un audit externe (CODEX, 15/09).
    exclude: ["base/chargeReelle.test.js", "base/endurance.test.js", "base/statistiquesAgregees.test.js"],
    // Un seul processus : les essais se partagent une base.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
