// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE FAIT, PAS LE LIBELLÉ — COMMENT ON RECONNAÎT UN CONFLIT D'UNICITÉ.
//
// ⚠️ CE QUE FAISAIENT LES SIX SITES, ET CE QUE ÇA COÛTAIT.
//
//     if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
//
// Le message que `context/standalone.js` compose est `Supabase POST /chemin?… → 409`, et le CHEMIN
// contient le slug, l'identifiant, le numéro de page. Chercher « 409 » n'importe où dans cette
// chaîne confond donc le statut avec les DONNÉES. Mesuré le 24/08 sur les formes réelles :
//
//     Supabase POST  /doc_presentation_attendees                  → 409   conflit    ✅
//     Supabase POST  /doc_presentation_attendees?slug=eq.demo409  → 500   conflit    ❌
//     Supabase PATCH /doc_bot_sessions?id=eq.sess-409abc          → 500   conflit    ❌
//     Supabase GET   /doc_pages?page=eq.409                       → 503   conflit    ❌
//
// Trois sur quatre. Et l'usage est toujours `if (!conflit) throw` : une vraie panne 500 était donc
// AVALÉE, et le code continuait comme si la ligne existait déjà. Il suffit d'un document dont le
// slug porte « 409 » — un numéro de référence, une date — pour qu'une erreur de base disparaisse.
//
// ⚠️ LE FAIT EXISTE DÉJÀ. `context/standalone.js` pose `erreur.statusCode = r.status` depuis la
// correction de PGRST202, et son commentaire dit que le studio expose la même chose : « les deux
// formes convergent enfin ». Six sites lisaient encore le texte à côté.
//
// La leçon vient d'un exploitant, qui l'a payée sur son propre outillage : un tri sur un LIBELLÉ
// s'est renversé le jour où il a trouvé un meilleur mot. Un test sur un libellé a la même
// fragilité, en pire — il ne se renverse pas, il se trompe en silence.
//
// ⚠️ POURQUOI IL RESTE UN REPLI TEXTUEL. Un hôte tiers implémente `db.request` lui-même et peut
// n'avoir jamais posé `statusCode`. Le repli existe donc, mais il ne cherche plus « 409 » n'importe
// où : il ne l'accepte QU'À LA PLACE DU STATUT, en fin de message, là où le contrat le met. Un slug
// ne peut pas s'y trouver.

/** Le statut HTTP d'une erreur de base, ou `null` si personne ne l'a posé. */
const statutDe = (erreur) => {
  const s = erreur && (erreur.statusCode ?? erreur.status);
  return Number.isInteger(s) ? s : null;
};

/**
 * Vrai si cette erreur EST un conflit d'unicité (409).
 *
 * ⚠️ L'ordre compte : le fait d'abord, le texte seulement à défaut. Inverser reviendrait à
 * consulter le libellé même quand le statut est là — c'est-à-dire à garder le défaut avec une
 * façade.
 */
function estConflit(erreur) {
  const statut = statutDe(erreur);
  if (statut !== null) return statut === 409;
  // ⚠️ REPLI : « 409 » EN POSITION DE STATUT, c'est-à-dire APRÈS la flèche — jamais ailleurs.
  // Un premier essai exigeait la fin de message ou un tiret de détail : c'était se caler sur le
  // format d'UN contexte, et quatre bancs l'ont refusé en lançant « → 409 duplicate key … ». Ce
  // qu'on peut affirmer sans connaître l'hôte, c'est la POSITION : ce qui suit la flèche est le
  // statut. Un slug, lui, vit dans le chemin — avant elle. C'est ce qui distingue ce repli du
  // défaut qu'il remplace : « 409 » n'importe où, contre « 409 » là où le statut se trouve.
  return /→\s*409\b/.test(String((erreur && erreur.message) || ""));
}

// ⚠️ « CETTE FONCTION N'EXISTE PAS ICI » VIT AVEC « CE CONFLIT EST UN CONFLIT », ET PAS AILLEURS.
// Elle habitait `presentations.js`, où elle était née ; deux autres modules en ont désormais besoin
// pour replier sur un chemin en mémoire quand une migration n'a pas été appliquée. La recopier
// aurait donné deux définitions d'un même fait — exactement ce que ce fichier existe pour empêcher.
// `presentations.js` la ré-exporte : sa surface publique ne bouge pas.
/**
 * Cette erreur dit-elle « CETTE SIGNATURE N'EXISTE PAS », et rien d'autre ?
 *
 * ⚠️ C'EST LA QUESTION QUI MANQUAIT, ET SON ABSENCE RETIRAIT UNE PROTECTION. Le repli vers l'ancien
 * contrat se déclenchait sur N'IMPORTE QUELLE exception : un `ECONNRESET`, un 500, un délai dépassé
 * valaient « migration 0018 absente », et le processus restait dégradé — sans contrôle anti-usurpation
 * — jusqu'à son redémarrage. Une panne réseau d'une seconde désarmait une garde de sécurité sur une
 * base pourtant entièrement migrée.
 *
 * C'est la règle du jour appliquée au code de production : **un mécanisme qui ne peut pas mesurer doit
 * refuser de conclure, pas conclure par défaut.** Ici, ne pas savoir distinguer PGRST202 d'un timeout
 * ne rendait pas le repli prudent — il le rendait automatique.
 *
 * PostgREST rend `PGRST202` quand aucune fonction ne correspond au jeu d'arguments nommés. On accepte
 * les DEUX formes que nos contextes produisent (code analysé, ou message contenant le code / la phrase
 * de PostgREST) — et RIEN d'autre : un statut 404 seul ne suffit pas, il peut venir d'ailleurs.
 */
function signatureAbsente(erreur) {
  if (!erreur) return false;
  const code = erreur.details && (erreur.details.code || (erreur.details.error && erreur.details.error.code));
  if (code === "PGRST202") return true;
  // ⚠️ PAS DE `erreur &&` ICI : la garde de la première ligne l'a déjà tranché. Le garder ne
  // protégeait de rien et APPRENAIT AU LECTEUR QUE `erreur` PEUT ÊTRE NULLE À CET ENDROIT — ce qui
  // est faux. Un test qui ne peut pas échouer ne coûte pas un cycle, il coûte une lecture.
  const texte = String(erreur.message || "");
  return texte.includes("PGRST202") || /Could not find the function/i.test(texte);
}

module.exports = { estConflit, signatureAbsente };
