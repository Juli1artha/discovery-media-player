// Regroupe le code navigateur du player (modules TypeScript) en un fichier que la fonction
// serverless `api/doc.js` injecte dans son HTML.
//
// POURQUOI un fichier généré ET committé : les routes `api/*.js` sont déployées telles quelles
// par Vercel — elles ne passent jamais par le build du front. Un artefact produit pendant le
// `buildCommand` risquerait d'arriver après l'empaquetage des fonctions, et ce genre d'échec est
// silencieux en production. Un seul fichier, au nom stable, committé, gardé frais par un test.
//
//   npm run build:player   → régénère
//   npm test               → échoue si le fichier ne correspond plus aux sources

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ⚠️ Racine = le dossier DU PLAYER, pas celui du dépôt qui l'héberge. Le player vit aujourd'hui
// dans deux arborescences (son propre dépôt, et le studio qui le consomme) : un chemin calculé
// depuis le dépôt marcherait dans l'une et pas dans l'autre — et l'échec serait « bundle
// introuvable », pas « bundle périmé ».
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "server/browser.generated.js");
const OUT_SHARED = resolve(ROOT, "server/shared.generated.js");

// Modules SANS DOM, utiles aux DEUX côtés : le navigateur les reçoit dans le bundle, les fonctions
// serverless les requièrent en CommonJS. C'est ce qui permet à un contrat (celui du contenu d'une
// présentation, par exemple) de n'exister qu'en UN exemplaire au lieu de deux qui divergent.
// ⚠️ DEUX LISTES, PARCE QU'ELLES RÉPONDENT À DEUX QUESTIONS.
//
// `SHARED_SOURCES` sert au HACHAGE : toute source dont le contenu doit invalider le bundle y figure.
// `SHARED_ENTRY` est le point d'entrée d'esbuild, qui n'en prend qu'un.
//
// Elles étaient confondues — `entryPoints: [SHARED_SOURCES[0]]` — donc ajouter un fichier à la liste
// le faisait compter dans le hachage SANS l'embarquer. Le module partagé aurait grandi sans que rien
// ne le dise : le fichier existe, le hachage change, et l'import échoue à l'exécution seulement.
export const SHARED_SOURCES = ["src/shared.ts", "src/presentation-content.ts", "src/cadence.ts"];
export const SHARED_ENTRY = "src/shared.ts";

/** Sources embarquées dans le bundle navigateur. Toute nouvelle brique s'ajoute ici ET dans index.ts. */
export const SOURCES = [
  "src/index.ts",
  "src/bridge.ts",
  "src/tracking.ts",
  "src/live.ts",
  "src/chat.ts",
  "src/presentation-content.ts",
  "src/viewer.ts",
  "src/presentation-state.ts",
];

/** Empreinte des sources — sert au test de fraîcheur du fichier généré. */
export async function sourceHash() {
  const hash = createHash("sha256");
  for (const rel of [...SOURCES, ...SHARED_SOURCES]) hash.update(rel).update("\0").update(await readFile(resolve(ROOT, rel)));
  return hash.digest("hex").slice(0, 16);
}

export async function bundle() {
  const result = await build({
    entryPoints: [resolve(ROOT, SOURCES[0])],
    // ⚠️ esbuild écrit le chemin de chaque module dans sa sortie, RELATIF à son dossier de
    // travail. Sans ce point d'ancrage, le même code produirait deux fichiers différents selon
    // l'endroit d'où on lance la commande — et le test de fraîcheur, lui, ne saurait pas si
    // l'artefact est périmé ou simplement construit ailleurs.
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: "iife",
    // Le code injecté s'expose sous `window.Player`, un espace de noms par brique
    // (`Player.bridge`, `Player.tracking`…) : le reste de la visionneuse — encore en template
    // literal — les appelle par ces noms, sans savoir d'où ils viennent.
    globalName: "Player",
    target: "es2017",
    minify: true,
    legalComments: "none",
  });
  const js = result.outputFiles[0].text.trim();

  // Le bundle est injecté dans un `<script>` : une séquence `</script` le terminerait au milieu.
  // On refuse de générer plutôt que de produire une page cassée — ou pire, une porte d'injection.
  if (/<\/script/i.test(js)) throw new Error("bundle: séquence </script interdite dans le code navigateur");

  return js;
}

/** Build CommonJS des modules partagés, requis tel quel par les fonctions serverless. */
export async function bundleShared() {
  const result = await build({
    entryPoints: [resolve(ROOT, SHARED_ENTRY)],
    absWorkingDir: ROOT, // cf. bundle() : la sortie ne doit pas dépendre du dossier d'exécution
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node18",
    legalComments: "none",
  });
  return result.outputFiles[0].text.trimEnd();
}

export async function renderShared() {
  return [
    "// GÉNÉRÉ par `npm run build:player` — NE PAS ÉDITER À LA MAIN.",
    `// Sources : ${SHARED_SOURCES.join(", ")}`,
    "//",
    "// Contrats partagés entre le navigateur et les fonctions serverless. Un seul exemplaire :",
    "// deux implémentations d'un même contrat finissent toujours par diverger en silence.",
    await bundleShared(),
    "",
  ].join("\n");
}

/**
 * Le pont compilé est de l'ESM dans un paquet CommonJS. Sans ce marqueur, Node avertit à chaque
 * import (« module type not specified ») et le reparse — bruyant chez le consommateur, et pour
 * une raison qui ne le concerne pas. Un `package.json` d'un seul champ dans `dist/` suffit à le
 * dire, et c'est la façon standard de mélanger les deux formats dans un paquet.
 */
export async function marquerDistEsm() {
  await writeFile(resolve(ROOT, "dist/package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
}

export async function render() {
  const js = await bundle();
  return [
    "// GÉNÉRÉ par `npm run build:player` — NE PAS ÉDITER À LA MAIN.",
    `// Sources : ${SOURCES.join(", ")}`,
    "//",
    "// Injecté par api/doc.js dans un <script nonce=…> de la visionneuse. Le code navigateur du",
    "// player vit en modules TypeScript testés sous player/src/ — c'est ici qu'il atterrit.",
    '"use strict";',
    `module.exports = { PLAYER_BROWSER_JS: ${JSON.stringify(js)}, SOURCE_HASH: ${JSON.stringify(await sourceHash())} };`,
    "",
  ].join("\n");
}

// Exécution directe (`node player/build/bundle.mjs`) → écrit le fichier.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const out = await render();
  await writeFile(OUT, out, "utf8");
  const shared = await renderShared();
  await writeFile(OUT_SHARED, shared, "utf8");
  console.log(`player: navigateur ${out.length} o → ${relative(process.cwd(), OUT)}`);
  console.log(`player: partagé   ${shared.length} o → ${relative(process.cwd(), OUT_SHARED)}`);
}
