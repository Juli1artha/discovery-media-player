// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES PORTES PAR LESQUELLES UNE RÉPONSE QUITTE CE SERVEUR.
//
// ⚠️ POURQUOI UN MODULE, ET PAS UNE FONCTION DE PLUS DANS handler.js. `handler.js` charge les
// familles de routes ; si elles le rechargeaient pour y prendre une aide, le cycle serait fermé.
// Un module qui ne dépend de rien peut être requis par tout le monde — c'est la seule forme qui
// permet qu'il n'y ait QU'UNE définition.
//
// ⚠️ CE QUI A RENDU CE FICHIER NÉCESSAIRE, deux fois de suite.
//
//   1. LE TEXTE (audit CODEX 5.6, §3). Le `500` du bout de `/doc` posait un code et un corps et
//      RIEN d'autre : le seul corps de ce serveur qu'un navigateur avait le droit de deviner. La
//      règle existait pourtant depuis un mois — le premier scan ZAP baseline (règle 10019, 24/08)
//      avait fait naître `refuserEnTexte`. Elle n'avait tenu que là où elle était écrite : trois
//      autres réponses en texte lui avaient échappé.
//
//   2. LE JSON, trouvé en mesurant le premier. L'aide de réponse JSON était définie TREIZE fois,
//      à l'identique, sous quatre noms (`jp`, `jd`, `j`, `jv`), dans quatre fichiers de routes —
//      plus sept corps écrits à la main et cinq réponses inline ailleurs. Vingt endroits, et
//      AUCUN ne posait `nosniff`. Ce n'est pas vingt oublis : c'est ce qu'une recette recopiée
//      devient. La copie initiale était juste ; c'est la CORRECTION qui ne se propage pas.
//
// ⚠️ `nosniff` SUR DU JSON N'EST PAS DE LA SUPERSTITION. Sans lui, un navigateur garde le droit de
// requalifier un corps d'après ce qu'il contient plutôt que d'après ce qu'on annonce — et un
// contenu qui vient d'un tiers (le nom d'un document, un message de chat) voyage dans ces
// réponses. Ce dépôt écrit `nosniff` partout ailleurs depuis la 0.1.7 ; les routes API étaient le
// seul endroit où la règle s'arrêtait, parce qu'aucun scan ne les visite.

/**
 * Un corps en TEXTE, avec son type et l'interdiction de le deviner.
 *
 * ⚠️ ELLE DOIT SURVIVRE À UN EN-TÊTE DÉJÀ PARTI. Son premier appelant est le `catch` de `/doc`, et
 * une erreur peut y arriver APRÈS que la page ait commencé à s'écrire : `setHeader` jette alors
 * `ERR_HTTP_HEADERS_SENT`, dans le rattrapage lui-même, ce qui transforme une erreur signalée en
 * rejet non rattrapé. On ne peut plus rien poser à ce stade — le statut est parti — donc on ferme
 * le flux et on se tait, ce qui est exactement ce que le client verra de toute façon. Se taire ici
 * n'efface rien : l'erreur a déjà été confiée à `errors.capture`.
 */
function refuserEnTexte(res, statut, message) {
  if (res.headersSent) { try { res.end(); } catch { /* flux déjà clos */ } return; }
  res.statusCode = statut;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(message);
}

/**
 * Un corps JSON DÉJÀ SÉRIALISÉ, pour les rares appelants qui en tiennent un.
 *
 * ⚠️ DEUX ENTRÉES, UNE SEULE PORTE — et ce n'est pas la même chose que deux copies. L'état d'une
 * présentation est construit en amont sous forme de texte JSON et relu à chaque battement : le
 * ré-analyser pour le re-sérialiser serait un aller-retour pur sur un chemin chaud. Les en-têtes,
 * eux, ne sont posés qu'ici — c'est le fait qui ne doit exister qu'en un exemplaire.
 *
 * `entetes` couvre ce qui varie légitimement d'une réponse à l'autre : `Cache-Control: no-store`
 * sur un état vivant, `Retry-After` sur une saturation, `Set-Cookie` sur une entrée de visiteur.
 */
function repondreJsonTexte(res, statut, texte, entetes) {
  if (res.headersSent) { try { res.end(); } catch { /* flux déjà clos */ } return; }
  res.statusCode = statut;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [cle, valeur] of Object.entries(entetes || {})) if (valeur != null) res.setHeader(cle, valeur);
  res.end(texte);
}

/** Un corps JSON à sérialiser — la forme de très loin la plus courante. */
function repondreJson(res, statut, valeur, entetes) {
  repondreJsonTexte(res, statut, JSON.stringify(valeur), entetes);
}

/**
 * La porte JSON LIÉE à une réponse — ce que les familles de routes tiennent en main.
 *
 * ⚠️ C'EST CETTE FORME QUI REMPLACE LES TREIZE COPIES, et la nuance compte. Chaque famille gardait
 * une aide locale au nom court (`jp`, `jd`, `j`, `jv`) : la commodité était légitime, c'est la
 * RECETTE recopiée à l'intérieur qui ne l'était pas. Le nom court reste, en une ligne qui délègue ;
 * les en-têtes, eux, n'existent plus qu'en un exemplaire. Les 95 appels ne bougent pas — un
 * correctif qui réécrit 95 lignes pour en corriger 13 se relit mal et se vérifie encore moins bien.
 */
const jsonPour = (res) => (statut, valeur, entetes) => repondreJson(res, statut, valeur, entetes);

module.exports = { refuserEnTexte, repondreJson, repondreJsonTexte, jsonPour };
