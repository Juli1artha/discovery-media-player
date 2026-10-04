// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN BANC QUI DÉPEND DE SON RANG NE PROUVE PAS CE QU'IL ANNONCE.
//
// ⚠️ CETTE RÈGLE ÉTAIT DÉJÀ ÉCRITE DANS LE DÉPÔT, À LA MAIN, AU-DESSUS D'UN MÉCANISME QUI NE
// L'APPLIQUAIT PAS. `server/__tests__/repliRpcSignature.test.js` portait le commentaire « un essai
// qui dépend de son rang dans le fichier ne prouve pas ce qu'il annonce » au-dessus d'un essai qui
// appelait `vi.resetModules()` puis `require` pour obtenir un module neuf. MESURÉ : les deux
// rendent le MÊME objet d'exports en CommonJS — `resetModules` vide le registre des modules
// transformés par vite, pas le cache `require` de Node. L'essai lisait donc l'héritage de ses
// voisins depuis toujours, et ne passait que parce qu'il se trouve en tête de son bloc.
//
// ⚠️ ET LE DÉFAUT QU'IL MASQUAIT ÉTAIT EN PRODUCTION, PAS DANS LE BANC. `presentations.init()`
// jetait le mémo du durcissement et gardait celui de la fusion, alors que le fichier écrit TROIS
// FOIS que les deux jumeaux se comportent pareil. Un hôte qui rappelle `init` avec une autre base
// lisait une observation faite sur la base précédente sous le nom de la nouvelle.
//
// ⚠️ CE QUE CETTE GARDE NE FAIT PAS, ET C'EST DÉLIBÉRÉ : elle ne réclame pas que TOUT banc survive
// au mélange. Deux fichiers dépendent de leur ordre LÉGITIMEMENT et le DÉCLARENT eux-mêmes —
// l'un assert `bancsCrees === 1` en disant pourquoi, l'autre porte un relevé daté qui résume ce que
// les bancs d'avant viennent de mesurer. Rougir dessus, ce serait crier sur du bon code : la façon
// dont une garde finit désactivée. Ils sont donc NOMMÉS ici, avec leur raison, et rendus en
// avertissement à chaque exécution — une dette déclarée, pas une exemption muette.
//
// ⚠️ UN ÉCHEC SOUS MÉLANGE N'EST PAS UNE PREUVE DE DÉPENDANCE À L'ORDRE — IL FAUT LE CONTRÔLE DE
// STIMULUS. Première écriture de cette garde : elle accusait tout fichier rouge sous mélange. Le
// plancher `planchersDesGardes` l'a REFUSÉE, et il avait raison — son éprouvette copie `tools/`
// en entier (`__tests__` compris) dans un arbre vide, donc vitest y trouve des bancs qui échouent
// faute de dépôt, et cette garde les déclarait dépendants de leur rang. Elle nommait le mauvais
// coupable, ce qui est la façon dont une garde perd sa crédibilité.
//
// Chaque fichier rouge sous mélange est donc REJOUÉ SEUL, SANS mélange. S'il échoue aussi, l'échec
// préexiste et cette garde n'a rien à en dire ; s'il passe, le mélange est bien la cause. Et si des
// échecs préexistent, la question de l'ordre ne peut pas être posée du tout : NON CONCLUANT, parce
// qu'une suite déjà rouge ne dit rien sur l'ordre de ses essais.
//
// ⚠️ CETTE GARDE NE SE LANCE PAS DEPUIS UN LANCEMENT DE BANCS, ET C'EST UNE PROPRIÉTÉ, PAS UNE
// COMMODITÉ. Elle lance la suite ; or `planchersDesGardes` lance CHAQUE outil de `tools/`, donc
// celui-ci, donc la suite — qui contient `planchersDesGardes`. Écrite sans ce garde-fou, elle a
// fait exactement ce qu'on attend d'une imbrication : le banc ne finissait plus. `VITEST` est posé
// par vitest lui-même ; sa présence signifie « tu es DÉJÀ dans une exécution de bancs ». On rend
// alors NON CONCLUANT — ce qui est exact, puisque rien n'a été vérifié — plutôt que de mentir dans
// un sens ou dans l'autre.
//
// ⚠️ LA GRAINE EST IMPRIMÉE, ET C'EST LA CONDITION POUR QU'UN ROUGE SOIT REJOUABLE. Une garde non
// déterministe dont l'échec ne se reproduit pas est un rouge qu'on apprend à ignorer. Par défaut la
// graine est le jour UTC : stable sur une journée, variable d'un jour à l'autre. Un défaut peut donc
// se cacher un jour et sortir le lendemain — c'est le prix du balayage, il est écrit plutôt que tu.
// `--graine=<n>` rejoue exactement.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Les fichiers dont l'ordre INTERNE est un contrat, avec la raison. Chacun est relu à chaque
 * exécution : une entrée qui n'a plus de raison d'être se lit ici, elle ne se devine pas.
 *
 * ⚠️ CETTE LISTE NE SE PURGE PAS TOUTE SEULE, ET LA GARDE NE PEUT PAS LE FAIRE POUR ELLE. Un
 * fichier déclaré qui passe sous UNE graine n'a rien prouvé : il pouvait ne pas être mélangé de la
 * façon qui le casse. Retirer une entrée est une décision humaine, pas une déduction.
 *
 * ⚠️ ET DEUX ENTRÉES EN SONT SORTIES PARCE QU'ON A RÉPARÉ, PAS PARCE QU'ELLES PASSAIENT.
 * `finDePresentation` exigeait d'être en tête : ses écouteurs de départ de page sont désormais
 * RETIRÉS entre bancs, comme l'étaient déjà ses minuteries, et un essai monte deux bancs exprès
 * pour le prouver. `coutParGeste` portait deux verdicts agrégés écrits en `it()` : ils vivent dans
 * `afterAll`, où un verdict sur l'ensemble appartient. Déclarer était plus facile que réparer ;
 * c'est un audit externe qui a demandé l'inverse, et il avait raison.
 */
