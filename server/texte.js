// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor 19/08/2026) — texte déplacé À L'IDENTIQUE, aucun changement
// de comportement. Reste à PLAT dans server/ : plusieurs gardes de forge ciblent server/*.js,
// un sous-dossier les viderait en silence (la garde qui énumère maigrit quand on range).

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * ⚠️ TOUTE DONNÉE SERVEUR QUI ENTRE DANS UN <script> PASSE PAR ICI — c'est une règle, pas une
 * commodité, et une garde d'essai la fait respecter.
 *
 * `JSON.stringify` seul ne suffit pas : le PARSEUR HTML lit la page avant JavaScript, et un
 * `</script>` DANS une chaîne JSON ferme l'élément pour lui — la suite du document devient du
 * balisage. La CSP à nonce bloque l'exécution du script injecté (il n'a pas le nonce), mais pas
 * la casse de la page : l'élément fermé trop tôt suffit à tout démonter. La protection vivait
 * éparpillée (`cfg.replace(/</g, …)` à l'interpolation, et six interpolations NUES à côté) —
 * appliquée à la sérialisation, elle ne peut plus être oubliée champ par champ.
 *
 * ⚠️ `undefined` LÈVE au lieu de devenir « undefined » dans la page : c'est une erreur de
 * programmation, pas une valeur — la convertir en douce la masquerait. U+2028/U+2029 : les
 * séparateurs Unicode, légaux en JSON et illégaux dans les littéraux JS d'anciens moteurs —
 * durcissement de compatibilité, pas une faille des navigateurs modernes.
 */
function jsonPourScript(valeur) {
  const json = JSON.stringify(valeur);
  if (json === undefined) throw new TypeError("valeur impossible à sérialiser dans un script");
  return json.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

module.exports = { esc, jsonPourScript };
