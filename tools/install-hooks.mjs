#!/usr/bin/env node
// Installe les hooks git de ce dépôt. Appelé par `npm install` via le script `prepare`.
//
// ⚠️ POURQUOI AUTOMATIQUE PLUTÔT QUE DOCUMENTÉ. Le hook `pre-push` existait dans le dépôt voisin
// depuis le 05/08 ; celui-ci ne l'a reçu que le 14/08, après que le même incident s'y soit produit
// et qu'une version ait été publiée sans son correctif. Une garde qui demande une étape manuelle
// par clone est une garde qu'un clone sur deux n'a pas — et ce clone-là est toujours celui où
// l'incident arrive.
//
// Idempotent, silencieux, et sans effet quand il n'y a rien à installer.

import { existsSync, copyFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ICI = dirname(fileURLToPath(import.meta.url));

// ⚠️ `prepare` s'exécute AUSSI quand le paquet est installé comme dépendance. On ne touche jamais
// au dépôt de quelqu'un d'autre : ni depuis node_modules, ni hors d'un dépôt git.
if (ICI.includes("node_modules")) process.exit(0);

let dossierGit;
try {
  dossierGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: join(ICI, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  process.exit(0); // pas un dépôt git (tarball, archive) : rien à faire
}
if (!dossierGit || !existsSync(dossierGit)) process.exit(0);

const source = join(ICI, "git-hooks", "pre-push");
if (!existsSync(source)) process.exit(0);

const cible = join(dossierGit, "hooks", "pre-push");
try {
  // Déjà à jour : on ne réécrit pas, pour ne pas écraser une personnalisation identique.
  if (existsSync(cible) && readFileSync(cible, "utf8") === readFileSync(source, "utf8")) process.exit(0);
  mkdirSync(dirname(cible), { recursive: true });
  copyFileSync(source, cible);
  chmodSync(cible, 0o755);
  // ⚠️ SUR STDERR, ET C'EST UN CORRECTIF PLUTÔT QU'UN GOÛT. `prepare` tourne AUSSI sous
  // `npm pack --dry-run --json`, dont `tools/langue-publiee.mjs` lit la sortie JSON. Cette ligne
  // partait sur stdout, en tête du JSON : le banc de la langue publiée tombait sur
  // `SyntaxError: Unexpected token 'h'` — un rouge qui ne nomme ni les hooks, ni sa vraie cause.
  //
  // Et il ne se déclenchait qu'UNE fois, juste après une modification de `tools/git-hooks/pre-push`
  // (le hook redevient périmé, donc la ligne se réimprime), puis disparaissait tout seul au
  // deuxième essai. C'est le pire des rouges : celui qu'on ne reproduit pas, qu'on met sur le
  // compte du hasard, et qui apprend à relancer plutôt qu'à lire. Exactement ce que
  // `tools/resultat-garde.mjs` existe pour interdire.
  console.error("hooks git : pre-push installé");
} catch {
  // Un hook non installé ne doit jamais empêcher d'installer le projet.
}
