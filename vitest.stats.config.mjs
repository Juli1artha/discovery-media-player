// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Confrontation SQL ↔ JavaScript des agrégations analytiques — son propre `include`, pour la même
// raison que la campagne et l'endurance : un filtre par chemin ne prend pas, et refaire tourner
// tout `base/` dans le même job casse la graine non idempotente de `retention.test.js`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["base/statistiquesAgregees.test.js"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
