// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// BANC D'ENDURANCE — sa PROPRE configuration, pour la même raison que la campagne.
//
// ⚠️ Un filtre par chemin ne prend pas : `vitest run --config vitest.base.config.mjs base/x.test.js`
// a déjà fait tourner TOUT le dossier `base/` une seconde fois dans le même job, et la graine non
// idempotente de `retention.test.js` a échoué sur une clé dupliquée. Un `include` explicite ne se
// laisse pas contourner par une histoire d'arguments, et il dit ce qu'il couvre.
//
// ⚠️ `testTimeout` très large parce que la DURÉE est le sujet : la campagne longue se lance avec
// `PLAYER_ENDURANCE_SECONDES=1800`. Un délai calé sur les vingt-cinq secondes de forge couperait
// la seule exécution qui apprend quelque chose.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["base/endurance.test.js"],
    fileParallelism: false,
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
  },
});
