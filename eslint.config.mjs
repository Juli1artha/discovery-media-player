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

  // ⚠️ LES GARDES ELLES-MÊMES N'ÉTAIENT PAS LINTÉES. `npm run lint` visait `bin context server src
  // build` — c'est-à-dire tout SAUF `tools/`, où vivent les onze gardes qui refusent les PR des
  // autres, et `charge/`. Le code qui juge le dépôt échappait au seul contrôle automatique de style
  // du dépôt.
  //
  // ⚠️ `*.js` EST INCLUS, ET C'EST LE PIÈGE QUI M'A EU. Un premier essai ne couvrait que `*.mjs` :
  // les vingt bancs de `tools/__tests__/` sont en `.js`, ils ne correspondaient à AUCUN bloc, et
  // eslint leur appliquait exactement une règle — pas `no-undef`. J'ai supprimé un `import` encore
  // utilisé sans que le linter bronche ; c'est `npm test` qui a refusé. Un fichier hors périmètre
  // ne dit pas qu'il est hors périmètre : il passe au vert.
  { files: ["tools/**/*.mjs", "tools/**/*.js"], extends: [js.configs.recommended], languageOptions: { sourceType: "module", globals: NODE } },
  { files: ["tools/**/*.cjs", "charge/**/*.js"], extends: [js.configs.recommended], languageOptions: { sourceType: "commonjs", globals: NODE } },

  // Les tests peuvent s'exécuter dans un DOM (`@vitest-environment jsdom`) : ils ont alors
  // `window` et `document`, comme le code navigateur qu'ils font tourner.
  {
    files: ["**/*.{test,spec}.{ts,js,mjs}"],
    languageOptions: { globals: { ...TEST, window: "readonly", document: "readonly", navigator: "readonly" } },
  },

  // ⚠️ `no-unused-vars` A ÉTÉ COUPÉE ICI POUR TOUS LES TESTS, SANS UN MOT DISANT POURQUOI — et
  // c'est ce silence qui a coûté quarante alertes.
  //
  // Ce que ça a produit (relevé du 23/08) : CodeQL, lui, ne se tait pas. Il a ouvert **40 alertes
  // « Unused variable, import, function or class »** sur `main`, toutes dans des tests, sur une
  // semaine. Quarante entrées dans l'onglet Sécurité pour un défaut que le linter du dépôt voit en
  // deux secondes — mais on lui avait demandé de regarder ailleurs.
  //
  // La coupure était probablement un geste trop large : les tests avaient besoin de leurs globales
  // (`describe`, `it`), ce qui relève de `no-undef` et non de cette règle-ci. Deux règles éteintes
  // là où une seule gênait.
  //
  // ⚠️ LES PARAMÈTRES RESTENT EXEMPTÉS (`args: "none"`), ET C'EST DÉLIBÉRÉ. Un faux de test signe
  // souvent `(url, options) => …` en n'en lisant qu'un : la position porte le sens, et renommer en
  // `_options` rendrait la signature moins lisible que le défaut qu'on prétend corriger. Ce que la
  // règle attrape ici, ce sont les `require` morts et les variables mortes — exactement la classe
  // que CodeQL signalait.
  {
    files: ["**/*.{test,spec}.{ts,js,mjs}"],
    rules: { "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }] },
  },
  {
    files: ["**/*.{test,spec}.ts"],
    rules: {
      "no-unused-vars": "off",  // le parseur TS a sa propre version, sinon les deux comptent double
      "@typescript-eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },
);
