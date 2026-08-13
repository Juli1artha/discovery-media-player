import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Cœur navigateur (TypeScript) + serveur et contexte (CommonJS). Les tests qui ont besoin
    // du DOM le déclarent en tête de fichier (`@vitest-environment jsdom`).
    include: ["**/*.{test,spec}.{ts,js}"],
    exclude: ["node_modules/**", "examples/**"],
  },
});
