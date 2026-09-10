// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE SECTION SANS TAG PUBLIE UN LIEN QUI NE RÉSOUT PAS ; UN TAG SANS SECTION PUBLIE UNE VERSION
// QUE PERSONNE NE PEUT LIRE.
//
// ⚠️ CETTE GARDE NAÎT SUR DEUX DÉFAUTS RÉELS, DONT UN A SOIXANTE-SEIZE VERSIONS. Le 09/09, deux
// trains ont été fusionnés avant que le premier ne soit tagué : `0.1.159` a une section, un commit
// sur `main`, et aucun tag. Le bloc de références du CHANGELOG est RÉGÉNÉRÉ mécaniquement depuis
// l'ordre des sections (`changelog.mjs`, `urlAttendue`), donc il produit obligatoirement
// `compare/v0.1.158...v0.1.159` — un lien vers un tag qui n'existera jamais. **Le lien mort n'est
// pas une négligence : il est EXIGÉ par une garde qui suppose que toute section a un tag.**
//
// ⚠️ ET LA MESURE EN A SORTI UN AUTRE, QUE PERSONNE N'AVAIT VU. En confrontant les 158 sections aux
// tags, trois tags n'ont pas de section : `v0.1.141` et `v0.1.146` sont des TAGS MORTS documentés
// dans `docs/RELEASING.md` (posés à tort, jamais publiés, la reprise consiste à couper le numéro
// suivant) — mais `v0.1.84` est **PUBLIÉE au registre** et n'a aucune section. Quelqu'un qui
// installe `0.1.84` ou ouvre sa Release ne trouve nulle part ce qu'elle a changé.
//
// ⚠️ ET L'EN-TÊTE DE `changelog.mjs` DÉCRIT CE MONDE-LÀ DE TRAVERS : il justifie son calcul par
// « l'historique a au moins une discontinuité (la 0.1.85 suit la 0.1.83) ». C'est faux — la 0.1.84
// existe et le registre la sert. La discontinuité est dans le CHANGELOG, pas dans l'historique. Son
// calcul reste juste (il dérive de l'ordre RÉEL des sections, jamais de « patch − 1 »), mais sa
// raison écrite l'est pour une cause qui n'est pas la vraie.
//
// ⚠️ POURQUOI UN AVERTISSEMENT ET NON UNE VIOLATION POUR `0.1.84`. Les notes n'ont jamais été
// écrites ; les reconstituer aujourd'hui depuis les commits produirait un récit rédigé deux mois
// après, présenté comme contemporain. Une garde rouge en permanence est une garde qu'on apprend à
// contourner. Elle est donc NOMMÉE À CHAQUE EXÉCUTION, sans bloquer — c'est une dette datée, pas
// une exemption : la distinction est que personne ne prétend qu'elle est en ordre.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ⚠️ CHAQUE ÉCART TOLÉRÉ PORTE SA RAISON *ET* SA VÉRIFICATION. Une exemption qu'on ne peut que
 * croire est une liste blanche : elle survit à la disparition de son motif. Ici `estMort` interroge
 * le registre — le jour où l'une de ces versions serait publiée, l'exemption tombe d'elle-même.
 */
