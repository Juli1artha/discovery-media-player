// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE COLONNE PURGÉE PORTE SON ATTESTATION — ET CE N'EST PLUS UNE COMMODITÉ, C'EST UN ENGAGEMENT.
//
// ⚠️ CE QUI A CHANGÉ LE 01/09, ET QUI NE SE VOYAIT PAS D'ICI. Le commentaire de colonne posé par la
// 0026 et la 0027 avait été conçu comme un signe SONDABLE : une migration qui n'efface que des
// données ne laisse aucune trace dans `information_schema`, donc elle est indistinguable de celle
// qui n'a jamais été appliquée — or c'est précisément celle dont un DPO demande la preuve.
//
// Un hôte nous a signalé qu'il ne le lit plus à la main : son inventaire périodique CROISE ce
// commentaire avec les comptes résiduels, et en tire une alarme — des valeurs qui réapparaissent à
// côté d'une attestation signifient que quelqu'un s'est remis à écrire ce que la purge avait vidé.
//
// ⚠️ UN ARTEFACT CONÇU POUR UNE PERSONNE EST LU PAR UNE MACHINE : c'est le moment où l'on décide
// s'il devient un engagement ou reste une commodité. Nous décidons l'engagement, et la raison est
// le MODE DE PANNE. Cesser un jour de poser ce commentaire ne casserait rien chez nous ; ça rendrait
// l'alarme de cet hôte MUETTE, sans rien lui dire. Un silence causé chez lui par un changement chez
// nous que rien ne lui signale — exactement ce que ce dépôt refuse partout ailleurs.
//
// ⚠️ ET UN ENGAGEMENT ÉCRIT NULLE PART AILLEURS QUE DANS UNE PHRASE EST UN FAIT FIGÉ DE PLUS. La
// question que le même hôte nous renvoie : « qu'est-ce qui rougit si quelqu'un le défait ? »
// Ceci. La règle lie l'ACTE à la TRACE : toute colonne qu'une migration VIDE doit porter un
// commentaire commençant par le marqueur. Oublier le commentaire en ajoutant une purge fait rougir.
//
// LE MARQUEUR EST STABLE PAR ENGAGEMENT. Il est en majuscules non accentuées et sans apostrophe :
// il traverse les encodages, se cherche au `grep`, et se reconnaît sans analyser du français.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** ⚠️ ENGAGEMENT PUBLIC (docs/HOST-CONTRACT.md). Ne pas reformuler : des hôtes s'y accrochent. */
export const MARQUEUR = "VIDE ET PLUS JAMAIS ECRITE depuis la ";

export const SOURCES = ["supabase/migrations", "supabase/init.sql"];

/** Les fichiers SQL du périmètre, dossier ou fichier unique. */
export function fichiersSql(sources = SOURCES, lireDossier = readdirSync) {
  const out = [];
  for (const s of sources) {
    if (s.endsWith(".sql")) { out.push(s); continue; }
    for (const f of lireDossier(s).filter((n) => n.endsWith(".sql")).sort()) out.push(join(s, f));
  }
  return out;
}

/**
 * Les colonnes qu'un texte VIDE — `update <table> set <colonne> = null`.
 *
 * ⚠️ C'est l'ACTE qu'on relève, pas l'intention : une purge se reconnaît à ce qu'elle écrit.
 */
export function colonnesVidees(sql) {
  const out = new Set();
  for (const [, table, colonne] of sql.matchAll(/\bupdate\s+([\w.]+)\s+set\s+([\w]+)\s*=\s*null/gi)) {
    out.add(`${table}.${colonne}`);
  }
  return [...out];
}

/** Les colonnes qu'un texte ATTESTE — un commentaire commençant par le marqueur. */
export function colonnesAttestees(sql, marqueur = MARQUEUR) {
  const out = new Set();
  for (const [, cible, texte] of sql.matchAll(/\bcomment\s+on\s+column\s+([\w.]+)\s+is\s+([\s\S]*?);/gi)) {
    // Le commentaire est un littéral, parfois concaténé sur plusieurs lignes : seul le DÉBUT du
    // premier morceau porte le marqueur, et c'est bien là qu'un lecteur machine le cherche.
    if (texte.replace(/^\s*'/, "").startsWith(marqueur)) out.add(cible);
  }
  return [...out];
}

export function manquements(fichiers, lire = readFileSync, marqueur = MARQUEUR) {
  const soucis = [];
  let videes = 0, attestees = 0;
  for (const f of fichiers) {
    const sql = lire(f, "utf8");
    const v = colonnesVidees(sql);
    const a = new Set(colonnesAttestees(sql, marqueur));
    videes += v.length;
    attestees += a.size;
    for (const cible of v) {
      if (!a.has(cible)) {
        soucis.push(`${f} : « ${cible} » est vidée sans attestation — un « comment on column ${cible} is '${marqueur}…' » `
          + "doit accompagner la purge. Sans lui, l'acte est indistinguable d'une migration jamais appliquée, "
          + "et l'alarme des hôtes qui croisent ce commentaire avec leurs comptes devient muette pour cette colonne.");
      }
    }
  }
  return { soucis, videes, attestees };
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const fichiers = fichiersSql();
    if (!fichiers.length) return inconclusif("aucun fichier SQL — la sonde vise à côté");
    const { soucis, videes, attestees } = manquements(fichiers);
    // ⚠️ LE TÉMOIN DE LA RÈGLE, PAS CELUI DU PÉRIMÈTRE. Zéro colonne vidée sur vingt-huit fichiers ne
    // veut pas dire que le dépôt n'atteste rien : ça veut dire que la sonde ne reconnaît plus la
    // forme d'une purge. Le plancher est à UN parce que ce dépôt en porte depuis la 0026.
    if (!videes) {
      return inconclusif(`aucune colonne vidée reconnue dans ${fichiers.length} fichier(s) — ce n'est pas `
        + "une absence de purge, c'est une sonde qui ne lit plus la forme d'un « update … set … = null »");
    }
    if (soucis.length) return violation(soucis);
    return conforme(`attestation de purge : ${videes} colonne(s) vidée(s), toutes attestées `
      + `(${attestees} commentaire(s) au marqueur) dans ${fichiers.length} fichier(s) SQL`);
  }));
}
