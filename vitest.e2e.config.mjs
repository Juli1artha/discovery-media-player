// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// BANC NAVIGATEUR — séparé, et volontairement.
//
// `npm test` doit rester exécutable partout, sans navigateur : c'est ce qui le rend praticable en
// boucle et dans un conteneur nu. Le banc navigateur demande un Chrome et pèse quelques secondes ;
// il a donc sa propre commande (`npm run test:e2e`) et sa propre étape sur la forge.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["e2e/**/*.test.js"],
    // Un seul processus : les essais se partagent un navigateur et un serveur.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
