import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE = {
  require: "readonly", module: "writable", exports: "writable", process: "readonly",
  console: "readonly", Buffer: "readonly", __dirname: "readonly", __filename: "readonly",
  globalThis: "readonly", URL: "readonly", URLSearchParams: "readonly", fetch: "readonly",
  TextEncoder: "readonly", TextDecoder: "readonly", crypto: "readonly", AbortSignal: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  setImmediate: "readonly", ReadableStream: "readonly", Headers: "readonly", Response: "readonly",
};
const TEST = {
  describe: "readonly", it: "readonly", expect: "readonly", vi: "readonly",
  beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly", afterAll: "readonly",
};

export default tseslint.config(
  { ignores: ["node_modules/**", "server/*.generated.js", "examples/**"] },

  // Cœur navigateur : TypeScript, sans framework.
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "no-undef": "off",                                   // tsc s'en charge
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": "off",           // couvert par noUnusedLocals
    },
  },

  // Serveur, contexte, serveur autonome : Node/CommonJS.
  {
    files: ["bin/**/*.js", "context/**/*.js", "server/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "commonjs", globals: NODE },
    rules: {
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // `catch (e)` sans lecture de `e` est un idiome assumé ici : beaucoup de chemins doivent
      // dégrader sans bruit plutôt que d'empêcher un document de s'afficher.
      "no-unused-vars": ["warn", { caughtErrors: "none", argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  { files: ["build/**/*.mjs"], extends: [js.configs.recommended], languageOptions: { sourceType: "module", globals: NODE } },
  // Les tests peuvent s'exécuter dans un DOM (`@vitest-environment jsdom`) : ils ont alors
  // `window` et `document`, comme le code navigateur qu'ils font tourner.
  {
    files: ["**/*.{test,spec}.{ts,js}"],
    languageOptions: { globals: { ...TEST, window: "readonly", document: "readonly", navigator: "readonly" } },
    rules: { "no-unused-vars": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
);