export const ORDRE_DECLARE = new Map([
  ["tools/__tests__/planchersDesGardes.test.js",
    "le dernier essai RÉSUME les essais générés au-dessus (un par garde) en lisant ce qu'ils ont accumulé — il le déclare lui-même, et dit combien ont tourné quand il s'exécute trop tôt"],
]);

export const grainePourJour = (d = new Date()) =>
  Number(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);

// ⚠️ ON LIT LE RAPPORT JSON DE VITEST, JAMAIS SA SORTIE TEXTE. La première écriture cherchait les
// lignes « FAIL <chemin> » dans tout ce que vitest imprimait — y compris ce que les bancs eux-mêmes
// impriment : plusieurs lancent des gardes en sous-processus qui écrivent volontairement « FAIL ».
// La garde prenait ces fichiers pour « déjà rouges », rendait NON CONCLUANT, et ce non-concluant
// passait AVANT une violation confirmée : une vraie dépendance d'ordre (routeSlugEtSaturation, graine
// 20260913) est restée masquée derrière. Relevé par un audit externe le 13/09. Un rapport structuré
// ne contient que des verdicts ; une chaîne imprimée n'en est pas un.
/** Les fichiers en échec d'un rapport JSON de vitest (`--reporter=json`), relatifs à `racine`. */
export function fichiersEnEchec(rapport, racine = RACINE) {
  const vus = new Set();
  const resultats = rapport && Array.isArray(rapport.testResults) ? rapport.testResults : [];
  for (const t of resultats) if (t && t.status === "failed") vus.add(relatif(String(t.name || ""), racine));
  return [...vus];
}

/** Le compte de fichiers de bancs du rapport — l'objet de la sonde, pour refuser le vide. `null` si illisible. */
export function fichiersVus(rapport) {
  const n = rapport && Array.isArray(rapport.testResults) ? rapport.testResults.length : 0;
  return n > 0 ? n : null;
}

function relatif(chemin, racine) {
  const r = String(racine).replace(/\/+$/, "") + "/";
  return chemin.startsWith(r) ? chemin.slice(r.length) : chemin;
}

