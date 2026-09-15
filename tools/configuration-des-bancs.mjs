#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// QUELLE CONFIGURATION JOUE CE BANC ? UNE SEULE, ET LA QUESTION SE POSE À UN SEUL ENDROIT.
//
// ⚠️ TROIS FOIS LE MÊME DÉFAUT, ET LES DEUX PREMIERS CORRECTIFS L'ONT LAISSÉ REVENIR.
// `base/chargeReelle.test.js` a reçu sa propre configuration et sa propre étape de forge — et il a
// continué de tourner AUSSI dans le banc `base/`. La ligne d'exclusion qui a corrigé ce cas-là
// nommait UN fichier. `base/endurance.test.js` puis `base/statistiquesAgregees.test.js` ont ensuite
// acquis, pour exactement la même raison, leur propre configuration — et personne n'est revenu les
// écarter. Enfin tout `charge/**` tournait sous `npm test` EN PLUS de `npm run test:charge`, et ce
// passage-là est MUET : seule la configuration dédiée pose `disableConsoleIntercept`, sans quoi le
// relevé — l'unique produit de ce banc — est avalé par Vitest.
//
// ⚠️ AUCUN DE CES TROIS PASSAGES N'A JAMAIS ROUGI. Un banc joué deux fois est vert deux fois : le
// gaspillage d'une garde ne se signale pas tout seul. Et ce n'est pas qu'une question de temps de
// forge — les passages écrivent dans la MÊME base d'essai, ce qui a déjà fait échouer la graine non
// idempotente de `retention.test.js` sur une clé dupliquée, le jour où un filtre par chemin n'avait
// pas pris. Relevé par un audit externe (CODEX, 15/09).
//
// ⚠️ CE FICHIER EXISTE PARCE QUE LA RÉPONSE ÉTAIT ÉCRITE TROIS FOIS. Les configurations la disent,
// le banc structurel la redisait, et `mutations.mjs` la redevinait une troisième fois en lançant
// `npx vitest run <fichier>` sans configuration — ce qui l'a rendu NON CONCLUANT sur onze mutants à
// la minute où `charge/**` est sorti de la configuration générale. « Un fait qui existe en deux
// exemplaires non confrontés dérive » : il n'en existe plus qu'un, ici.
//
// Usage : node tools/configuration-des-bancs.mjs [--racine=.]

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { conclure, conforme, violation, inconclusif, tenterAsync } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** `{a,b}` d'abord — une alternative peut contenir des `*`, qui se traduisent après. */
export const developperAccolades = (motif) => {
  const m = String(motif).match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [String(motif)];
  return m[2].split(",").flatMap((x) => developperAccolades(`${m[1]}${x}${m[3]}`));
};

// Les deux jalons mettent `**` à l'abri du traitement de `*`. Sans eux, `**` deviendrait
// `[^/]*[^/]*`, qui ne traverse AUCUN dossier : le motif ne correspondrait plus à rien et la garde
// serait verte sur rien — la vacuité exacte que tout ce dossier existe pour refuser.
const JALON_GLOBSTAR_SLASH = "\u{1F7E0}GLOBSTAR_SLASH\u{1F7E0}";
const JALON_GLOBSTAR = "\u{1F7E0}GLOBSTAR\u{1F7E0}";

/** Le sous-ensemble de glob que ces configurations emploient, traduit sans deviner le reste. */
export const motifEnRegExp = (motif) => {
  const corps = developperAccolades(motif)
    .map((v) =>
      v
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("**/", JALON_GLOBSTAR_SLASH)
        .replaceAll("**", JALON_GLOBSTAR)
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replaceAll(JALON_GLOBSTAR_SLASH, "(?:.*/)?")
        .replaceAll(JALON_GLOBSTAR, ".*"),
    )
    .join("|");
  return new RegExp(`^(?:${corps})$`);
};

/** La configuration que Vitest prend quand personne n'en nomme : elle n'a pas de commande à elle. */
export const GENERALE = "vitest.config.mjs";

/** Ce qui n'est pas un banc de ce dépôt, et ne le deviendra pas : une exclusion peut les nommer. */
export const HORS_BANCS = new Set(["node_modules/**", "examples/**"]);

export const configurations = (racine = ".") =>
  readdirSync(racine).filter((f) => /^vitest(\..+)?\.config\.mjs$/.test(f)).sort();

