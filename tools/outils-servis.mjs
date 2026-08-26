// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN OUTIL LANCÉ PAR UN WORKFLOW A CE DONT IL A BESOIN POUR TOURNER.
//
// ⚠️ CE QUI EST ARRIVÉ (26/08). Le garde horaire `publication.yml` ne fait qu'un `checkout` : pas
// de `npm ci`, parce qu'aucun des outils qu'il lançait n'avait jamais eu besoin de `node_modules`.
// Puis `exemples-epingles.mjs` a gagné une dépendance à `semver` dans la 0.1.137 — pour comparer
// des INTERVALLES au lieu d'exiger une chaîne littérale, ce qui était le bon changement. Le
// workflow, lui, n'a pas bougé. À partir de cette publication, sa dernière étape jetait
// `ERR_MODULE_NOT_FOUND` avant d'avoir rien mesuré.
//
// ⚠️ ET C'EST LE PIRE ENDROIT OÙ CASSER. Le job devient rouge — donc « ça se voit » — mais sur la
// page des exécutions PLANIFIÉES, que personne n'ouvre. Pendant dix-neuf heures, l'issue que cette
// étape entretient est restée FIGÉE sur son dernier état vrai : elle annonçait encore 0.1.128
// pendant que le registre servait 0.1.138. Une alerte périmée qui a l'air vivante est pire qu'une
// alerte absente — c'est exactement le « troisième étage » d'AGENTS.md, une action qui ressemble à
// un succès.
//
// ⚠️ CE N'EST PAS UN OUBLI, C'EST UNE DISTANCE. Celui qui ajoute un `import` à un outil ne relit
// pas les six workflows pour voir lesquels le lancent, et il a raison : ce n'est pas un travail
// qu'on fait de mémoire. La règle est donc portée par la forge — si un job lance un outil qui
// dépend de `node_modules`, ce job installe.
//
// ⚠️ LA DÉPENDANCE SE SUIT À TRAVERS LES IMPORTS, pas seulement en surface. `exemples-en-retard`
// n'importe pas `semver` : il importe `exemples-epingles`, qui l'importe. Une sonde qui ne
// regarderait que le fichier nommé par la commande aurait rendu vert sur le défaut exact.
//
// Usage : node tools/outils-servis.mjs [.github/workflows]

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parse } from "yaml";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const DOSSIER = ".github/workflows";

/** Ce qu'un job doit contenir pour qu'un outil dépendant puisse tourner. */
export const INSTALLATION = "npm ci";

/** Un spécificateur qui désigne un paquet installé, par opposition à un chemin ou à un module Node. */
export const estPaquet = (spec) => !spec.startsWith(".") && !spec.startsWith("node:");

/**
 * Les paquets dont un outil dépend, en suivant ses imports relatifs.
 *
 * `lire` est injectable : le banc éprouve la règle sans écrire de fichiers.
 */
export function paquetsRequis(entree, lire = (f) => readFileSync(f, "utf8"), vus = new Set()) {
  const chemin = resolve(entree);
  if (vus.has(chemin)) return [];
  vus.add(chemin);
  let source;
  try { source = lire(chemin); } catch { return []; }
  const requis = [];
  for (const [, spec] of source.matchAll(/^import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (estPaquet(spec)) requis.push(spec);
    else requis.push(...paquetsRequis(resolve(dirname(chemin), spec), lire, vus));
  }
  return [...new Set(requis)];
}

/** Les outils qu'un job lance, avec le job qui les lance. */
export function outilsLances(fichier, texte) {
  const w = parse(texte) || {};
  const lances = [];
  for (const [job, def] of Object.entries(w.jobs || {})) {
    const corps = (def?.steps || []).map((e) => (typeof e?.run === "string" ? e.run : "")).join("\n");
    const installe = corps.includes(INSTALLATION);
    for (const [, outil] of corps.matchAll(/\bnode\s+(tools\/[\w.-]+\.mjs)/g)) {
      lances.push({ fichier, job, outil, installe });
    }
  }
  return lances;
}

/** Les outils lancés par un job qui ne les sert pas. */
export function nonServis(lances, lire) {
  const soucis = [];
  for (const { fichier, job, outil, installe } of lances) {
    if (installe) continue;
    const paquets = paquetsRequis(outil, lire);
    if (!paquets.length) continue;
    soucis.push(`${fichier} › ${job} lance \`${outil}\`, qui dépend de ${paquets.map((p) => `\`${p}\``).join(", ")}, dans un job SANS \`${INSTALLATION}\` : l'étape jettera ERR_MODULE_NOT_FOUND avant d'avoir rien mesuré, et sur un workflow planifié ce rouge-là n'est lu par personne`);
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const dossier = process.argv[2] || DOSSIER;
    const fichiers = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).sort();
    if (!fichiers.length) {
      return inconclusif(`aucun workflow dans ${dossier} — la sonde vise à côté, et un vert ne prouverait rien`);
    }
    const lances = fichiers.flatMap((f) => outilsLances(f, readFileSync(join(dossier, f), "utf8")));
    // ⚠️ ZÉRO OUTIL EST UN AVERTISSEMENT, PAS UN SUCCÈS. Ce dépôt en lance des dizaines ; si la
    // sonde n'en trouve plus aucun, c'est qu'elle a cessé de lire, pas que la forge a cessé.
    if (!lances.length) {
      return inconclusif(`aucun \`node tools/…\` relevé dans ${fichiers.length} workflow(s) — le dépôt en lance, donc la sonde ne lit plus ce qu'elle croit lire`);
    }
    const soucis = nonServis(lances);
    if (soucis.length) return violation(soucis);
    const nus = lances.filter((l) => !l.installe).length;
    return conforme(`outils servis : ${lances.length} lancement(s) d'outil dans ${fichiers.length} workflow(s) — chacun a ce qu'il lui faut (${nus} tourne(nt) sans installation, et n'en ont besoin d'aucune)`);
  }));
}