export const TAGS_MORTS = {
  // ⚠️ CHAQUE RAISON PORTE SON PROPRE FAIT, JAMAIS « comme celle du dessus ». Une raison qui
  // renvoie à une autre meurt quand l'autre est retirée — et la première rédaction de l'entrée
  // 0.1.146 disait exactement cela, écrite par analogie sans que le tag ait été ouvert. Le banc sur
  // la longueur des raisons l'a attrapée, et la vérification a rendu le fait : les deux tags
  // portent le MÊME défaut mesurable, chacun avec son chiffre.
  "v0.1.141": "tag posé le 27/08 sur le `main` récupéré AVANT la fusion du commit de sortie : il pointe un commit dont package.json déclare 0.1.140. `verifier` a donc refusé, rien n'a été publié, et la reprise documentée dans docs/RELEASING.md est de couper le numéro suivant plutôt que de déplacer un tag qu'un ruleset interdit de supprimer",
  "v0.1.161": "tag poussé le 09/09 sur un commit correct, mais `publier` a échoué AVANT toute publication : son checkout ne rapportait pas les tags, donc `prepublishOnly` (« npm run build && npm test ») faisait tomber les bancs de cette garde même. Registre jamais servi ; reprise conforme à docs/RELEASING.md, le numéro suivant a été coupé",
  "v0.1.146": "même défaut mesuré séparément : le tag pointe un commit dont package.json déclare 0.1.145, donc jamais publié non plus. Il est posé — et c'est le détail qui mérite d'être gardé — sur le commit « Aucun document n'annonce une version qui n'existe pas » (#480)",
};

/**
 * ⚠️ DETTES DATÉES, PAS EXEMPTIONS — ET LA DISTINCTION EST TOUT. Une exemption dit « ceci est en
 * ordre » ; une dette dit « ceci ne l'est pas, voici pourquoi personne ne le répare ». Les deux
 * laissent passer, une seule le dit. Elles sont imprimées en AVERTISSEMENT à chaque exécution :
 * une garde rouge en permanence est une garde qu'on apprend à contourner, et une garde qui se tait
 * est une garde qui a menti.
 */
export const SANS_NOTES = {
  "v0.1.84": "publiée au registre et taguée, sans section de changelog — les notes n'ont jamais été écrites, et les reconstituer depuis les commits deux mois après produirait un récit daté à tort",
};

/**
 * Sections dont le tag n'existe pas et n'existera pas. ⚠️ LA REMÉDIATION EXISTE MAIS N'EST PAS
 * TECHNIQUE : taguer une version que `main` a dépassée est refusé par le préflight, et effacer une
 * section réécrit le registre public du projet. C'est une décision de mainteneur, pas de garde.
 */
export const SANS_TAG = {
  "0.1.159": "numéro sauté le 09/09 — deux trains fusionnés avant que le premier ne soit tagué. Son contenu a été publié DANS 0.1.160. Le tag ne peut plus être posé (le préflight exige HEAD == origin/main) et effacer la section masquerait que le numéro a existé ; son lien de comparaison ne résoudra donc jamais",
};

