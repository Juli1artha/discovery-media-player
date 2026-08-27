// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN SCAN QUI NE S'EST PAS TERMINÉ N'EST PAS UNE ALERTE NON TRIÉE.
//
// ⚠️ CE QUI EST ARRIVÉ (27/08, course 33102994676 sur `main`). L'étape ZAP est sortie rouge en
// annonçant « alerte non triée sur : http://localhost:3000/doc/zap-doc — le tri vit dans
// .zap/rules.tsv, le détail dans l'artefact rapports-zap ». Les deux adresses étaient fausses. Le
// journal de cette surface tient en trois lignes :
//
//     18:22:32  ── scan : http://localhost:3000/doc/zap-doc
//     18:23:02  Failed to access summary file /home/zap/zap_out.json
//     18:23:03  ── scan : http://localhost:3000/present/zap-direct
//
// Aucune ligne `PASS:`, aucune ligne de synthèse `FAIL-NEW: … PASS: …` — là où les deux autres
// surfaces en impriment soixante-trois et une. `zap-baseline.py` s'est interrompu AVANT de rendre
// le moindre verdict : il n'y avait pas d'alerte non triée, il n'y avait pas eu de tri. Deux
// étapes plus bas, un témoin indépendant le confirme sans qu'on ait à lire ZAP — « With the
// provided path, there will be 2 files uploaded », DEUX rapports pour TROIS surfaces.
//
// ⚠️ LA CAUSE TENAIT EN DEUX CARACTÈRES : `|| echec="$echec $cible"`. Un `||` écrase tous les codes
// non nuls en un seul fait, puis la ligne suivante nomme celui qu'elle a choisi. Le lecteur qui
// suit la consigne ouvre `.zap/rules.tsv`, où il n'y a rien à trier, puis cherche dans l'artefact
// un rapport qui n'y a jamais été écrit. C'est la classe de défaut que ce dépôt retire partout
// ailleurs depuis le 21/08 — deux rouges différents sous un seul code — et l'étape ZAP était le
// dernier endroit où elle vivait encore, dans du shell plutôt que dans du JavaScript.
//
// ⚠️ ET LE VERT ÉTAIT AUSSI VULNÉRABLE QUE LE ROUGE. Rien ne vérifiait qu'un scan sorti en 0 avait
// écrit son rapport : un scanner qui aurait rendu 0 sans rien produire passait. L'en-tête de
// `zap.yml` écrit pourtant, deux étapes plus haut, « un scan d'un 404 est vert et vide — le pire
// cas, celui que toutes les gardes d'ici refusent ». La garde qui suivait ne tenait pas cette
// promesse pour elle-même.
//
// ⚠️ LE RAPPORT EST LE TÉMOIN, PAS LE CODE DE SORTIE. On ne bâtit RIEN sur la table des codes de
// `zap-baseline.py` : elle n'est pas mesurable ici (l'image du scanner ne tourne qu'en CI), et une
// table qu'on recopie de mémoire est exactement ce que ce dépôt refuse d'écrire. On demande donc à
// chaque scan la preuve qu'il est allé au bout — le rapport HTML qu'il s'est engagé à écrire — et
// c'est le croisement de cette preuve avec le code qui donne le verdict :
//
//     code   rapport    verdict
//     ────   ────────   ──────────────────────────────────────────────────────────────────────
//      0     présent    conforme — le scan a conclu, et il n'a rien à signaler
//      0     ABSENT     NON CONCLUANT — vert sans preuve : personne n'a regardé cette surface
//     ≠0     présent    VIOLATION — le scan a conclu : son verdict est une alerte non triée
//     ≠0     ABSENT     NON CONCLUANT — le scan ne s'est pas terminé ; rien n'a été trié
//
// ⚠️ UNE VIOLATION L'EMPORTE SUR UNE CÉCITÉ, ET CE N'EST PAS UN ADOUCISSEMENT. Si une surface porte
// une vraie alerte non triée pendant qu'une autre est restée aveugle, sortir 2 dirait à l'auteur
// « le correctif n'est pas dans ta branche » — ce qui serait faux. On sort donc 1, et la surface
// aveugle voyage en AVERTISSEMENT plutôt que de disparaître : les deux faits sont dans le journal,
// et c'est le plus actionnable des deux qui donne le code.
//
// Usage : node tools/verdict-zap.mjs <dossier-des-rapports> [nom=cible=code ...]

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Le nom du rapport qu'une surface s'engage à écrire. C'est LA preuve qu'elle est allée au bout. */
export const nomDuRapport = (nom) => `rapport-${nom}.html`;

/**
 * Lit un argument `nom=cible=code`.
 *
 * ⚠️ LE NOM S'ARRÊTE AU PREMIER `=`, LE CODE COMMENCE APRÈS LE DERNIER : une cible est une URL, et
 * une URL peut porter un `=` dans sa requête. Découper naïvement sur le premier séparateur
 * rendrait une cible tronquée — donc un message qui nomme une adresse qui n'a jamais été scannée.
 */