/** Tous les fichiers de banc du dépôt, à la source — jamais une liste recopiée. */
export function bancs(racine = ".") {
  const trouves = [];
  const visiter = (d, prefixe) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const rel = prefixe ? `${prefixe}/${e.name}` : e.name;
      if (e.isDirectory()) { visiter(join(d, e.name), rel); continue; }
      if (/\.(test|spec)\.(ts|js)$/.test(e.name)) trouves.push(rel);
    }
  };
  visiter(racine, "");
  // `examples/` porte des dépôts d'exemple avec leurs propres bancs : ils ne sont pas les nôtres.
  return trouves.filter((p) => !p.startsWith("examples/")).sort();
}

/** `{ nom: { include, exclude } }` — le `test` de chaque configuration, lu depuis le fichier. */
export async function chargerConfigurations(racine = ".") {
  const par = new Map();
  for (const f of configurations(racine)) {
    // `resolve` et pas `join` : une racine ABSOLUE — celle des arbres d'éprouvette — serait
    // recollée derrière le dossier courant par `join`, et l'import échouerait loin de sa cause.
    const mod = await import(pathToFileURL(resolve(racine, f)).href);
    par.set(f, (mod.default && mod.default.test) || {});
  }
  return par;
}

export const couvre = (test, fichier) =>
  (test.include || []).some((m) => motifEnRegExp(m).test(fichier))
  && !(test.exclude || []).some((m) => motifEnRegExp(m).test(fichier));

/** Les configurations qui jouent ce banc. Zéro ou deux sont des fautes ; ce tableau les nomme. */
export const configurationsDe = (par, fichier) => [...par].filter(([, t]) => couvre(t, fichier)).map(([nom]) => nom);

/**
 * La configuration à passer à `vitest run` pour ce banc — `null` pour la générale, que Vitest prend
 * d'elle-même. Ce que `mutations.mjs` demande, et ce qu'il devinait de travers.
 */
export const configurationDe = (par, fichier) => {
  const trouvees = configurationsDe(par, fichier).filter((c) => c !== GENERALE);
  return trouvees.length === 1 ? trouvees[0] : null;
};

export async function auditerConfigurationDesBancs({ racine = "." } = {}) {
  const noms = configurations(racine);
  // ⚠️ ZÉRO N'EST JAMAIS UNE CONFORMITÉ. Sur un arbre sans configuration ou sans banc, il n'y a rien
  // à confronter : le dire NON CONCLUANT est la seule réponse honnête.
  if (!noms.length) return inconclusif("aucune configuration vitest trouvée : il n'y a rien à confronter");
  const fichiers = bancs(racine);
  if (!fichiers.length) return inconclusif("aucun fichier de banc trouvé : la confrontation n'aurait pas de sujet");

  const par = await chargerConfigurations(racine);
  const constats = [];
  for (const f of fichiers) {
    const jouants = configurationsDe(par, f);
    if (jouants.length > 1) constats.push(`${f} est joué par ${jouants.length} configurations (${jouants.join(", ")}) — il coûte deux fois, écrit deux fois dans la même base d'essai, et reste vert`);
    if (jouants.length === 0) constats.push(`${f} n'est joué par AUCUNE configuration — il ne protège plus rien, et son vert d'hier le laisse croire`);
  }
  // Le symétrique : une exclusion qui ne désigne plus rien a l'air de protéger et ne protège rien.
  for (const [nom, t] of par) {
    for (const motif of t.exclude || []) {
      if (HORS_BANCS.has(motif)) continue;
      if (!fichiers.some((f) => motifEnRegExp(motif).test(f))) constats.push(`${nom} écarte « ${motif} », qui ne désigne aucun banc existant — une exclusion morte fait croire qu'un cas est traité`);
    }
  }
  // Et une configuration que personne ne lance est un banc qui ne tourne nulle part.
  const lances = Object.values(JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).scripts || {}).join("\n");
  for (const nom of noms) {
    if (nom !== GENERALE && !lances.includes(nom)) constats.push(`${nom} n'est lancée par aucune commande npm — écarter un banc du banc général ne le fait pas tourner ailleurs`);
  }

  if (constats.length) return violation(constats);
  return conforme(`${fichiers.length} banc(s) répartis sur ${noms.length} configuration(s) : chacun joué une fois, et une seule`);
}

if (estExecuteDirectement(import.meta.url)) {
  const racine = (process.argv.slice(2).find((x) => x.startsWith("--racine=")) || "--racine=.").slice("--racine=".length);
  conclure(await tenterAsync(() => auditerConfigurationDesBancs({ racine })));
}
