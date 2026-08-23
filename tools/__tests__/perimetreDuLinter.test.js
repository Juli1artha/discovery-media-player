// AUCUN FICHIER SOURCE N'ÉCHAPPE AU LINTER — ET UN AVERTISSEMENT ARRÊTE LA CI.
//
// ⚠️ TROIS SILENCES SE SONT ADDITIONNÉS, ET CHACUN ÉTAIT INVISIBLE (relevé du 23/08).
//
//   1. `no-unused-vars` était coupée pour TOUS les tests, sans un mot disant pourquoi. CodeQL, lui,
//      ne se tait pas : 40 alertes ouvertes sur `main` en une semaine, toutes pour un défaut que le
//      linter du dépôt voit en deux secondes.
//   2. `npm run lint` ne visait pas `tools/` ni `charge/` — c'est-à-dire que les onze gardes qui
//      refusent les PR des autres n'étaient elles-mêmes contrôlées par personne.
//   3. Les règles étaient en `warn` et la commande sans `--max-warnings 0` : eslint rendait 0. Un
//      avertissement qui ne fait rien échouer est un avertissement que personne ne lit.
//
// ⚠️ ET LE QUATRIÈME, TROUVÉ EN RÉPARANT LES TROIS : un premier correctif ne couvrait que
// `tools/**/*.mjs`. Les vingt bancs de `tools/__tests__/` sont en `.js` : ils ne correspondaient à
// AUCUN bloc de configuration, et eslint leur appliquait exactement UNE règle. J'ai supprimé un
// `import` encore utilisé sans que le linter bronche — c'est `npm test` qui a refusé.
//
// C'est la leçon que ce banc encode : un fichier hors périmètre ne dit pas qu'il est hors
// périmètre. Il passe au vert, comme les autres, et on ne peut pas l'en distinguer à l'œil.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;

describe("⚠️ LA COMMANDE DE LINT", () => {
  it("vise les dossiers qui portent des sources, `tools/` et `charge/` compris", () => {
    for (const dossier of ["bin", "context", "server", "src", "build", "tools", "charge"]) {
      expect(scripts.lint, `« ${dossier} » n'est pas dans le périmètre du linter`).toContain(dossier);
    }
  });

  it("⚠️ fait échouer sur un simple AVERTISSEMENT", () => {
    // Sans ceci, `no-unused-vars: "warn"` rend 0 : la règle existe, s'affiche, et n'arrête rien.
    expect(scripts.lint).toContain("--max-warnings 0");
  });
});

describe("⚠️ ET AUCUN FICHIER NE TOMBE DANS UN TROU DE CONFIGURATION", () => {
  it("chaque source du périmètre reçoit une vraie configuration, pas une règle isolée", async () => {
    // Le seuil n'est pas un réglage fin : dans le trou, la configuration effective portait UNE
    // règle ; hors du trou, elle en porte plus de soixante. Il n'y a rien entre les deux.
    const eslint = new ESLint();
    const temoins = [
      "tools/__tests__/languePubliee.test.js",   // le fichier qui a révélé le trou (.js sous tools/)
      "tools/__tests__/postgrestEnMemoire.test.js", // un banc CommonJS, même dossier
      "tools/resultat-garde.mjs",
      "tools/prefixe-rest.cjs",
      "charge/coutParGeste.test.js",
      "server/presentations.js",
      "server/__tests__/regleDuCache.test.js",
      "build/bundle.mjs",
    ];
    for (const fichier of temoins) {
      const config = await eslint.calculateConfigForFile(fichier);
      const actives = Object.entries(config.rules || {})
        .filter(([, v]) => v && v[0] !== 0 && v[0] !== "off");
      expect(actives.length, `${fichier} n'est couvert que par ${actives.length} règle(s)`).toBeGreaterThan(20);
    }
  });
});
