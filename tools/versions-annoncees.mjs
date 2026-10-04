// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// AUCUN DOCUMENT N'ANNONCE UNE VERSION QUI N'EXISTE PAS.
//
// ⚠️ CE QUI EST ARRIVÉ, ET QUI A COÛTÉ UNE JOURNÉE À UN HÔTE. Le 01/09, quatre documents lus par
// les intégrateurs portaient TREIZE affirmations au PASSÉ sur deux versions jamais publiées :
// « `0.1.146` stopped serving it », « `0.1.147` stops writing it ». Le registre servait 0.1.145,
// qui sert et écrit toujours. Un hôte a lu `docs/RETENTION.md`, a cru l'arrêt livré, et a reçu de
// sa direction juridique l'ordre d'appliquer des migrations qui n'étaient dans aucun paquet.
//
// C'est lui qui l'a mesuré, pas nous — en dépaquetant la version servie parce qu'une demande le
// gênait. Sans cette gêne, l'écart vivait encore.
//
// ⚠️ ET CE N'EST PAS UNE FAUTE D'INATTENTION, C'EST UNE FORME. Un numéro de version écrit à la main
// dans une phrase est une AFFIRMATION SUR UN FAIT EXTÉRIEUR — l'état du registre — posée dans un
// fichier que rien ne relie à ce fait. Elle est vraie à l'écriture, et un événement du dehors, ou
// plutôt son ABSENCE (la publication qui ne vient pas), la rend fausse sans que le fichier bouge.
// Le dépôt connaît déjà cette forme : `exemples-epingles` a la même, et sa réponse est la même —
// on DÉRIVE le nombre au lieu de l'écrire.
//
// ⚠️ POURQUOI `package.json` PLUTÔT QUE LE REGISTRE. Deux raisons, et la seconde est la vraie.
// D'abord une garde qui interroge le réseau devient non concluante quand le réseau tousse, et
// celle-ci doit tourner sur chaque PR. Ensuite et surtout : `docs/RELEASING.md` impose que le tag,
// `package.json` et la section de tête du CHANGELOG portent le MÊME numéro — c'est le contrôle qui
// a refusé la 0.1.141. Donc, entre deux sorties, `package.json` EST la dernière version publiée ;
// et pendant la PR de sortie, il est monté dans le même commit que la section qui la décrit, si
// bien que les phrases parlant de la nouvelle version deviennent légales exactement quand elle
// devient réelle. La fenêtre de sortie se referme d'elle-même, sans exception à écrire.
//
// LA RÈGLE : un document peut nommer une version PASSÉE ou COURANTE, jamais une version À VENIR.
// Ce qui n'est pas encore sorti se dit « the next release », ou se nomme par ce qui existe
// vraiment — un numéro de migration, une section `[Unreleased]`.
//
// ⚠️ CE QU'ELLE NE PRÉTEND PAS COUVRIR. Elle ne vérifie pas qu'une version citée au passé a
// vraiment fait ce qu'on lui prête ; elle vérifie qu'elle EXISTE. C'est la moitié mécanisable, et
// c'est celle qui a manqué.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Les documents qu'un intégrateur lit — ceux où une version annoncée engage quelqu'un. */
export const SUIVIS = ["docs", "README.md", "CHANGELOG.md", "AGENTS.md", "CONTRIBUTING.md"];

/** `0.1.145` → 145. Une seule série mineure ici ; le comparateur reste lexicographique par champ. */
export const rang = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10));

/** a > b, champ par champ. */
export function plusGrand(a, b) {
  const x = rang(a), y = rang(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const p = x[i] || 0, q = y[i] || 0;
    if (p !== q) return p > q;
  }
  return false;
}

/**
 * Les versions nommées dans un texte, avec leur ligne.
 *
 * ⚠️ ON NE LIT QUE LES VERSIONS DE CE PAQUET. Les documents citent aussi des versions de Node, de
 * PostgreSQL et d'actions tierces — les confondre ferait une garde qui accuse au hasard. La forme
 * retenue est celle du produit : `0.1.<n>`, éventuellement précédée d'un `v`.
 */
export function versionsCitees(texte) {
  const trouvees = [];
  texte.split("\n").forEach((ligne, i) => {
    for (const m of ligne.matchAll(/\bv?(0\.1\.\d+)\b/g)) trouvees.push({ version: m[1], ligne: i + 1 });
  });
  return trouvees;
}