// ⚠️ LE REJEU INDIVIDUEL CONCLUAIT SUR LE CODE DE SORTIE SEUL. Le rapport JSON était lu pour le
// mélange, mais « passe-t-il seul ? » se décidait par `r.status === 0` — c'est-à-dire « le processus
// a-t-il échoué ? » pour répondre à « qu'a rendu le banc ? », la classe qu'AGENTS.md documente. Un
// audit externe a vu la garde déclarer six fichiers « déjà rouges » que 6/6 rejouaient verts à la
// main (septième passe, 14/09). ⚠️ ET LA PREMIÈRE CORRECTION NE CONFRONTAIT QUE LES REJEUX : l'exécution
// mélangée initiale lisait le rapport sans regarder le processus — un rapport vert écrit PUIS un
// processus qui sort en 1 rendait « conforme » —, et `status: null` (tué par signal) passait pour un
// code non nul concordant (huitième passe). Une seule confrontation, pour TOUTE exécution de vitest.
/**
 * Confronte le rapport JSON d'une exécution de vitest au processus qui l'a produit.
 *   rapport entièrement vert + code 0 + aucun signal            → `vert`
 *   rapport avec au moins un rouge + code ENTIER non nul, aucun signal → `rouge` (avec les fichiers)
 *   toute autre combinaison                                     → `non-concluant`, avec la raison
 */
export function confronterExecution({ r, rapport, racine = RACINE }) {
  const code = r ? r.status : undefined, signal = r ? r.signal : undefined;
  const resultats = rapport && Array.isArray(rapport.testResults) ? rapport.testResults : null;
  const pieces = () => {
    const statuts = resultats ? resultats.map((x) => `${relatif(String(x && x.name || ""), racine)}=${x && x.status}`).join(", ") : "aucun";
    const stderr = String((r && r.stderr) || "").trim().split("\n").slice(-8).join("\n");
    return `code ${code}, signal ${signal || "aucun"} — statuts du rapport : ${statuts}${stderr ? `\n  stderr (fin) : ${stderr.replace(/\n/g, "\n  ")}` : ""}`;
  };
  if (!resultats || !resultats.length) return { etat: "non-concluant", rouges: [], raison: `rapport JSON absent ou vide (${pieces()})` };
  const inattendus = resultats.filter((x) => !x || (x.status !== "passed" && x.status !== "failed"));
  if (inattendus.length) return { etat: "non-concluant", rouges: [], raison: `statut(s) inattendu(s) dans le rapport (${pieces()})` };
  const rouges = fichiersEnEchec(rapport, racine);
  if (signal) return { etat: "non-concluant", rouges, raison: `processus tué par un signal, pas un verdict (${pieces()})` };
  if (!rouges.length && code === 0) return { etat: "vert", rouges: [] };
  if (rouges.length && Number.isInteger(code) && code !== 0) return { etat: "rouge", rouges };
  return { etat: "non-concluant", rouges, raison: `désaccord instrument/processus : le rapport dit ${rouges.length ? `${rouges.length} rouge(s)` : "tout vert"}, le processus rend ${code === null ? "null" : `le code ${code}`} (${pieces()})` };
}

/**
 * Classe le rejeu SEUL d'un fichier : `passe-seul`, `rouge-prealable`, ou `non-concluant` (avec la
 * raison) quand le rapport et le processus ne disent pas la même chose, ou que le rapport manque.
 */
export function classerRejeu({ fichier, r, rapport, racine = RACINE }) {
  const e = confronterExecution({ r, rapport, racine });
  if (e.etat === "non-concluant") return { classe: "non-concluant", raison: `${fichier} : ${e.raison}` };
  const present = rapport.testResults.some((x) => relatif(String(x.name || ""), racine) === fichier);
  if (!present) return { classe: "non-concluant", raison: `le rapport ne contient pas ${fichier} (il contient : ${rapport.testResults.map((x) => relatif(String(x.name || ""), racine)).join(", ")})` };
  return e.etat === "vert" ? { classe: "passe-seul" } : { classe: "rouge-prealable" };
}

