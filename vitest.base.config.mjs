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
    // Un seul processus : les essais se partagent une base.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
