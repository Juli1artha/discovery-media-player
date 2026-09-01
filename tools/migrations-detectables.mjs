// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN HÔTE DOIT POUVOIR PROUVER QU'UNE MIGRATION A TOURNÉ, EN SONDANT SA BASE.
//
// ⚠️ CETTE PROPRIÉTÉ EXISTAIT SANS ÊTRE ÉCRITE, ET UN HÔTE EN DÉPEND. Constaté le 25/08 par un
// hôte de production qui réparait son registre de migrations : le sien n'inscrivait que 0001, 0002
// et 0005 à 0011 alors que huit autres étaient bel et bien appliquées — un registre n'enregistre
// que ce qui est passé par un chemin donné. La seule réponse fiable à « l'ai-je jouée ? » se lit
// donc sur les EFFETS, pas dans une table.
//
// ⚠️ ET NOTRE CHAÎNE LE PERMETTAIT PAR ACCIDENT. 0015, 0017, 0018 et 0019 redéfinissent TOUTES
// `player_attendance_bump` : son existence ne prouve que la dernière. Ce qui les sépare est que
// chacune supprime EXACTEMENT la signature de la précédente —
//
//     0017  drop player_attendance_bump(10 args)
//     0018  drop player_attendance_bump(11 args)
//     0019  drop player_attendance_bump(12 args)
//
// — donc aucune ancienne signature ne subsiste, donc chaque `drop` a eu lieu, donc chacune a
// tourné. Personne n'avait décidé ça ; c'est une discipline tenue sans être écrite. Le jour où une
// migration ne fera qu'un `create or replace` sans `drop`, elle deviendra indistinguable de sa
// voisine — SANS QUE RIEN NE CASSE. La fonction est là, tout a l'air bon.
//
// ⚠️ ET CE JOUR EST DÉJÀ ARRIVÉ : 0007 et 0010 créent la MÊME signature `player_archive_scellee()`,
// et 0010 ne supprime rien et ne crée rien d'autre. Les deux sont indistinguables l'une de l'autre
// sur le schéma. Elles sont donc déclarées ci-dessous plutôt que corrigées : une migration
// appliquée ailleurs est immuable, et la réécrire serait le défaut que ce dépôt fait crier.
//
// ⚠️ HEURISTIQUE ASSUMÉE. On lit des formes DDL hors commentaires ; on ne comprend pas le SQL. Un
// signe qu'on manque coûte un refus à tort — c'est pourquoi le refus NOMME le groupe et la
// déclaration est possible. Un signe qu'on inventerait serait pire : on ne retient donc que ce qui
// suit immédiatement un verbe connu.
//
// Usage : node tools/migrations-detectables.mjs

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const DOSSIER = "supabase/migrations";

/**
 * Les groupes de migrations qu'on SAIT indistinguables, avec ce que ça coûte à qui les consomme.
 * Une entrée n'est pas un pardon : c'est une dette écrite, lisible par l'hôte qui sondera.
 */
export const INDISTINGUABLES_DECLAREES = {
  "0010-archive-verrou-share.sql (se confond avec 0007-archive-scellee.sql)":
    "0010 recrée `player_archive_scellee()` avec la MÊME signature que 0007 et ne supprime rien ; " +
    "0007, elle, pose deux triggers qui la prouvent. Sonder le schéma ne dira jamais si 0010 a " +
    "tourné — il faut LIRE LE CORPS de la fonction. Elle est appliquée ailleurs, donc immuable : " +
    "on déclare, on ne réécrit pas.",
};

/**
 * Les signes qu'une migration laisse et qu'un hôte peut sonder.
 * ⚠️ La signature d'une fonction en fait partie : c'est le nombre d'arguments qui a séparé
 * 0017/0018/0019, pas le nom.
 */