// ⚠️ LE CONTRÔLE ÉTAIT EXÉCUTÉ APRÈS LE STIMULUS QUI LE CONTAMINE. Rejoué immédiatement après une
// suite mélangée lourde, un fichier pouvait rougir d'épuisement (sockets, processus, disque) et
// passer pour un « rouge préalable » ; quelques instants plus tard, 6/6 verts (audit, huitième passe).
// Un contrôle exécuté après le stimulus ne prouve pas que le défaut lui préexistait. Deux
// confirmations ISOLÉES par rouge — seul en ordre normal, seul mélangé sous la même graine — et une
// table qui ne conclut « dépendance » que sur vert/rouge :
//   normal vert  + mélangé rouge → dépendance intra-fichier confirmée
//   normal vert  + mélangé vert  → interférence de la suite complète, PAS une dépendance d'ordre
//   normal rouge + mélangé rouge → rouge indépendant de l'ordre
//   normal rouge + mélangé vert  → instable, non concluant
//   toute discordance rapport/processus → non concluant
/** Classe un fichier rouge sous la suite mélangée d'après ses deux confirmations isolées. */
export function classerRouge({ normal, melange }) {
  const n = normal.classe, m = melange.classe;
  if (n === "non-concluant" || m === "non-concluant") return { classe: "non-concluant", raison: [normal.raison, melange.raison].filter(Boolean).join(" ; ") };
  if (n === "passe-seul" && m === "rouge-prealable") return { classe: "dependance" };
  if (n === "passe-seul" && m === "passe-seul") return { classe: "interference" };
  if (n === "rouge-prealable" && m === "rouge-prealable") return { classe: "rouge-independant" };
  return { classe: "instable" };
}

/** Les pièces conservées pour un rouge : messages d'échec du rapport, code, signal, fin de stderr, graine, mode. */
// ⚠️ « Error: STACK_TRACE_ERROR » N'EST PAS UNE CAUSE. La première ligne d'un `failureMessages` de
// vitest est parfois ce libellé, la cause étant deux lignes plus bas — et un échec de hook peut ne
// laisser qu'un `testResult.message`, ou rien. On prend la première ligne INFORMATIVE, on ajoute le
// `message` du fichier quand il existe, et quand aucune pièce n'est exploitable on le DIT, avec la
// commande qui en produira (audit, neuvième passe).
const LIGNE_VIDE_DE_SENS = /^\s*(Error:?\s*)?(STACK_TRACE_ERROR)?\s*$/;
export const premiereLigneInformative = (texte) => (String(texte || "").split("\n").map((l) => l.trim()).find((l) => l && !LIGNE_VIDE_DE_SENS.test(l) && !/^at /.test(l)) || "").slice(0, 200);
export function piecesDe({ fichier, r, rapport, graine, mode, racine = RACINE }) {
  const t = rapport && Array.isArray(rapport.testResults) ? rapport.testResults.find((x) => relatif(String(x && x.name || ""), racine) === fichier) : null;
  const messages = t && Array.isArray(t.assertionResults)
    ? t.assertionResults.filter((a) => a && a.status === "failed").flatMap((a) => (a.failureMessages || []).map((m) => premiereLigneInformative(m)).filter(Boolean).map((m) => `${a.fullName || a.title} — ${m}`))
    : [];
  const messageFichier = t && typeof t.message === "string" && t.message.trim() ? premiereLigneInformative(t.message) : "";
  const stderr = String((r && r.stderr) || "").trim().split("\n").slice(-5).join(" | ");
  // ⚠️ UNE EXÉCUTION VERTE N'A PAS DE CAUSE À DONNER. La confirmation isolée d'un rouge peut être
  // verte (interférence de la suite complète, instable), et la pièce lui réclamait alors un rejeu
  // verbose « pour trouver la cause » — d'un succès. Relevé par l'audit sur la 0.1.167 (dixième
  // passe). « Aucune cause exploitable » ne se dit que d'une exécution non verte ou incohérente :
  // code 0 sans signal ET rapport « passed » pour ce fichier, c'est un vert, et un vert se tait.
  const executionVerte = !!r && r.status === 0 && !r.signal && !!t && t.status === "passed";
  const manqueCause = !executionVerte && !messages.length && !messageFichier && !stderr;
  return `${fichier} [${mode}${graine != null ? `, graine ${graine}` : ""}] code ${r && r.status}, signal ${(r && r.signal) || "aucun"}`
    + (messages.length ? ` ; échecs : ${messages.join(" ; ")}` : "")
    + (messageFichier ? ` ; message du fichier : ${messageFichier}` : "")
    + (stderr ? ` ; stderr : ${stderr.slice(0, 300)}` : "")
    + (manqueCause ? ` ; aucune cause exploitable dans le rapport JSON — rejouer : npx vitest run ${fichier} --reporter=verbose` : "");
}

