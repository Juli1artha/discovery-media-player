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
    exclude: ["node_modules/**", "examples/**", "e2e/**"],
  },
});