export function sectionsDuChangelog(txt) {
  return [...txt.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
}

export function tagsDeVersion(sortie) {
  return sortie.split("\n").map((s) => s.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
}

/** Ce que la confrontation rend, avant toute tolérance. */
export function confronter(sections, tags) {
  const jeuTags = new Set(tags);
  const jeuSections = new Set(sections);
  return {
    sectionsSansTag: sections.filter((v) => !jeuTags.has(`v${v}`)),
    tagsSansSection: tags.filter((t) => !jeuSections.has(t.slice(1))),
  };
}

export function auditer(racine = RACINE, {
  lireTags = () => execFileSync("git", ["tag", "-l"], { cwd: racine, encoding: "utf8" }),
  estPubliee = null,
} = {}) {
  const txt = readFileSync(join(racine, "CHANGELOG.md"), "utf8");
  const sections = sectionsDuChangelog(txt);
  // ⚠️ LA VERSION EN PRÉPARATION A TOUJOURS UNE SECTION ET PAS ENCORE DE TAG, ET C'EST L'ÉTAT
  // NORMAL DE `main`. Le tag est posé APRÈS la fusion : entre les deux, `package.json`, la section
  // du haut et le tag à venir décrivent la même version dont seul le tag manque. Sans cette
  // exception, cette garde rougirait à CHAQUE train — et une garde qui rougit sur le déroulement
  // normal est une garde qu'on apprend à ignorer. C'est le banc « le dépôt lui-même » qui l'a
  // trouvé, sur la première version préparée après son écriture.
  //
  // ⚠️ L'EXCEPTION EST ANCRÉE SUR `package.json`, JAMAIS SUR « la plus haute ». Prendre la section
  // du haut dispenserait n'importe quelle section non taguée qui se trouverait en tête — y compris
  // un numéro sauté. Ancrée sur la version que le paquet DÉCLARE, elle ne dispense que celle dont
  // le tag est effectivement imminent, et le préflight confronte déjà ces deux-là.
  let enPreparation = null;
  try {
    enPreparation = JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).version || null;
  } catch { /* pas de package.json lisible : aucune section n'est dispensée */ }
  const tags = tagsDeVersion(lireTags());

  // ⚠️ ANTI-VACUITÉ, DES DEUX CÔTÉS. Un dépôt cloné sans tags (`--depth 1`, un miroir partiel) rend
  // « aucun tag », et « toutes les sections sont sans tag » se lirait comme une catastrophe ; un
  // CHANGELOG dont le format change rend « aucune section », et la confrontation serait vide. Les
  // deux sont des pannes de la sonde, pas des verdicts sur la branche.
  if (!sections.length) {
    return inconclusif("aucune section de version lue dans CHANGELOG.md — la sonde vise à côté, ou"
      + " le format a changé : rien n'a été vérifié");
  }
  if (!tags.length) {
    return inconclusif("aucun tag de version lisible — dépôt cloné sans tags, ou `git` indisponible :"
      + " la confrontation ne peut pas être établie, et rien n'a été vérifié");
  }

  const { sectionsSansTag, tagsSansSection } = confronter(sections, tags);
  const constats = [];
  const avertissements = [];

  for (const v of sectionsSansTag) {
    if (v === enPreparation) continue;
    if (v in SANS_TAG) { avertissements.push(`[${v}] : ${SANS_TAG[v]}`); continue; }
    constats.push(`le CHANGELOG porte une section [${v}] mais le tag v${v} n'existe pas. Le bloc de`
      + ` références est régénéré depuis l'ordre des sections, donc il PUBLIE`
      + ` « compare/v…...v${v} » — un lien qui ne résout pas, dans le dépôt et dans les notes de`
      + " Release. Taguez cette version, ou retirez sa section et reversez son contenu dans la"
      + " suivante.");
  }

  for (const t of tagsSansSection) {
    if (t in SANS_NOTES) { avertissements.push(`${t} : ${SANS_NOTES[t]}`); continue; }
    if (t in TAGS_MORTS) {
      // ⚠️ L'EXEMPTION SE VÉRIFIE. Un tag mort n'est toléré que TANT QU'IL EST MORT : le jour où
      // cette version paraît au registre, la raison écrite cesse d'être vraie et l'écart revient.
      if (estPubliee && estPubliee(t.slice(1))) {
        constats.push(`${t} est exempté comme « tag mort » — mais le registre SERT cette version.`
          + " L'exemption a survécu à son motif : retirez-la de TAGS_MORTS et écrivez la section.");
      }
      continue;
    }
    constats.push(`le tag ${t} existe mais le CHANGELOG n'a aucune section pour lui : la Release`
      + " publie des notes vides, et personne ne peut lire ce que cette version a changé. Écrivez la"
      + " section, ou déclarez le tag dans TAGS_MORTS avec sa raison.");
  }

  if (constats.length) return violation(constats, avertissements);
  return conforme(`${sections.length} section(s) et ${tags.length} tag(s) confrontés`
    + (enPreparation && sectionsSansTag.includes(enPreparation) ? ` (${enPreparation} en préparation, tag à venir)` : "")
    + " — hors"
    + ` ${Object.keys(TAGS_MORTS).length} tag(s) mort(s) déclaré(s) et ${avertissements.length}`
    + " dette(s) nommée(s), chaque section porte son tag et chaque tag porte sa section",
    avertissements);
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
