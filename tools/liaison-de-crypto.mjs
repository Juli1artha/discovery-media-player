// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// `crypto` EST UN GLOBAL DEPUIS NODE 18 — ET CE N'EST PAS LE MÊME `crypto`.
//
// ⚠️ CE QUI EST ARRIVÉ (0.1.135 → 0.1.137, signalé par un hôte qui l'exécutait). L'extraction du
// lot 3 a déplacé la route `bot-tts` hors de `handler.js` SANS emporter `require("node:crypto")`.
// Le code restait syntaxiquement parfait : `crypto.createHash(…)` désigne alors `globalThis.crypto`,
// c'est-à-dire WebCrypto, qui n'a pas `createHash`. `TypeError` à l'exécution.
//
// ⚠️ AUCUN LINTER NE POUVAIT LE VOIR, et c'est le cœur du sujet. `no-undef` cherche une variable
// non définie ; celle-ci EXISTE. Elle désigne simplement autre chose. Un nom qui vaut deux objets
// selon l'endroit, et une analyse qui opère là où la distinction n'existe pas — même forme que
// l'apostrophe qui ferme une chaîne dans `node -e '…'` (0.1.136) : ce qui reste est plausible et
// ne fait pas ce qu'on croit.
//
// ⚠️ ET LA PANNE ÉTAIT TOTALE, PAS MARGINALE. `keyFor()` construit la clé du cache, donc il est
// appelé AVANT de lire le cache : le jet précède toujours la consultation. Un « cache hit » ne
// protège de rien, il n'est jamais atteint. La route rendait 500 à CHAQUE appel, pendant deux
// versions, sur toute instance dont `plugins.bot` est posé.
//
// ⚠️ LA LISTE DES MÉTHODES SE DÉRIVE, ELLE NE SE TAPE PAS. Ce qui distingue le module du global est
// une question à laquelle Node répond lui-même : on prend les fonctions du module et on retire
// celles que le global expose aussi. Sur node 22 il en reste 63 ; seules `getRandomValues` et
// `randomUUID` vivent des deux côtés. Une liste écrite à la main aurait vieilli en silence.
//
// ⚠️ CE QUE CETTE GARDE NE PEUT PAS SAVOIR : elle interroge le Node QUI L'EXÉCUTE. Si une future
// version promeut une méthode sur le global, la garde se détend d'elle-même — c'est correct. Si un
// hôte tourne une version où le partage est MOINDRE, elle est trop permissive pour lui. Vu le
// partage actuel (2 noms sur 65), l'écart est théorique ; il est écrit parce qu'il existe.
//
// Usage : node tools/liaison-de-crypto.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

import { transformSync } from "esbuild";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Les dossiers dont le code s'exécute sous Node, chez l'hôte. */
const SOUS_NODE = /^(server|context|bin)\/.*\.(js|cjs|mjs)$/;

/** Tous les noms atteignables sur un objet, prototypes compris. */
const nomsDe = (o) => {
  const noms = new Set();
  for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) noms.add(k);
  }
  return noms;
};

/**
 * Les méthodes qui n'existent QUE sur le module — donc celles dont l'appel sur le global échoue.
 * Dérivé du Node courant, jamais écrit à la main.
 */
export function methodesDuModuleSeul(module = crypto, global = globalThis.crypto) {
  const surLeGlobal = global ? nomsDe(global) : new Set();
  return [...nomsDe(module)]
    .filter((k) => typeof module[k] === "function" && !surLeGlobal.has(k))
    .sort();
}

/**
 * Le texte débarrassé de ses COMMENTAIRES — par un vrai analyseur, pas par une expression régulière.
 *
 * ⚠️ TROIS ÉCRITURES À LA REGEX, TROIS AVEUGLEMENTS, DANS LA MÊME HEURE.
 *   1. Elle retirait les chaînes avant de chercher `require("crypto")` — donc elle détruisait la
 *      preuve qu'elle cherchait, et accusait cinq fichiers corrects.
 *   2. Son motif de commentaire de ligne ouvrait par une classe d'espaces répétée, et « espace »
 *      contient le retour à la ligne : une suite de lignes commentées se repliait en une seule,
 *      emportant le code d'après.
 *   3. Et la dernière, la plus instructive : l'en-tête de `routes-agent.js` cite un motif de
 *      fichiers — le dossier « server », une barre oblique, une étoile, « .js ». La barre suivie de
 *      l'étoile ouvre un bloc pour qui lit sans grammaire, ALORS QU'ELLE VIT DANS UN COMMENTAIRE DE
 *      LIGNE. La regex refermait ce bloc vingt-quatre lignes plus loin, en avalant précisément le
 *      « require node:crypto » dont l'absence est le défaut surveillé : la garde accusait le
 *      fichier corrigé. Et ce commentaire-ci a dû être réécrit pour la même raison — sa première
 *      version citait le motif littéralement, et l'étoile-barre a fermé le bloc que vous lisez.
 *
 * Écrire une quatrième aurait été la quatrième fois. Ce dépôt a déjà payé ce prix pour les `uses:`
 * et pour les `FROM` : « on ne lit pas un format structuré avec une expression régulière ».
 * `esbuild` est déjà là, il porte un lexer JavaScript, et il rend le code sans ses commentaires.
 *
 * ⚠️ IL LÈVE sur un fichier qu'il ne sait pas analyser, et c'est voulu : un fichier illisible ne
 * dit RIEN de la règle surveillée — `tenter` en fait un résultat non concluant, jamais une violation.
 */
