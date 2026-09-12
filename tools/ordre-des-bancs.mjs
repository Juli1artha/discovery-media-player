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

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

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

/** Les fichiers cités par une ligne `FAIL  <chemin> > …` de vitest. */
export function fichiersEnEchec(sortie) {
  const vus = new Set();
  for (const m of String(sortie).matchAll(/^\s*FAIL\s+(\S+?\.test\.[jt]s)/gm)) vus.add(m[1]);
  return [...vus];
}

/** Le compte de fichiers de bancs annoncé par vitest — l'objet de la sonde, pour refuser le vide. */
export function fichiersVus(sortie) {
  const m = /Test Files\s+.*?(\d+)\s*\)/.exec(String(sortie));
  return m ? Number(m[1]) : null;
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
      "lancée DEPUIS une exécution de bancs (VITEST est posé) : cette garde lance la suite, donc elle l'imbriquerait dans elle-même. Lancez-la depuis un terminal ou une étape de forge dédiée.",
    ]);

    const arg = process.argv.find((a) => a.startsWith("--graine="));
    const graine = arg ? Number(arg.slice("--graine=".length)) : grainePourJour();
    if (!Number.isFinite(graine)) return inconclusif([`graine illisible : ${arg}`]);

    const vitest = (args) => {
      const r = spawnSync("npx", ["vitest", "run", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { r, sortie: `${r.stdout || ""}\n${r.stderr || ""}` };
    };

    const { r, sortie } = vitest(["--sequence.shuffle.tests", `--sequence.seed=${graine}`]);
    if (r.error) return inconclusif([`vitest n'a pas pu être lancé : ${r.error.message}`]);

    // ⚠️ AUCUN FICHIER LU N'EST PAS UN SUCCÈS. Si vitest change de format de sortie ou ne trouve
    // aucun banc, cette sonde ne voit aucun échec — et conclurait VERTE sur rien.
    const vus = fichiersVus(sortie);
    if (!vus) return inconclusif([
      `aucun compte de fichiers de bancs dans la sortie de vitest (code ${r.status}) — la sonde n'a rien lu, donc rien n'est prouvé`,
    ]);

    // Contrôle de stimulus : chaque rouge est rejoué SEUL et SANS mélange.
    const dependants = [], dejaRouges = [];
    for (const f of fichiersEnEchec(sortie)) {
      const seul = vitest([f]);
      if (seul.r.error) return inconclusif([`rejeu de ${f} impossible : ${seul.r.error.message}`]);
      (seul.r.status === 0 ? dependants : dejaRouges).push(f);
    }

    const { constats, avertissements, raisonsNonConcluance } = confronter(dependants, dejaRouges);
    const entete = `graine ${graine} — rejouable par \`node tools/ordre-des-bancs.mjs --graine=${graine}\``;
    if (raisonsNonConcluance.length) return inconclusif([entete, ...raisonsNonConcluance], avertissements);
    if (constats.length) return violation([entete, ...constats], avertissements);
    return conforme(`${vus} fichiers de bancs passent leurs essais MÉLANGÉS (${entete})`, avertissements);
  }));
}
