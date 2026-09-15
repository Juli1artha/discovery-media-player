#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE TABLEAU D'UNE CAMPAGNE, ÉCRIT DEPUIS SES OCTETS — PARCE QUE JE L'AI RECOPIÉ À LA MAIN ET
// QU'IL ÉTAIT FAUX.
//
// ⚠️ CE QUI EST ARRIVÉ (14/09). J'ai relayé aux hôtes le relevé de la course d'une PR — version
// 0.1.167, commit 8e9e37c, course gha-34894663303-1 — en le présentant comme celui du tag 0.1.168
// (commit f5f0ae7, course gha-34897302599-1). Les deux campagnes étaient vraies. Une seule mesurait
// le tag. Personne ne pouvait le voir : le tableau ne portait ni course, ni version, ni commit, et
// les percentiles avaient été recopiés à la main d'un journal vers un message. Relevé par un
// auditeur externe (CODEX, 15/09), qui a lu les JSON plutôt que le tableau.
//
// ⚠️ LA CONSIGNE « FAIRE ATTENTION » NE CORRIGE RIEN. Ce qui corrige, c'est de retirer l'occasion :
// le tableau se DÉRIVE des fichiers, l'en-tête porte la provenance, et chaque JSON est accompagné
// de son sha256. Un lecteur peut alors confronter ce qu'il lit à ce qui est attaché, sans nous
// croire sur parole — c'est la seule forme de confiance que ce dépôt cherche à mériter.
//
// ⚠️ ET IL NE RÉSUME QUE CE QU'IL A JUGÉ. Produire un joli tableau à partir d'une cohorte que le
// validateur refuse serait pire que de n'en produire aucun : une présentation soignée fait passer
// des chiffres pour vérifiés. Le résumé est donc REFUSÉ quand la cohorte l'est.
//
// Usage : node tools/resume-de-charge.mjs --fichier=a.json --fichier=b.json [--run-url=…]

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";

import { auditer } from "./artefact-de-charge.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Le sha256 des OCTETS du fichier — ce qu'un lecteur peut recalculer sur ce qu'il a téléchargé. */
export const empreinteFichier = (chemin) => createHash("sha256").update(readFileSync(chemin)).digest("hex");

/** Un nombre tel qu'on l'écrit dans un tableau : virgule décimale, sans zéros inutiles. */
export const nombreFr = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v).replace(".", ",") : "—");

/** Le tableau des positions d'une cohorte, dans l'ordre de la séquence. */
export function tableau(artefacts) {
  const lignes = [
    "| Position | Spectateurs | p50 / p95 / p99 (ms) | Retard générateur p99 | Cache servies / regroupées / produites | Appels base |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const a of [...artefacts].sort((x, y) => x.scenario.position - y.scenario.position)) {
    if (!a.complete) {
      lignes.push(`| ${a.scenario.position} | ${a.scenario.spectators} | **interrompue** — ${a.failure.code} : ${a.failure.reason} | | | |`);
      continue;
    }
    const l = a.latencyMs;
    lignes.push(`| ${a.scenario.position} | ${a.scenario.spectators} | ${nombreFr(l.p50)} / ${nombreFr(l.p95)} / ${nombreFr(l.p99)} | ${nombreFr(a.workload.generatorLagMs.p99)} ms | ${a.cache.hits} / ${a.cache.coalesced} / ${a.cache.misses} | ${a.database.calls} |`);
  }
  return lignes.join("\n");
}

/**
 * La provenance, EN TÊTE ET PAS EN NOTE. C'est elle qui manquait le 14/09 : un tableau sans course,
 * sans version et sans commit ne peut pas être confronté, donc ne peut pas être contredit.
 */
export function entete(artefacts, { runUrl = "" } = {}) {
  const id = artefacts[0].identity;
  const t = artefacts[0].topology;
  const lignes = [
    `**Course** \`${id.runId}\` · **version** \`${id.packageVersion}\` · **commit** \`${id.commitSha}\``,
    `**Dépôt** \`${id.repository}\` · **évènement** \`${id.event}\` · **réf** \`${id.ref}\`${id.prHeadSha ? ` · **tête de PR** \`${id.prHeadSha}\`` : ""}`,
  ];
  if (runUrl) lignes.push(`**Course sur la forge** : ${runUrl}`);
  lignes.push("", `**Topologie** : client → player \`${t.clientToPlayer}\`, player → base \`${t.playerToDatabase}\`, ${t.playerProcesses} processus.`);
  return lignes.join("\n");
}

const nombre = (v) => typeof v === "number" && Number.isFinite(v);
const parSeconde = (quantite, ms) => (nombre(quantite) && nombre(ms) && ms > 0 ? (quantite / ms) * 1000 : null);