export function signesDe(sql) {
  // ⚠️ ON RETIRE AUSSI LES CORPS DE FONCTION, PAS SEULEMENT LES COMMENTAIRES. Un corps est du code
  // que la fonction EXÉCUTE, pas une déclaration que la migration FAIT : un `execute 'create index
  // …'` à l'intérieur serait compté comme un signe que la migration ne laisse pas. La distinction
  // est DÉCLARATION contre RÉFÉRENCE, et elle n'existe pas dans le texte brut d'un fichier — c'est
  // exactement là qu'une sonde voisine s'est trompée cinq fois en une journée, dont une en
  // accusant une migration parfaitement saine parce qu'une colonne y était LUE et non ajoutée.
  //
  // ⚠️ Zéro occurrence aujourd'hui : ce correctif ne change aucun compte, il ferme une porte. La
  // déclaration de la fonction elle-même est HORS du corps, donc elle reste relevée.
  //
  // ⚠️ ET « CORPS DE FONCTION » N'EST PAS « BLOC ENTRE $$ ». La première écriture retirait TOUT bloc
  // délimité par `$$`, ce qui emportait aussi les `do $$ … $$` — or un bloc `do` n'est pas un corps
  // que quelqu'un appellera plus tard : c'est du code que LA MIGRATION EXÉCUTE, donc ce qu'il
  // déclare, la migration le déclare. La 0020 pose ses six contraintes dans un `do` (pour tester
  // leur existence, `add constraint if not exists` n'existant pas en PostgreSQL) et se faisait
  // accuser de ne laisser aucun signe. La garde avait raison de refuser une migration muette ;
  // elle avait tort sur celle-là, et c'est ce qui l'a montré.
  const t = String(sql || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(\bdo\s*)?\$\$([\s\S]*?)\$\$/gi, (tout, doDevant, corps) => (doDevant ? doDevant + corps : " $BODY$ "));
  const signes = new Set();
  const arite = (args) => args.split(",").filter((a) => a.trim()).length;
  for (const [, nom, args] of t.matchAll(/\bdrop\s+function\s+(?:if\s+exists\s+)?([\w.]+)\s*\(([^)]*)\)/gi)) {
    signes.add(`drop function ${nom}/${arite(args)}`);
  }
  for (const [, nom, args] of t.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([^)]*)\)/gi)) {
    signes.add(`function ${nom}/${arite(args)}`);
  }
  for (const [, genre, nom] of t.matchAll(/\bcreate\s+(?:unique\s+)?(table|index|view|policy|type|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) {
    signes.add(`${genre.toLowerCase()} ${nom}`);
  }

  // ⚠️ UNE CONTRAINTE NOMMÉE EST SONDABLE — `pg_constraint`. Elle manquait à la liste, et la 0020
  // ne laisse QUE ça : elle n'ajoute ni table, ni colonne, ni index, elle restreint une plage.
  // Un hôte prouve son passage en demandant `conname = 'ck_views_page_borne'`, ce qu'aucune autre
  // migration ne peut lui faire répondre.
  for (const [, nom] of t.matchAll(/\badd\s+constraint\s+([\w.]+)/gi)) {
    signes.add(`constraint ${nom}`);
  }

  // ⚠️ SEPT MIGRATIONS SUR DIX-NEUF N'AVAIENT AUCUN SIGNE, et la garde les SAUTAIT en annonçant
  // « chacune prouvable ». Elles en laissaient pourtant toutes — c'est la sonde qui ne les cherchait
  // pas. Une couverture affirmée plus large qu'elle n'est vaut moins que pas de couverture : on
  // cesse de vérifier ce qu'on croit déjà tenu.
  //
  // Les quatre formes qui manquaient, chacune sondable :
  //   colonne ajoutée      information_schema.columns
  //   commentaire posé     col_description() — 0012 ne repose QUE là-dessus
  //   contrainte relâchée  is_nullable
  //   identité de réplic.  pg_class.relreplident
  for (const [, table, colonne] of t.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([\w.]+)[\s\S]{0,200}?\badd\s+column\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) {
    signes.add(`column ${table}.${colonne}`);
  }
  // ⚠️ LE SIGNE D'UN COMMENTAIRE EST SON TEXTE, PAS SA PRÉSENCE. 0012 REMPLACE le commentaire que
  // 0011 avait posé sur la même colonne : « cette colonne est-elle commentée ? » répond oui pour
  // les deux. Ce qui les sépare est ce que le commentaire DIT — et `col_description()` le rend,
  // donc c'est sondable. Un condensat court suffit à distinguer sans embarquer la prose ici.
  for (const [, cible, texte] of t.matchAll(/\bcomment\s+on\s+(?:column|table|function|index)\s+([\w.]+)\s+is\s+([\s\S]*?);/gi)) {
    const empreinte = createHash("sha256").update(texte.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 8);
    signes.add(`comment ${cible} #${empreinte}`);
  }
  for (const [, table, colonne, sens] of t.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([\w.]+)[\s\S]{0,200}?\balter\s+column\s+([\w.]+)\s+(drop|set)\s+not\s+null/gi)) {
    signes.add(`nullability ${table}.${colonne} ${sens.toLowerCase()}`);
  }
  for (const [, table, mode] of t.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([\w.]+)\s+replica\s+identity\s+(\w+)/gi)) {
    signes.add(`replica identity ${table} ${mode.toLowerCase()}`);
  }
  return [...signes].sort();
}

