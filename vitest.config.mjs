// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ `.mjs` et pas `.js` : le paquet est en CommonJS (`package.json` sans `"type": "module"`),
// et cette configuration est écrite en modules ES. Vitest 3 tolérait le mélange ; la 4 non —
// `ERR_REQUIRE_ESM` au démarrage, avant le premier test. L'extension le dit sans ambiguïté.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Cœur navigateur (TypeScript) + serveur et contexte (CommonJS). Les tests qui ont besoin
    // du DOM le déclarent en tête de fichier (`@vitest-environment jsdom`).
    include: ["**/*.{test,spec}.{ts,js}"],
    // ⚠️ `e2e/**` est EXCLU ICI : ce banc demande un vrai navigateur et vit sous `npm run test:e2e`.
    // Le laisser entrer ferait dépendre la commande de base d'un Chrome installé.
    //
    // ⚠️ `base/**` de même : il demande un vrai Postgres et un vrai PostgREST, et il REFUSE de
    // s'esquiver quand `CI` est posé — donc il ferait échouer `npm test` partout ailleurs.
    // `npm run test:base`, et sa propre étape sur la forge.
    //
    // ⚠️ ET `charge/**` AUSSI, POUR LA MÊME RAISON — qui n'avait jamais été tirée. Ce banc a sa
    // propre configuration (`vitest.charge.config.mjs`), sa propre commande et sa propre étape de
    // forge ; il tournait pourtant ICI également, à chaque `npm test`. Deux fois, donc, et la
    // seconde pour rien : c'est la configuration dédiée qui pose `disableConsoleIntercept`, sans
    // quoi le RELEVÉ — le seul produit de ce banc — est avalé par Vitest. Un passage muet d'un banc
    // de mesure ne mesure rien pour personne, et coûte le temps de la mesure.
    //
    // Troisième occurrence du même défaut dans ce dépôt, après la campagne et l'endurance : la règle
    // est désormais tenue par `tools/__tests__/configurationDesBancs.test.js`, qui refuse qu'un fichier
    // de banc appartienne à deux configurations. Relevé par un audit externe (CODEX, 15/09).
    exclude: ["node_modules/**", "examples/**", "e2e/**", "base/**", "charge/**"],
  },
});
