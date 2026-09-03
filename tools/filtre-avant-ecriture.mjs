// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN DELETE OU UN PATCH SANS FILTRE ÉCRIT LA TABLE ENTIÈRE — ET UN HÔTE NOUS EN A DONNÉ LE PRIX.
//
// ⚠️ CETTE GARDE EST VERTE LE JOUR OÙ ELLE EST ÉCRITE, ET C'EST NORMAL. Tous nos sites d'écriture
// portent déjà un filtre ; ce n'est pas ce qu'elle protège. Elle protège le PROCHAIN, écrit dans six
// mois par quelqu'un qui n'aura pas cette conversation en tête.
//
// ⚠️ CE QUI LA MOTIVE EST UNE MESURE D'HÔTE, PAS UNE CRAINTE. Un intégrateur a `safeupdate` préchargé
// sur le rôle `authenticator` : chez lui, un `DELETE` ou un `UPDATE` sans clause de restriction est
// REFUSÉ, même sous `service_role`. Il nous l'a signalé après l'avoir payé — une de nos fonctions
// échouait pour cette raison, et le message d'erreur ne nommait pas `safeupdate`.
//
// Il faut lire ce refus à l'envers de l'intuition : `safeupdate` n'est pas l'obstacle, c'est le
// FILET. Chez lui, l'écriture sans filtre échoue bruyamment. Chez un hôte qui ne l'a pas — et rien
// dans le contrat ne l'exige — la MÊME ligne de code réussit, et vide la table. Le défaut n'est donc
// pas visible là où il se manifeste : il est silencieux exactement là où il est grave.
//
// ⚠️ ET UNE ÉCRITURE SANS FILTRE EST INDISTINGUABLE D'UNE ÉCRITURE VOULUE, dans le code comme dans
// la revue. `?select=id` ressemble à une requête complète ; ce n'est pas un filtre, c'est une
// projection. La garde exige donc un prédicat — un `=` dont la gauche n'est ni `select`, ni `order`,
// ni `limit`, ni `offset` — et non la simple présence d'un `?`.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZONES = ["server", "context"];

/**
 * ⚠️ LE SOURCE SANS SES COMMENTAIRES — et cette ligne a coûté trois gardes en une journée. Un motif
 * qui cherche une FORME dans du texte non classé accuse la prose qui documente la règle. C'est la
 * même orthographe que `sourceUtile` ailleurs dans ce dossier, délibérément : deux épellations de la
 * même idée divergent, et celle qui diverge est celle qu'on ne relit pas.
 */
export function sourceUtile(texte) {
  return texte.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
}

/** Les mots-clés PostgREST qui ressemblent à un filtre sans en être un. */
const PAS_UN_FILTRE = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

/**
 * ⚠️ UN PRÉDICAT, PAS UN POINT D'INTERROGATION. `table?select=id` a bien un `?` et n'restreint rien.
 * On cherche donc un `cle=` dont la clé n'est pas une option de présentation — y compris quand elle
 * est interpolée (`${colId}=in.(…)`), qui est notre forme réelle dans `retention.js`.
 */
export function porteUnFiltre(chemin) {
  const q = chemin.indexOf("?");
  if (q < 0) return false;
  for (const morceau of chemin.slice(q + 1).split("&")) {
    const eg = morceau.indexOf("=");
    if (eg <= 0) continue;
    const cle = morceau.slice(0, eg).trim();
    if (!cle) continue;
    // Une clé interpolée (`${colId}`) est un nom de colonne fourni par l'appelant : c'est un filtre.
    if (cle.startsWith("${")) return true;
    if (!PAS_UN_FILTRE.has(cle)) return true;
  }
  return false;
}

const ECRITURES = /method:\s*"(DELETE|PATCH|PUT)"/;

/**
 * Rend un site d'écriture par appel `request(<chemin>, { … method: "DELETE" … })`. On lit le chemin
 * littéral tel qu'écrit — gabarit compris — parce que c'est ce qu'un relecteur voit.
 */
export function sitesDEcriture(source) {
  const sites = [];
  const re = /request\(\s*(`[^`]*`|"[^"]*"|'[^']*')\s*,\s*(\{[\s\S]{0,600}?\})\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const options = m[2];
    const verbe = ECRITURES.exec(options);
    if (!verbe) continue;
    sites.push({ chemin: m[1].slice(1, -1), verbe: verbe[1], index: m.index });
  }
  return sites;
}

function fichiersJs(dossier) {
  const out = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const p = join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiersJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

export function auditer(racine = RACINE) {
  const constats = [];
  let vus = 0;
  for (const zone of ZONES) {
    for (const fichier of fichiersJs(join(racine, zone))) {
      const source = sourceUtile(readFileSync(fichier, "utf8"));
      for (const site of sitesDEcriture(source)) {
        vus += 1;
        if (porteUnFiltre(site.chemin)) continue;
        const ligne = source.slice(0, site.index).split("\n").length;
        constats.push(`${fichier.slice(racine.length + 1)}:${ligne} — ${site.verbe} sans prédicat `
          + `sur « ${site.chemin} » : cette écriture porte sur la TABLE ENTIÈRE chez un hôte sans `
          + "`safeupdate`. Ajoutez une restriction (`col=eq.…`, `id=in.(…)`).");
      }
    }
  }
  // ⚠️ ZÉRO SITE VU N'EST PAS UNE CONFORMITÉ. C'est la règle anti-vacuité de ce dépôt : un plancher
  // compte la FORME RECONNUE, pas les choses trouvées. Si le motif cesse de reconnaître nos appels —
  // une refonte, un enrobage — la garde deviendrait verte en ne regardant plus rien.
  if (!vus) {
    return inconclusif("aucun site d'écriture reconnu dans " + ZONES.join(", ")
      + " — la sonde vise à côté, ou la forme des appels a changé : rien n'a été vérifié");
  }
  if (constats.length) return violation(constats);
  return conforme(`${vus} écriture(s) DELETE/PATCH/PUT, toutes avec un prédicat`);
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
