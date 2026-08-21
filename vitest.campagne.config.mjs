// BANC DE CAMPAGNE DE CHARGE — sa PROPRE configuration, et ce n'est pas du rangement.
//
// ⚠️ Première version : `vitest run --config vitest.base.config.mjs … base/chargeReelle.test.js`.
// Le filtre par chemin N'A PAS PRIS — l'étape a fait tourner TOUT le banc `base/` une seconde fois
// dans le même job, et `retention.test.js` a échoué sur une clé dupliquée : sa graine n'est pas
// idempotente, ce que personne n'avait à savoir tant qu'elle ne tournait qu'une fois.
//
// Un `include` explicite ne se laisse pas contourner par une histoire d'arguments, et il dit ce
// qu'il couvre. Même choix que `vitest.charge.config.mjs` pour le banc structurel.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["base/chargeReelle.test.js"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Le relevé EST le produit de ce banc : intercepté, il ne resterait qu'un vert.
    disableConsoleIntercept: true,
  },
});
