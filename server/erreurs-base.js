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

module.exports = { estConflit };