/**
 * ⚠️ CE QUE LA CADENCE VAUT VRAIMENT, DIT PLUTÔT QUE SOUS-ENTENDU. Le contrat hôte décrit un
 * spectateur qui relit son état toutes les 25 secondes — soit environ 40 requêtes par seconde pour
 * mille spectateurs. Cette campagne en PLANIFIE 2 500. C'est un test de contrainte délibéré, à peu
 * près 62 fois la cadence nominale, et c'est une bonne chose — mais un lecteur qui l'ignore croit
 * lire une charge réaliste. Le facteur était absent du JSON comme du tableau : il se calcule ici.
 *
 * ⚠️ ET TROIS CADENCES, PAS UNE — PARCE QUE LA PREMIÈRE RÉDACTION EN ANNONÇAIT UNE POUR UNE AUTRE.
 * Elle écrivait « 2 500 requêtes/s » sous le nom de DÉBIT, alors qu'elle divisait les requêtes
 * PLANIFIÉES par la durée VISÉE : deux quantités qui existent avant la moindre mesure. Un tel
 * chiffre est vrai tant que rien ne rate, et il reste identique le jour où la moitié des requêtes
 * n'est jamais partie — exactement le jour où un lecteur avait besoin de le voir bouger. Le débit
 * RÉELLEMENT atteint se lit ailleurs : requêtes ACHEVÉES ÷ durée de la fenêtre MESURÉE. Les trois
 * sont donc nommées séparément, et leur écart est un fait, pas une approximation. Relevé par un
 * audit externe (CODEX, 15/09).
 *
 *   • `planifiee` — ce que le générateur devait envoyer (intention) ;
 *   • `lancee`    — ce qu'il a effectivement mis en vol (le générateur a-t-il tenu ?) ;
 *   • `atteinte`  — ce qui est revenu, rapporté à la fenêtre mesurée (le seul débit observé).
 *
 * `facteur` porte sur la PLANIFIÉE, et son nom le dit dans le texte : c'est une propriété du
 * scénario — « quelle contrainte ai-je demandée » — et non un résultat de la campagne.
 */
export function cadence(a, { secondesEntreLectures = 25 } = {}) {
  const w = a.workload || {};
  const planifiee = parSeconde(w.scheduledRequests, w.targetDurationMs);
  const lancee = parSeconde(w.startedRequests, w.targetDurationMs);
  const atteinte = parSeconde(w.completedRequests, (a.measurementWindow || {}).durationMs);
  const nominale = a.scenario.spectators / secondesEntreLectures;
  return { planifiee, lancee, atteinte, nominale, facteur: nominale > 0 && planifiee !== null ? planifiee / nominale : null };
}

/** Le résumé complet : provenance, tableau, cadence, et l'empreinte de chaque fichier attaché. */
export function resume(fichiers, { runUrl = "" } = {}) {
  const artefacts = fichiers.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const parties = [entete(artefacts, { runUrl }), "", tableau(artefacts)];

  const complets = artefacts.filter((a) => a.complete);
  if (complets.length) {
    const c = cadence(complets[complets.length - 1]);
    const req = (v) => (v === null ? "—" : `${Math.round(v)}`);
    parties.push("", `⚠️ **Cadence**, à la dernière position complète : **${req(c.planifiee)} planifiées/s**, **${req(c.lancee)} lancées/s**, **${req(c.atteinte)} atteintes/s** (requêtes achevées ÷ durée de la fenêtre mesurée — le seul débit observé des trois). La cadence nominale du contrat hôte est d'environ **${Math.round(c.nominale)}/s** pour une relecture d'état toutes les 25 s : le facteur de cadence **planifiée** vaut donc environ **${c.facteur === null ? "—" : c.facteur.toFixed(1)}×**. C'est une contrainte délibérée, pas une charge réaliste.`);
  }

  parties.push("", "**Fichiers attachés**, à confronter avec ce qui précède :", "");
  parties.push("| Fichier | sha256 |", "| --- | --- |");
  for (const f of fichiers) parties.push(`| \`${basename(f)}\` | \`${empreinteFichier(f)}\` |`);
  return parties.join("\n");
}

export function auditerResume({ fichiers, runUrl = "", racine } = {}) {
  if (!fichiers || !fichiers.length) return inconclusif("aucun fichier donné : il n'y a pas de campagne à résumer, et un résumé vide se lirait comme une campagne vide");
  // ⚠️ ON NE RÉSUME QUE CE QU'ON A JUGÉ. Un tableau bien présenté fait passer ses chiffres pour
  // vérifiés : le produire sur une cohorte refusée serait mettre la forme au service du faux.
  const verdict = auditer({ racine, fichiers });
  if (verdict.code !== 0) {
    return violation(`la cohorte est refusée, il n'y a donc rien à résumer :\n    ${(verdict.constats || verdict.raisons || []).join("\n    ")}`);
  }
  return tenter(() => conforme(resume(fichiers, { runUrl })));
}

if (estExecuteDirectement(import.meta.url)) {
  const argv = process.argv.slice(2);
  const fichiers = argv.filter((x) => x.startsWith("--fichier=")).map((x) => x.slice("--fichier=".length));
  const runUrl = (argv.find((x) => x.startsWith("--run-url=")) || "").slice("--run-url=".length);
  conclure(auditerResume({ fichiers, runUrl }));
}