/**
 * Le verdict, dans le bon ordre : une VIOLATION confirmée prime sur un cas non concluant. Rendre non
 * concluant dès qu'un rouge préexiste masquait la dépendance d'ordre prouvée à côté — le non-concluant
 * est alors dit en avertissement, pas en verdict.
 */
export function verdict({ constats, avertissements, raisonsNonConcluance, entete, vus }) {
  if (constats.length) {
    return violation([entete, ...constats], [...avertissements, ...raisonsNonConcluance.map((r) => `non concluant par ailleurs — ${r}`)]);
  }
  if (raisonsNonConcluance.length) return inconclusif([entete, ...raisonsNonConcluance], avertissements);
  return conforme(`${vus} fichiers de bancs passent leurs essais MÉLANGÉS (${entete})`, avertissements);
}

/** `--graine=a,b,jour` : plusieurs graines, `jour` = le jour UTC. Sans argument : le jour. */
export function grainesDemandees(argv, aujourdhui = grainePourJour()) {
  const arg = argv.find((a) => a.startsWith("--graine="));
  if (!arg) return [aujourdhui];
  // Dédoublonné : `jour` peut coïncider avec une graine fixe (le 13/09/2026, précisément).
  return [...new Set(arg.slice("--graine=".length).split(",").map((t) => t.trim()).filter(Boolean)
    .map((t) => (t === "jour" ? aujourdhui : Number(t))))];
}

