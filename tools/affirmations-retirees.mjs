// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE AFFIRMATION QU'ON A DÉCIDÉ DE RETIRER NE DOIT PLUS SE LIRE COMME VRAIE, NULLE PART.
//
// ⚠️ TROIS FOIS EN DEUX JOURS, LA MÊME PANNE : une phrase corrigée à un endroit, son jumeau laissé
// ailleurs. « Le compte partagé n'est pas atomique » réparé dans le contrat anglais, laissé 95
// lignes plus haut dans le fichier français QU'ON ÉDITAIT LE MÊME JOUR. « Un visiteur décide de ce
// qui entre » réparé dans deux fichiers sur trois. Et « par processus par conception » laissé dans
// SECURITY.md et THREAT-MODEL.md, où il mettait hors périmètre un étage que le code implémente —
// c'est-à-dire qu'il disait à un chercheur de ne pas regarder.
//
// ⚠️ CETTE GARDE NE CONFRONTE PAS UNE PHRASE À CE QU'ELLE DÉCRIT, ET IL NE FAUT PAS LE CROIRE.
// AGENTS.md dit qu'aucune garde ici ne sait faire ça, et c'est toujours vrai : le fait qu'une
// migration existe ne dit à aucun programme quel paragraphe ment. Ce qui est mécanisable, c'est la
// sous-classe étroite où NOUS AVONS DÉJÀ DÉCIDÉ qu'une affirmation est retirée. La garde confronte
// alors le dépôt à cette décision-là, pas à la réalité. C'est beaucoup moins, et c'est ce qui a
// échoué trois fois.
//
// LA RÈGLE : une affirmation retirée peut encore s'écrire — on corrige en place plutôt que de
// supprimer, pour qu'un hôte qui l'a lue puisse l'apprendre — mais la LIGNE qui la porte doit aussi
// porter un marqueur de rétractation. « Il disait », « used to », « c'est faux depuis ». Une
// citation non marquée est indiscernable d'une affirmation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Les affirmations retirées, avec la date et la raison. Une entrée sans raison est une exemption. */
export const RETIREES = [
  {
    nom: "le compte de débit partagé « n'est pas atomique »",
    motif: /(?:le compte partagé n'est pas atomique|the shared count is not atomic|non-atomic rate counters|compteurs de débit non atomiques|comptées par instance et non atomiques)/i,
    pourquoi: "faux depuis la migration 0004 : sans elle l'étage partagé ne compte pas MOINS BIEN, il ne compte PAS DU TOUT",
    retiree: "2026-09-11",
  },
  {
    nom: "la limitation de débit est « par processus par conception »",
    motif: /(?:per-process by design|par processus par conception)/i,
    pourquoi: "le contexte autonome porte un étage partagé ATOMIQUE ; le dire « par conception » met hors périmètre un étage qui existe, c'est-à-dire dit à un chercheur de ne pas regarder",
    retiree: "2026-09-12",
  },
  {
    nom: "« un visiteur décide de ce qui entre » dans le cache de voix",
    motif: /(?:a visitor chooses what goes in|un visiteur décide de ce qui y entre|c'est un visiteur qui décide de ce qui y entre)/i,
    pourquoi: "bot-tts confronte le texte à ce que l'assistant a réellement dit : l'appelant PROPOSE, il ne choisit pas",
    retiree: "2026-09-11",
  },
];

/**
 * Ce qui, sur la même ligne, transforme une affirmation en citation.
 *
 * ⚠️ DÉLIBÉRÉMENT PAUVRE. Une liste riche finirait par accepter n'importe quelle phrase contenant un
 * verbe au passé, et la garde deviendrait verte en ne regardant plus rien.
 */
export const MARQUEURS = [
  /\bused to\b/i, /\bdisait\b/i, /\bdisaient\b/i, /\bstale\b/i, /\bthat has been\b/i,
  /c'est faux/i, /\bn'est plus vrai\b/i, /\bce paragraphe\b/i, /\bthis bullet\b/i,
  /\bcette phrase\b/i, /\bthis paragraph\b/i, /\bthis sentence\b/i, /\bused to read\b/i,
  /\bnommait\b/i, /\bannonçait\b/i, /\baffirmait\b/i, /\bit said\b/i, /\bwas false\b/i,
];

/** Les fichiers où une affirmation retirée serait lue comme vraie. */
export const EXTENSIONS = [".md", ".js", ".mjs", ".ts", ".sql"];

/**
 * ⚠️ LES ARCHIVES SONT EXCLUES, ET C'EST LA SEULE EXCLUSION. Un CHANGELOG et un rapport d'audit
 * SONT des récits datés : ils citent ce qui était vrai à leur date, et les réécrire falsifierait
 * l'histoire qu'ils portent. Tout le reste du dépôt parle au présent.
 */
export const estArchive = (chemin) =>
  /(^|\/)CHANGELOG\.md$/.test(chemin) || /(^|\/)docs\/AUDIT-/.test(chemin);

/** La garde et son banc contiennent les motifs par nécessité : ils les DÉFINISSENT. */
export const estLaGardeElleMeme = (chemin) =>
  /(^|\/)tools\/affirmations-retirees\.mjs$/.test(chemin)
  || /(^|\/)tools\/__tests__\/affirmationsRetirees\.test\.js$/.test(chemin);

export function fichiersDe(racine, dossiers) {
  const vus = [];
  const descendre = (d) => {
    let entrees;
    try { entrees = readdirSync(d); } catch { return; }
    for (const e of entrees) {
      if (e === "node_modules" || e === ".git" || e === "dist") continue;
      const complet = join(d, e);
      let st;
      try { st = statSync(complet); } catch { continue; }
      if (st.isDirectory()) { descendre(complet); continue; }
      if (!EXTENSIONS.some((x) => e.endsWith(x))) continue;
      const rel = relative(racine, complet).split("\\").join("/");
      if (estArchive(rel) || estLaGardeElleMeme(rel)) continue;
      vus.push(rel);
    }
  };
  for (const sous of dossiers) descendre(join(racine, sous));
  for (const e of readdirSync(racine)) {
    if (!EXTENSIONS.some((x) => e.endsWith(x))) continue;
    if (estArchive(e) || estLaGardeElleMeme(e)) continue;
    vus.push(e);
  }
  return [...new Set(vus)].sort();
}

/**
 * Les lignes qui portent une affirmation retirée SANS marqueur de rétractation.
 *
 * ⚠️ LE MARQUEUR EST CHERCHÉ SUR LA LIGNE ET LES DEUX PRÉCÉDENTES, PAS SUR LA SEULE LIGNE. Une
 * citation s'enroule : dans un fichier à cent colonnes, « ce paragraphe disait que… » et la phrase
 * citée tombent rarement sur la même ligne. Exiger la coïncidence forcerait un formatage tordu et,
 * pire, apprendrait à glisser un mot-marqueur par réflexe — une garde qu'on satisfait par un tic
 * ne garde plus rien.
 *
 * ⚠️ ET ON REGARDE EN ARRIÈRE SEULEMENT. Une rétractation qui SUIT l'affirmation ne la protège pas :
 * ce dépôt a déjà écrit pourquoi — « très loin, on ne fait pas le lien ; très près, on croit qu'il a
 * déjà été fait ». Un lecteur qui abandonne à la phrase fausse ne lira jamais la correction.
 */
export const REGARD_ARRIERE = 2;

export function nonMarquees(texte, retirees = RETIREES, marqueurs = MARQUEURS) {
  const fautes = [];
  const lignes = String(texte).split("\n");
  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    const fenetre = lignes.slice(Math.max(0, i - REGARD_ARRIERE), i + 1).join("\n");
    for (const r of retirees) {
      if (!r.motif.test(ligne)) continue;
      if (marqueurs.some((m) => m.test(fenetre))) continue;
      fautes.push({ ligne: i + 1, nom: r.nom, pourquoi: r.pourquoi, retiree: r.retiree, texte: ligne.trim().slice(0, 140) });
    }
  }
  return fautes;
}

export const DOSSIERS = ["server", "context", "src", "docs", "tools", "supabase", "base", "charge", "bin", "build"];

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    for (const r of RETIREES) {
      if (!r.pourquoi || String(r.pourquoi).length < 30) {
        return inconclusif([`l'entrée « ${r.nom} » n'a pas de raison écrite — une entrée sans raison est une exemption muette`]);
      }
    }
    const fichiers = fichiersDe(".", DOSSIERS);
    // ⚠️ COMPTER LES FICHIERS NE SUFFISAIT PAS, ET LE PLANCHER DU DÉPÔT L'A REFUSÉ. La première
    // écriture exigeait « au moins vingt fichiers » ; l'éprouvette de `planchersDesGardes` copie
    // `tools/` en entier dans un arbre VIDE, donc la sonde y trouvait quarante `.mjs`, n'y lisait
    // aucune affirmation — puisqu'il n'y a ni documentation ni serveur — et concluait VERTE. Un
    // compte d'entrées n'est pas une preuve qu'on a lu SON OBJET.
    //
    // Les affirmations retirées vivent d'abord dans la PROSE : sans documents, la confrontation n'a
    // pas de sujet, quel que soit le nombre de fichiers de code parcourus.
    const documents = fichiers.filter((f) => f.endsWith(".md"));
    if (documents.length < 10) {
      return inconclusif([
        `${documents.length} document(s) .md lus sur ${fichiers.length} fichier(s) — les affirmations retirées vivent dans la prose, donc rien n'a été confronté`,
      ]);
    }
    const constats = [];
    for (const f of fichiers) {
      let texte;
      try { texte = readFileSync(f, "utf8"); } catch { continue; }
      for (const x of nonMarquees(texte)) {
        constats.push(`${f}:${x.ligne} — affirmation retirée le ${x.retiree} (« ${x.nom} ») écrite sans marqueur de rétractation : ${x.pourquoi}. La ligne : « ${x.texte} ». Corrigez-la EN PLACE en disant ce qu'elle disait, ou marquez la citation.`);
      }
    }
    if (constats.length) return violation(constats);
    return conforme(`${fichiers.length} fichiers dont ${documents.length} documents, confrontés à ${RETIREES.length} affirmation(s) retirée(s) : aucune écrite comme vraie`);
  }));
}
