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
    exclude: ["base/chargeReelle.test.js"],
    // Un seul processus : les essais se partagent une base.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