/**
 * Les migrations dont AUCUN signe ne leur est propre — donc improuvables sur les effets.
 *
 * ⚠️ LA PROPRIÉTÉ EST « CETTE MIGRATION A-T-ELLE UN SIGNE À ELLE », PAS « DEUX MIGRATIONS SE
 * RESSEMBLENT-ELLES ». Ma première écriture groupait les jeux de signes identiques et laissait
 * passer 0010 : elle partage `player_archive_scellee/0` avec 0007, mais 0007 a EN PLUS deux
 * triggers à elle. 0007 est donc prouvable et 0010 ne l'est pas — le défaut est unilatéral, et un
 * groupement le manquait parce qu'il n'y avait pas de groupe. Ce que j'affirmais détecter et ce que
 * je détectais n'étaient pas la même chose ; le banc ne l'aurait pas vu, seule la mesure sur les
 * dix-neuf vraies migrations l'a montré.
 *
 * Rend aussi AVEC QUI chacune se confond : « 0010 est improuvable » n'indique pas où regarder.
 */
export function improuvables(parFichier) {
  const noms = Object.keys(parFichier).sort();
  const porteurs = new Map();
  for (const f of noms) for (const s of parFichier[f]) porteurs.set(s, [...(porteurs.get(s) || []), f]);

  // ⚠️ UNE MIGRATION SANS AUCUN SIGNE N'EST PLUS SAUTÉE. Le filtre disait `parFichier[f].length &&`,
  // donc sept migrations passaient sans être regardées pendant que la garde annonçait « chacune
  // prouvable ». N'avoir aucun signe est PIRE que se confondre avec une voisine : on ne peut même
  // pas nommer ce qu'il faudrait sonder.
  return noms
    .filter((f) => !parFichier[f].some((s) => porteurs.get(s).length === 1))
    .map((f) => ({
      fichier: f,
      confondueAvec: [...new Set(parFichier[f].flatMap((s) => porteurs.get(s)).filter((x) => x !== f))].sort(),
    }));
}

export const cleDe = ({ fichier, confondueAvec }) => `${fichier} (se confond avec ${confondueAvec.join(", ")})`;

export function ecarts(parFichier, declarees = INDISTINGUABLES_DECLAREES) {
  const fautives = improuvables(parFichier);
  const soucis = fautives
    .filter((x) => !declarees[cleDe(x)])
    .map((x) => (x.confondueAvec.length
      ? `${x.fichier} n'a AUCUN signe qui lui soit propre — elle se confond avec ${x.confondueAvec.join(", ")}, `
      : `${x.fichier} ne laisse AUCUN signe sondable — pire que se confondre : on ne peut même pas nommer ce qu'il faudrait chercher, `) +
      `et un hôte ne peut pas prouver qu'elle a tourné en sondant sa base. Donnez-lui un « drop » de la signature ` +
      `précédente, ou un objet qu'elle seule crée. Si c'est impossible, déclarez-la dans ` +
      `tools/migrations-detectables.mjs avec ce que ça coûte à l'hôte.`);

  // ⚠️ UNE DÉCLARATION QUI NE CORRESPOND PLUS À RIEN EST UN MENSONGE QUI DORT : elle décrit une dette
  // que le dépôt n'a plus, et personne ne la relit tant qu'elle ne gêne pas.
  const vivantes = new Set(fautives.map(cleDe));
  const perimees = Object.keys(declarees).filter((k) => !vivantes.has(k))
    .map((k) => `« ${k} » est déclarée improuvable et ne l'est plus — retirez la déclaration`);
  return [...soucis, ...perimees];
}

/**
 * Le GENRE d'un signe — la forme que la sonde a reconnue pour le produire.
 * ⚠️ `drop function x/3` est d'un autre genre que `function x/3` : ce sont deux détecteurs.
 */
export const genreDuSigne = (signe) =>
  (/^(drop function|replica identity|nullability|constraint|comment|column|function|table|index|view|policy|type|trigger)\b/
    .exec(String(signe)) || [])[1] || null;

