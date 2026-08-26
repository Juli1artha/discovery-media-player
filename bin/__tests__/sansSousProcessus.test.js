// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE RUNTIME NE LANCE AUCUN SOUS-PROCESSUS — ET C'EST CE QUI PERMET À L'IMAGE DE N'AVOIR PAS D'INIT.
//
// ⚠️ CE BANC GARDE UNE HYPOTHÈSE, PAS UN COMPORTEMENT. `dumb-init` a été retiré de l'image le
// 26/08 : sa raison d'être écrite (« Node est PID 1 et n'a pas de gestionnaire de signal ») était
// morte depuis que `bin/serve.js` en installe un, et son travail restant — moissonner les zombies —
// est vide tant que rien ne fork. Retirer supprimait le seul intrant non épinglé de l'image et sa
// dépendance réseau au build.
//
// ⚠️ MAIS UNE HYPOTHÈSE QUI DORT DANS UN COMMENTAIRE N'EST PAS GARDÉE. Le jour où quelqu'un ajoute
// une vignette, un outil PDF, un `execFile` — un besoin parfaitement légitime — les zombies
// s'accumuleraient sous un PID 1 qui ne moissonne pas, EN SILENCE et pour longtemps avant que ça se
// voie. Ce banc fait reposer la décision au moment EXACT où elle redevient vraie.
//
// ⚠️ IL N'INTERDIT RIEN : il exige qu'on choisisse. Si un sous-processus devient nécessaire, le
// geste est de remettre un init (ou de documenter `docker run --init`) ET de mettre ce banc à jour
// en disant lequel. Ce qu'on refuse, c'est que le premier `fork` passe sans que personne ne repose
// la question.

// ⚠️ COMMONJS, comme tout `bin/` — eslint applique `sourceType: "commonjs"` à ce dossier, et un
// `import` y échoue à l'analyse. Écrit en ESM au premier jet, ce fichier a été refusé par la CI :
// c'est bien le linter qui a raison, et ce banc-ci est le seul de `bin/__tests__` à avoir voulu
// dire autrement que ses voisins.
//
// ⚠️ ET `child_process` EST IMPORTÉ ICI, DANS UN BANC QUI LE REFUSE AILLEURS. Ce n'est pas une
// contradiction : le périmètre gardé est le RUNTIME — ce qui tourne dans le conteneur —, et les
// bancs n'y sont pas. `DU_RUNTIME` les écarte nommément.
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

/** Les fichiers qui tournent dans le conteneur — pas les bancs, qui ont le droit de forker. */
const DU_RUNTIME = (f) => /^(server|bin|context)\/[^/]*\.(js|cjs|mjs)$/.test(f)
  && !f.includes("__tests__") && !f.endsWith(".generated.js");

const fichiers = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(DU_RUNTIME);

describe("aucun sous-processus dans le runtime", () => {
  it("le périmètre est peuplé — sinon la garde serait verte en ne lisant rien", () => {
    expect(fichiers.length).toBeGreaterThan(20);
    expect(fichiers).toContain("bin/serve.js");
  });

  it("⚠️ rien n'importe `child_process`, donc rien ne peut forker", () => {
    const fautifs = fichiers.filter((f) => /require\(\s*["'](?:node:)?child_process["']\s*\)|from\s+["'](?:node:)?child_process["']/.test(readFileSync(f, "utf8")));
    expect(fautifs,
      `${fautifs.join(", ")} importe(nt) child_process.\n`
      + "L'image ne porte plus d'init (dumb-init retiré le 26/08) : sous un PID 1 qui ne moissonne\n"
      + "pas, les enfants terminés deviennent des zombies, en silence. Si ce sous-processus est\n"
      + "nécessaire — il peut l'être —, le geste est de REMETTRE un init dans le Dockerfile (ou de\n"
      + "documenter `docker run --init`) et de mettre ce banc à jour en disant lequel.").toEqual([]);
  });

  it("⚠️ ni `spawn`, ni `fork`, ni `execFile` par un autre chemin", () => {
    // L'import est le chemin normal ; ce second volet attrape un import dynamique ou un alias.
    const fautifs = fichiers.filter((f) => /\b(spawnSync|spawn|execFileSync|execFile|execSync)\s*\(/.test(readFileSync(f, "utf8")));
    expect(fautifs, fautifs.join(", ")).toEqual([]);
  });
});

describe("l'image reste cohérente avec cette hypothèse", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");

  it("⚠️ le `CMD` est en forme EXEC — la forme shell mettrait `/bin/sh` en PID 1", () => {
    // Un `sh` PID 1 NE RELAIE PAS les signaux à son enfant : le gestionnaire de SIGTERM de
    // `serve.js` ne serait jamais appelé, et l'arrêt gracieux ne servirait à rien. C'est le piège
    // exact qu'ouvre le retrait de l'ENTRYPOINT.
    expect(dockerfile).toMatch(/^CMD \["node", "bin\/serve\.js"\]/m);
  });

  it("le Dockerfile dit POURQUOI il n'a pas d'init, et où trouver le secours", () => {
    expect(dockerfile, "un choix non écrit se relit comme un oubli").toContain("PAS D'INIT DANS CETTE IMAGE");
    expect(dockerfile, "l'exploitant qui en a besoin ne doit pas être coincé").toContain("--init");
  });
});