export function confronter(dependants, dejaRouges, declares = ORDRE_DECLARE) {
  const constats = [], avertissements = [];
  // Un rouge qui existe déjà sans mélange n'appartient pas à cette garde : elle le dit et se tait.
  const raisonsNonConcluance = dejaRouges.map((f) =>
    `${f} échoue AUSSI dans l'ordre normal : la suite est rouge indépendamment du mélange, donc l'ordre de ses essais n'est pas mesurable`);
  for (const f of dependants) {
    const raison = declares.get(f);
    if (raison) avertissements.push(`ordre déclaré — ${f} : ${raison}`);
    else constats.push(`${f} passe SEUL dans l'ordre normal et échoue quand ses essais sont mélangés : un essai y dépend de son rang, donc il ne prouve pas ce qu'il annonce. Si l'ordre est un CONTRAT, déclarez le fichier dans ORDRE_DECLARE avec sa raison plutôt que de relâcher l'essai.`);
  }
  return { constats, avertissements, raisonsNonConcluance };
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    if (process.env.VITEST) return inconclusif([
      "lancée DEPUIS une exécution de bancs (VITEST est posé) : cette garde lance la suite, donc elle l'imbriquerait dans elle-même. Lancez-la depuis un terminal ou une étape de forge.",
    ]);

    const graines = grainesDemandees(process.argv);
    if (!graines.length || graines.some((g) => !Number.isFinite(g))) return inconclusif([`graine illisible : ${process.argv.find((a) => a.startsWith("--graine="))}`]);

    // Le rapport JSON va dans un fichier : la sortie texte reste lisible, et n'est jamais analysée.
    //
    // ⚠️ LE DOSSIER EST CRÉÉ PAR `mkdtempSync`, PAS COMPOSÉ À LA MAIN. Cette ligne fabriquait un
    // chemin dans le dossier temporaire — `pid` + `Math.random()` — et écrivait dedans. Le dossier
    // temporaire est PARTAGÉ et inscriptible par tous : un chemin qu'on compose peut déjà exister,
    // et qui l'a créé avant nous en décide les droits — ou y pose un lien qui renvoie ailleurs.
    // `Math.random()` n'est pas une source imprévisible, et `pid` se devine. `mkdtempSync` crée le
    // dossier de façon ATOMIQUE, en 0700, avec un suffixe que personne ne compose. Relevé par
    // CodeQL sur du code neuf de la PR 547 — celui-ci était déjà là, hors du diff, donc muet : la
    // même faute, corrigée au même endroit qu'elle aurait été redécouverte un jour.
    const rapportDe = (args) => {
      const dossier = mkdtempSync(join(tmpdir(), "ordre-des-bancs-"));
      const fichier = join(dossier, "rapport.json");
      const r = spawnSync("npx", ["vitest", "run", ...args, "--reporter=json", `--outputFile=${fichier}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const rapport = (() => { try { return JSON.parse(readFileSync(fichier, "utf8")); } catch { return null; } })();
      try { rmSync(dossier, { recursive: true, force: true }); } catch { /* déjà absent */ }
      return { r, rapport };
    };

    let vus = null;
    const rougesParGraine = new Map();   // fichier → graines sous lesquelles il a rougi
    const pieces = [];                   // ce qu'on conserve de chaque rouge : messages, code, signal, stderr, graine, mode
    for (const graine of graines) {
      const { r, rapport } = rapportDe(["--sequence.shuffle.tests", `--sequence.seed=${graine}`]);
      if (r.error) return inconclusif([`vitest n'a pas pu être lancé : ${r.error.message}`]);
      // ⚠️ Le rapport ET le processus — un rapport vert écrit puis un processus en 1 rendait « conforme ».
      const e = confronterExecution({ r, rapport });
      if (e.etat === "non-concluant") return inconclusif([`suite mélangée (graine ${graine}) : ${e.raison}`]);
      vus = fichiersVus(rapport);
      for (const f of e.rouges) {
        rougesParGraine.set(f, [...(rougesParGraine.get(f) || []), graine]);
        pieces.push(piecesDe({ fichier: f, r, rapport, graine, mode: "suite complète mélangée" }));
      }
    }

    // ⚠️ Deux confirmations ISOLÉES par rouge — seul en ordre normal, seul mélangé sous la même graine —
    // parce qu'un contrôle exécuté juste après la suite lourde peut rougir d'épuisement, pas d'ordre.
    const dependants = [], dejaRouges = [], nonConcluants = [], avertissementsRouges = [];
    for (const [f, sesGraines] of rougesParGraine) {
      const graine = sesGraines[0];
      const normal = rapportDe([f]);
      if (normal.r.error) return inconclusif([`rejeu de ${f} impossible : ${normal.r.error.message}`]);
      const melange = rapportDe([f, "--sequence.shuffle.tests", `--sequence.seed=${graine}`]);
      if (melange.r.error) return inconclusif([`rejeu mélangé de ${f} impossible : ${melange.r.error.message}`]);
      pieces.push(piecesDe({ fichier: f, r: normal.r, rapport: normal.rapport, mode: "seul, ordre normal" }));
      pieces.push(piecesDe({ fichier: f, r: melange.r, rapport: melange.rapport, graine, mode: "seul, mélangé" }));
      const c = classerRouge({
        normal: classerRejeu({ fichier: f, r: normal.r, rapport: normal.rapport }),
        melange: classerRejeu({ fichier: f, r: melange.r, rapport: melange.rapport }),
      });
      if (c.classe === "dependance") dependants.push(f);
      else if (c.classe === "rouge-independant") dejaRouges.push(f);
      else if (c.classe === "interference") nonConcluants.push(`${f} : rouge sous la suite complète mélangée, vert seul en ordre normal ET seul mélangé (graine ${graine}) — interférence de la suite complète (un autre fichier, ou l'environnement), pas une dépendance d'ordre intra-fichier : cette garde ne peut pas trancher`);
      else if (c.classe === "instable") nonConcluants.push(`${f} : rouge seul en ordre normal mais vert seul mélangé (graine ${graine}) — résultat instable`);
      else nonConcluants.push(c.raison);
    }
    if (pieces.length) avertissementsRouges.push(`pièces conservées :\n  ${pieces.join("\n  ")}`);
    // Un non-concluant ne classe pas — mais une violation confirmée à côté prime toujours (voir `verdict`).
    if (nonConcluants.length && !dependants.length) return inconclusif([...nonConcluants, ...avertissementsRouges]);

    const { constats, avertissements, raisonsNonConcluance } = confronter(dependants, dejaRouges);
    raisonsNonConcluance.push(...nonConcluants);
    avertissements.push(...avertissementsRouges);
    const entete = `graine(s) ${graines.join(", ")} — rejouable par \`node tools/ordre-des-bancs.mjs --graine=${graines.join(",")}\``
      + (dependants.length ? ` ; rouges sous : ${dependants.map((f) => `${f} (${rougesParGraine.get(f).join(", ")})`).join(" ; ")}` : "");
    return verdict({ constats, avertissements, raisonsNonConcluance, entete, vus });
  }));
}
