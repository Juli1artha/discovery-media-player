// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA LICENCE PAR FICHIER — LA FRONTIÈRE AGPL/MIT DEVIENT REFUSABLE PAR UNE MACHINE.
//
// ⚠️ LA FRONTIÈRE EXISTAIT, MAIS SEULEMENT EN PROSE. `src/bridge.ts` est MIT « délibérément, et
// c'est le seul » (son propre en-tête le dit) ; AGENTS.md demande de « ne pas déplacer du code à
// travers cette ligne à la légère ». Deux phrases, zéro contrôle : un fichier créé du mauvais côté,
// ou du code MIT recopié dans le cœur AGPL, n'aurait fait rougir personne. Un seul fichier portait
// sa licence — précisément parce qu'elle DIFFÈRE — et un test le protégeait lui, pas les autres.
//
// Désormais chaque fichier source porte ses deux lignes (SPDX + copyright), et cette garde les
// exige. Ce que ça achète n'est pas la conformité Gold (license_per_file, copyright_per_file —
// qui l'exigent aussi) : c'est que la frontière de licence est devenue un FAIT PAR FICHIER, que la
// machine confronte, au lieu d'une prose que la revue doit se rappeler.
//
// ⚠️ LA LICENCE ATTENDUE N'EST PAS ÉCRITE ICI. Elle est lue dans `package.json` (`license`), et le
// titulaire dans `author` : la règle du dépôt est qu'un fait n'existe jamais en deux copies non
// confrontées. Si la licence du paquet change un jour, cette garde exigera la nouvelle sans être
// touchée — et rougira sur chaque fichier resté à l'ancienne, ce qui est exactement le travail.
//
// ⚠️ LES FICHIERS GÉNÉRÉS NE SONT PAS EXEMPTÉS, ET C'EST VOULU. Leur en-tête vient de
// `build/bundle.mjs` : exempter les générés reviendrait à ne pas vérifier que le générateur fait
// son travail. S'ils rougissent, le correctif est dans la bannière du build, puis `npm run build`.
//
// Les `.sql` (supabase/) et les `.md` restent hors périmètre pour l'instant — un périmètre
// s'étend par une PR qui l'assume, pas par un silence. C'est une bonne première contribution.
//
// Usage : node tools/licence-par-fichier.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";

/**
 * ⚠️ L'EXCEPTION EST UNE LISTE FERMÉE, ET ELLE PORTE SA RAISON. Le contrat que l'hôte importe doit
 * rester libre de péage (AGENTS.md : « the split IS the integration story ») ; tout le reste est
 * sous la licence du paquet. Ajouter un fichier ici est un acte de relicenciement — il se discute
 * dans une PR, pas dans un correctif de garde.
 */
export const FICHIERS_MIT = new Set(["src/bridge.ts"]);

const SOURCES = /\.(js|mjs|cjs|ts|mts)$/;

/** Les lignes où l'en-tête a le droit de vivre : un shebang éventuel, puis les deux lignes. */
const TETE = 5;

/** @returns le résultat au sens de resultat-garde.mjs, sans sortir du processus (banc oblige). */
export function garde(racine = process.cwd()) {
  let paquet;
  try {
    paquet = JSON.parse(readFileSync(join(racine, "package.json"), "utf8"));
  } catch {
    return inconclusif("pas de package.json lisible : la sonde ne regarde pas un dépôt");
  }
  const licence = paquet.license;
  const titulaire = paquet.author;
  if (!licence || !titulaire) {
    return inconclusif("package.json sans `license` ou `author` : la licence attendue n'a pas de source de vérité");
  }

  // `git ls-files` et pas une promenade de dossiers : le périmètre est « ce que le dépôt PUBLIE de
  // lui-même », pas ce qui traîne sur le disque — node_modules, dist/ et les brouillons non suivis
  // n'ont pas de licence à porter. Hors d'un dépôt git, l'appel lève et `tenter()` classe : 2.
  const suivis = execFileSync("git", ["ls-files"], { cwd: racine, encoding: "utf8" })
    .split("\n")
    .filter((f) => SOURCES.test(f));
  if (suivis.length === 0) {
    return inconclusif("aucun fichier source suivi : la sonde vise à côté");
  }

  const constats = [];
  for (const f of suivis) {
    const attendu = FICHIERS_MIT.has(f) ? "MIT" : licence;
    const tete = readFileSync(join(racine, f), "utf8").split("\n", TETE);
    const spdx = tete.find((l) => l.includes("SPDX-License-Identifier:"));
    if (!spdx) {
      constats.push(`${f} : aucune ligne « SPDX-License-Identifier » dans les ${TETE} premières lignes`);
      continue;
    }
    // ⚠️ ÉGALITÉ STRICTE de l'identifiant, pas une inclusion : « AGPL-3.0-or-later » contient
    // « AGPL-3.0 », et une inclusion accepterait un identifiant tronqué qui dit une autre licence.
    const id = spdx.split("SPDX-License-Identifier:")[1].trim();
    if (id !== attendu) {
      constats.push(`${f} : licence « ${id} », attendu « ${attendu} »${FICHIERS_MIT.has(f) ? " (le contrat hôte est MIT — voir FICHIERS_MIT)" : " (la licence du paquet, package.json)"}`);
    }
    const droit = tete.find((l) => l.includes("Copyright ©"));
    if (!droit) {
      constats.push(`${f} : aucune ligne « Copyright © » dans les ${TETE} premières lignes`);
    } else if (!droit.includes(titulaire)) {
      constats.push(`${f} : le copyright ne nomme pas « ${titulaire} » (le titulaire vient de package.json \`author\`)`);
    }
  }

  if (constats.length > 0) return violation(constats);
  return conforme(
    `${suivis.length} fichier(s) source : chacun nomme sa licence (${licence}, ` +
    `${[...FICHIERS_MIT].filter((f) => suivis.includes(f)).length} exception(s) MIT) et son titulaire`
  );
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => garde()));
}