/**
 * Les fichiers suivis, via git — le périmètre se demande au dépôt, jamais à une liste écrite.
 *
 * ⚠️ ET IL EST RENDU PAR RACINE, PAS À PLAT, PARCE QUE CETTE GARDE S'EST DÉJÀ TROMPÉE DE PÉRIMÈTRE
 * À SA PREMIÈRE EXÉCUTION. Un pathspec à double étoile suivi de `.md` ne correspond à AUCUN
 * fichier sous `docs` — git ne
 * développe pas `**` comme un shell — donc elle ne lisait que le CHANGELOG et n'avait aucun moyen
 * de le dire : les citations n'étaient pas nulles, le plancher passait, et les seize documents de
 * `docs/` — ceux que lisent les intégrateurs, ceux où l'erreur vivait — n'étaient pas regardés.
 * Une garde écrite pour un défaut de périmètre l'a reproduit dans sa propre première ligne.
 *
 * Le filtre `.md` se fait donc EN JAVASCRIPT, sur ce que git rend, et l'appelant reçoit la
 * répartition par racine pour pouvoir exiger que chacune ait un sujet.
 */
export function documentsParRacine(racines = SUIVIS) {
  const par = new Map();
  for (const r of racines) {
    const sortie = execFileSync("git", ["ls-files", "--", r], { encoding: "utf8" }).trim();
    par.set(r, sortie ? sortie.split("\n").filter((f) => f.endsWith(".md")) : []);
  }
  return par;
}

/** À plat, pour les appelants qui n'ont pas besoin de la répartition. */
export const documents = (racines = SUIVIS) => [...documentsParRacine(racines).values()].flat();

/** La version que le dépôt déclare — celle du tag à venir, donc la dernière qui existe. */
export const versionDeclaree = (lire = readFileSync) => JSON.parse(lire("package.json", "utf8")).version;

export function annoncesEnAvance(fichiers, courante, lire = readFileSync) {
  const soucis = [];
  let citations = 0;
  for (const f of fichiers) {
    for (const { version, ligne } of versionsCitees(lire(f, "utf8"))) {
      citations += 1;
      if (plusGrand(version, courante)) {
        soucis.push(`${f}:${ligne} — annonce « ${version} », qui n'existe pas : package.json déclare ${courante}. `
          + "Une version à venir se dit « the next release », ou se nomme par ce qui existe (un numéro de migration).");
      }
    }
  }
  return { soucis, citations };
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const parRacine = documentsParRacine();
    // ⚠️ CHAQUE RACINE DÉCLARÉE DOIT AVOIR UN SUJET. C'est ce contrôle-là qui aurait dit, à la
    // première exécution, que `docs/` ne rendait rien — et un total non nul ne le dit pas.
    const vides = [...parRacine].filter(([, f]) => !f.length).map(([r]) => r);
    if (vides.length) {
      return inconclusif(`aucun document sous ${vides.join(", ")} — le périmètre déclare une racine `
        + "qu'il ne lit pas ; c'est la garde qui est cassée, pas la branche");
    }
    const fichiers = [...parRacine.values()].flat();
    const courante = versionDeclaree();
    if (!/^\d+\.\d+\.\d+$/.test(String(courante))) {
      return inconclusif(`package.json déclare « ${courante} », qui n'est pas une version comparable`);
    }
    const { soucis, citations } = annoncesEnAvance(fichiers, courante);
    // ⚠️ LE TÉMOIN DE LA RÈGLE, PAS CELUI DU PÉRIMÈTRE. Zéro version citée sur trente documents ne
    // veut pas dire qu'aucune n'est annoncée en avance : ça veut dire que la sonde ne reconnaît
    // plus la forme d'un numéro. Le plancher est à UN parce que ce dépôt date ses changements.
    if (!citations) {
      return inconclusif(`aucune version « 0.1.x » reconnue dans ${fichiers.length} document(s) — `
        + "ce n'est pas une absence d'annonce, c'est une sonde qui ne lit plus la forme");
    }
    if (soucis.length) return violation(soucis);
    return conforme(`versions annoncées : ${citations} citation(s) dans ${fichiers.length} document(s), `
      + `aucune au-delà de ${courante}`);
  }));
}