export function lireAnnonce(texte) {
  const premier = texte.indexOf("=");
  const dernier = texte.lastIndexOf("=");
  if (premier < 1 || dernier === premier) return null;
  const nom = texte.slice(0, premier);
  const cible = texte.slice(premier + 1, dernier);
  const brut = texte.slice(dernier + 1);
  if (!cible || !/^-?\d+$/.test(brut)) return null;
  return { nom, cible, code: Number(brut) };
}

/**
 * Le verdict d'UNE surface, à partir de son code et de la présence de son rapport.
 *
 * `code` est celui rendu par le scanner, `rapportEcrit` la preuve qu'il a conclu.
 */
export function verdictDeLaSurface({ nom, cible, code }, rapportEcrit) {
  if (code === 0 && rapportEcrit) return { etat: "conforme", nom, cible };
  if (code === 0) {
    return {
      etat: "aveugle",
      nom,
      cible,
      dit: `${cible} : le scan sort en 0 mais n'a écrit AUCUN ${nomDuRapport(nom)} — un vert sans preuve ne dit rien de cette surface`,
    };
  }
  if (rapportEcrit) {
    return {
      etat: "violation",
      nom,
      cible,
      dit: `alerte non triée sur ${cible} (le scan a conclu, code ${code}) — le tri est une décision écrite par règle dans .zap/rules.tsv, et le détail est dans ${nomDuRapport(nom)} de l'artefact rapports-zap`,
    };
  }
  return {
    etat: "aveugle",
    nom,
    cible,
    dit: `${cible} : le scan NE S'EST PAS TERMINÉ (code ${code}, aucun ${nomDuRapport(nom)} écrit) — aucune alerte n'a été triée, ne cherchez pas dans .zap/rules.tsv ; le correctif est dans le scanner ou son environnement, pas dans la branche`,
  };
}

/**
 * Le verdict de la passe entière.
 *
 * `rapportEcrit` est injectable : le banc éprouve la règle sans écrire de fichiers.
 */
export function analyser(annonces, rapportEcrit, rapportsSurLeDisque = []) {
  // ⚠️ LE PLANCHER. Une passe sans aucune surface annoncée est le cas où cet outil ne peut RIEN
  // dire — et où, sans ce refus, il dirait « tout va bien ». C'est la vacuité que `zap.yml` refuse
  // deux étapes plus haut pour les surfaces elles-mêmes ; elle vaut aussi pour leur juge.
  if (!annonces.length) {
    return inconclusif("aucune surface annoncée : la sonde vise à côté — rien n'a été scanné, ou l'appelant n'a rien transmis");
  }

  const verdicts = annonces.map((a) => verdictDeLaSurface(a, rapportEcrit(a.nom)));
  const violations = verdicts.filter((v) => v.etat === "violation");
  const aveugles = verdicts.filter((v) => v.etat === "aveugle");

  // ⚠️ UN TÉMOIN INDÉPENDANT DE L'APPELANT. Un rapport présent sur le disque pour une surface dont
  // personne n'a parlé veut dire que la liste transmise et ce qui a réellement tourné divergent —
  // une boucle qui a perdu une surface en chemin. On ne peut pas en faire un échec (le disque ne
  // sait rien des surfaces qui n'ont rien écrit), mais on ne l'avale pas non plus.
  const annonces_ = new Set(annonces.map((a) => nomDuRapport(a.nom)));
  const orphelins = rapportsSurLeDisque.filter((f) => !annonces_.has(f));

  const avertissements = orphelins.map(
    (f) => `${f} existe sur le disque mais sa surface n'a pas été annoncée — la liste de l'appelant et ce qui a tourné divergent`,
  );

  if (violations.length) {
    return violation(
      violations.map((v) => v.dit),
      // Les surfaces aveugles ne disparaissent pas derrière la violation : elles voyagent avec elle.
      [...aveugles.map((v) => v.dit), ...avertissements],
    );
  }
  if (aveugles.length) return inconclusif(aveugles.map((v) => v.dit), avertissements);

  return conforme(
    `${verdicts.length} surface(s) scannées jusqu'au bout, rapport écrit pour chacune, aucune alerte non triée`,
    avertissements,
  );
}

/** Les rapports réellement présents dans le dossier de travail du scanner. */
export function rapportsPresents(dossier) {
  try {
    return readdirSync(dossier).filter((f) => /^rapport-.+\.html$/.test(f));
  } catch {
    return [];
  }
}

export function principal(argv, dossierParDefaut = "/tmp/zap-wrk") {
  const [dossier = dossierParDefaut, ...bruts] = argv;
  const annonces = [];
  for (const brut of bruts) {
    const lue = lireAnnonce(brut);
    // ⚠️ ON REFUSE PLUTÔT QUE DE DEVINER. Une annonce illisible est une passe dont on ignore le
    // résultat ; l'ignorer en silence rendrait un vert sur une surface jamais jugée.
    if (!lue) {
      return inconclusif(`annonce illisible « ${brut} » — attendu « nom=cible=code », rien n'a pu être jugé`);
    }
    annonces.push(lue);
  }
  return analyser(annonces, (nom) => existsSync(join(dossier, nomDuRapport(nom))), rapportsPresents(dossier));
}

if (estExecuteDirectement(import.meta.url)) conclure(principal(process.argv.slice(2)));