export function sansCommentaires(source) {
  return transformSync(source, { loader: "js" }).code;
}

/**
 * Le même texte, débarrassé en plus de ses CHAÎNES.
 *
 * ⚠️ DEUX DÉPOUILLAGES, PARCE QUE DEUX QUESTIONS. La première version n'en avait qu'un, et elle a
 * accusé cinq fichiers parfaitement corrects : en retirant les chaînes elle détruisait
 * `require("crypto")`, c'est-à-dire la preuve même qu'elle cherchait. Le plancher de cette garde
 * l'a rendue rouge sur son propre dépôt à la première exécution.
 *
 * Ce qui reste vrai : les gabarits (`gabarit-*.js`) portent du code NAVIGATEUR dans des littéraux,
 * et là `crypto` DOIT être le global — on ne cherche donc les APPELS que hors des chaînes.
 */
export function sansChaines(code) {
  return code
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, " ")
    .replace(/"(?:[^"\\\n]|\\[\s\S])*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\[\s\S])*'/g, "''");
}

/** Le fichier lie-t-il `crypto` lui-même ? */
export const lieCrypto = (code) => /require\(\s*['"](?:node:)?crypto['"]\s*\)|from\s+['"](?:node:)?crypto['"]/.test(code);

/**
 * Les appels `crypto.<méthode>` d'un fichier qui ne peuvent viser que le module.
 *
 * ⚠️ ON EXIGE UN IDENTIFIANT NU. `require("crypto").createHash(…)` lie au point d'usage et va très
 * bien ; ce qui est fautif, c'est `crypto.` dont le `crypto` ne vient de nulle part.
 */
export function appelsDuModule(code, methodes) {
  const vus = new Set();
  for (const m of methodes) {
    if (new RegExp(`(^|[^.\\w$'"\`])crypto\\s*\\.\\s*${m}\\s*\\(`).test(code)) vus.add(m);
  }
  return [...vus].sort();
}

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — combien de fichiers portent la forme que la sonde doit RECONNAÎTRE.
 *
 * Cette garde affirme une ABSENCE (« aucun n'appelle sur le global ») sur trente et un fichiers. Sa
 * panne la plus probable — une expression qui ne reconnaît plus la forme d'un appel — produit elle
 * aussi une absence : trente et un fichiers verts sans rien avoir mesuré. Le plancher existant
 * compte les FICHIERS LUS, pas la FORME RECONNUE.
 *
 * Mesuré le 31/08 en aveuglant `manquements` : l'outil imprimait son résumé complet et sortait 0.
 * Ses bancs rougissaient — la règle était protégée, le VERDICT IMPRIMÉ ne l'était pas.
 *
 * ⚠️ ET IL EST DISTINCT DU TÉMOIN QUI EXISTAIT DÉJÀ. `methodesDuModuleSeul()` refuse quand plus
 * aucune méthode ne sépare le module du global : il prouve que LA QUESTION a encore un sens sur ce
 * Node. Celui-ci prouve que LA SONDE sait encore lire la réponse. Deux cécités différentes, deux
 * refus différents — les confondre laisserait la seconde ouverte.
 */
export function temoinsDeForme(fichiers, lire, methodes) {
  return fichiers.filter((f) => appelsDuModule(sansChaines(sansCommentaires(lire(f))), methodes).length).length;
}

/** Les fichiers qui appellent une méthode du module sans jamais l'avoir lié. */
export function manquements(fichiers, lire, methodes) {
  const soucis = [];
  for (const f of fichiers) {
    // La LIAISON se lit dans le code avec ses chaînes — `require("crypto")` EST une chaîne.
    // Les APPELS se cherchent sans elles, sinon le code navigateur des gabarits accuse à tort.
    const code = sansCommentaires(lire(f));
    const appels = appelsDuModule(sansChaines(code), methodes);
    if (appels.length && !lieCrypto(code)) {
      soucis.push(`${f} appelle crypto.${appels.join(", crypto.")} sans lier le module — sous Node, « crypto » nu est WebCrypto, qui n'a pas ${appels[0]} : TypeError à l'exécution, jamais au lint`);
    }
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const suivis = execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => SOUS_NODE.test(f) && !f.includes("__tests__"));
    if (!suivis.length) {
      return inconclusif("aucun fichier de server/, context/ ou bin/ relevé par git ls-files — la sonde vise à côté, ou le dépôt n'est pas là");
    }
    const methodes = methodesDuModuleSeul();
    if (!methodes.length) {
      return inconclusif("aucune méthode ne distingue le module du global sur ce Node — la question posée n'a plus de sens ici, et un vert ne prouverait rien");
    }
    const lire = (f) => readFileSync(f, "utf8");
    // ⚠️ Un plancher à UN : « au moins un fichier de ce dépôt appelle le module crypto » est vrai de
    // tout état sain, alors que le compte du jour serait collé au relevé du jour.
    const temoins = temoinsDeForme(suivis, lire, methodes);
    if (!temoins) {
      return inconclusif(`aucun appel « crypto.<méthode>( » reconnu dans ${suivis.length} fichier(s) — ce n'est pas une absence d'appel sur le global, c'est une sonde qui ne lit plus la forme`);
    }
    const soucis = manquements(suivis, lire, methodes);
    if (soucis.length) return violation(soucis);
    return conforme(`liaison de crypto : ${temoins} fichier(s) appellent le module parmi ${suivis.length} sous Node, aucun ne le fait sur le global (${methodes.length} méthodes distinguent les deux)`);
  }));
}