/**
 * Les genres qu'AU MOINS UNE migration réelle atteste, mesurés le 01/09 sur les 24 fichiers :
 * function 13, column 11, comment 11, index 9, constraint 9, trigger 3, drop function 3,
 * table 2, nullability 1, replica identity 1.
 *
 * ⚠️ CE N'EST PAS UN RELEVÉ DU JOUR QU'ON RECOPIE, C'EST UNE PROPRIÉTÉ STABLE PAR CONSTRUCTION.
 * Une migration appliquée ailleurs est immuable — c'est écrit en tête de ce fichier et c'est
 * pourquoi 0010 est déclarée plutôt que corrigée. Les fichiers existants ne changeront donc
 * jamais : ce que la sonde y voit aujourd'hui, elle doit l'y voir toujours. Le seul événement qui
 * peut faire disparaître un genre de cette liste est que la sonde cesse de le reconnaître.
 *
 * `view`, `policy` et `type` sont reconnus par le même `matchAll` que `table` et `index` mais
 * qu'aucune migration ne pose aujourd'hui : ils ne sont pas attestés, donc pas exigés — un
 * plancher ne peut pas exiger ce qu'il n'a jamais mesuré.
 */
export const GENRES_ATTESTES = [
  "column", "comment", "constraint", "drop function", "function",
  "index", "nullability", "replica identity", "table", "trigger",
];

/** Les genres attestés que la sonde ne voit plus dans le corpus qu'on vient de lire. */
export function genresManquants(parFichier, attestes = GENRES_ATTESTES) {
  const vus = new Set();
  for (const signes of Object.values(parFichier)) {
    for (const signe of signes) {
      const genre = genreDuSigne(signe);
      if (genre) vus.add(genre);
    }
  }
  return attestes.filter((genre) => !vus.has(genre));
}

export const lireDossier = (dossier = DOSSIER) =>
  Object.fromEntries(readdirSync(dossier).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => [f, signesDe(readFileSync(join(dossier, f), "utf8"))]));

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const parFichier = lireDossier();
    const n = Object.keys(parFichier).length;
    if (!n) throw new Error(`aucune migration sous ${DOSSIER} — la sonde vise à côté`);
    const soucis = ecarts(parFichier);
    if (soucis.length) return violation(soucis);
    // ⚠️ LE RÉSUMÉ DIT CE QU'ON A MESURÉ, PAS CE QU'ON EN CONCLUT. Il annonçait « chacune prouvable
    // sur ses effets » pendant que SEPT migrations sur dix-neuf n'avaient aucun signe et étaient
    // sautées. Compter les signes relevés rend le mensonge impossible : une sonde qui cesserait de
    // voir une forme ferait chuter ce nombre à vue d'œil.
    //
    // ⚠️ À VUE D'ŒIL DE QUI ? Cette phrase se donnait pour une protection sans que rien ne la
    // tienne. Mesuré le 01/09 en aveuglant les huit détecteurs un par un sur les migrations
    // réelles : cinq rendent ROUGE — une migration devient muette ou indistinguable et la garde la
    // NOMME. Trois laissaient la garde VERTE, en faisant seulement baisser le nombre imprimé :
    //
    //     drop function aveuglé   63 → 60 signes   vert
    //     nullability aveuglé     63 → 62 signes   vert
    //     add column aveuglé      63 → 52 signes   vert
    //
    // Onze signes sur soixante-trois pouvaient disparaître sans que rien ne le dise. Un nombre
    // qu'aucun œil ne regarde ne protège rien.
    //
    // ⚠️ ET CE QU'IL FAUT PLANCHÉRISER EST LA FORME RECONNUE, PAS LE NOMBRE DE SIGNES. Un seuil sur
    // les 63 aurait l'apparence d'une mesure et la nature d'une signature : haut, il refuse un
    // corpus sain ; bas, il ne voit ni 60 ni 52. Exiger que CHAQUE genre attesté soit encore vu,
    // lui, tient sans être collé au relevé du jour — un détecteur aveuglé fait disparaître son
    // genre ENTIER, quel que soit le nombre de signes que les autres continuent de produire.
    const manquants = genresManquants(parFichier);
    if (manquants.length) {
      return inconclusif(`plus aucune migration ne laisse de signe de genre ${manquants.map((g) => `« ${g} »`).join(", ")} — les fichiers étant immuables, ce n'est pas le corpus qui a changé, c'est la sonde qui a cessé de reconnaître cette forme`);
    }
    const declarees = Object.keys(INDISTINGUABLES_DECLAREES).length;
    const signes = Object.values(parFichier).reduce((t, x) => t + x.length, 0);
    return conforme(`migrations : ${n} lues, ${signes} signes sondables relevés de ${GENRES_ATTESTES.length} genres attestés, aucune muette — ${declarees} déclarée(s) improuvable(s)`);
  }));
}
