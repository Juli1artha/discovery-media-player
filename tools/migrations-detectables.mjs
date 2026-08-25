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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
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
  const t = String(sql || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
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

  return noms
    .filter((f) => parFichier[f].length && !parFichier[f].some((s) => porteurs.get(s).length === 1))
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
    .map((x) => `${x.fichier} n'a AUCUN signe qui lui soit propre — elle se confond avec ${x.confondueAvec.join(", ")}, ` +
      `et un hôte ne peut pas prouver qu'elle a tourné en sondant sa base. Ajoutez-lui un « drop » de la signature ` +
      `précédente, ou un objet qu'elle seule crée. Si c'est impossible, déclarez-la dans ` +
      `tools/migrations-detectables.mjs avec ce que ça coûte à l'hôte.`);

  // ⚠️ UNE DÉCLARATION QUI NE CORRESPOND PLUS À RIEN EST UN MENSONGE QUI DORT : elle décrit une dette
  // que le dépôt n'a plus, et personne ne la relit tant qu'elle ne gêne pas.
  const vivantes = new Set(fautives.map(cleDe));
  const perimees = Object.keys(declarees).filter((k) => !vivantes.has(k))
    .map((k) => `« ${k} » est déclarée improuvable et ne l'est plus — retirez la déclaration`);
  return [...soucis, ...perimees];
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
    const declarees = Object.keys(INDISTINGUABLES_DECLAREES).length;
    return conforme(`migrations : ${n} lues, chacune prouvable sur ses effets — ${declarees} déclarée(s) improuvable(s)`);
  }));
}
