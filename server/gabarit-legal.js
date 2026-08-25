// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 2, 19/08/2026) — texte déplacé À L'IDENTIQUE. Reste à
// PLAT dans server/ (les gardes de forge ciblent server/*.js).
const { esc } = require("./texte");

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

// ⚠️ UNE MENTION DONT L'OBJET EST D'ÊTRE EXACTE NE DOIT PAS INVENTER UN EXPÉDITEUR.
//
// Le texte par défaut disait « transmise à son expéditeur ». Vrai pour un lien nominatif, faux
// pour un lien que PERSONNE n'a envoyé — la plaquette publique d'un programme, ouverte depuis une
// carte par un visiteur qui n'a reçu aucun message. Le défaut est antérieur au mode serveur à
// serveur ; c'est lui qui l'a rendu visible, puisqu'il crée précisément des liens sans
// destinataire NI créateur.
//
// La distinction ne demande aucune donnée nouvelle : c'est déjà la clé d'idempotence de ces
// liens-là. Signalé par le second hôte en regardant son propre écran — ce qu'aucun test ne fait.
function legalFooter({ tracked, sansExpediteur }) {
  const L = PLAYER.legal;
  const liens = [
    L.legalUrl ? `<a href="${esc(L.legalUrl)}" target=_blank rel=noreferrer>Mentions légales</a>` : "",
    L.privacyUrl ? `<a href="${esc(L.privacyUrl)}" target=_blank rel=noreferrer>Confidentialité</a>` : "",
    // Obligation AGPL : l'accès au source se propose à qui UTILISE le logiciel, pas seulement à qui le distribue.
    L.sourceUrl ? `<a href="${esc(L.sourceUrl)}" target=_blank rel=noreferrer>Code source</a>` : "",
  ].filter(Boolean).join("<span class=lgl-sep>·</span>");
  // Un contexte qui ne fournit pas le second texte retombe sur le premier : rien ne casse chez un
  // hôte qui n'a pas encore de liens sans expéditeur.
  const texte = sansExpediteur ? (L.trackingNoticeAnonymous || L.trackingNotice) : L.trackingNotice;
  const mesure = tracked ? `<span class=lgl-note>${esc(texte)}</span>` : "";
  if (!liens && !mesure) return "";
  return `<div class=lgl>${mesure}${liens ? `<span class=lgl-links>${liens}</span>` : ""}</div>`;
}

const LEGAL_CSS = `
  .lgl{position:fixed;left:0;right:0;bottom:0;z-index:5;display:flex;flex-wrap:wrap;gap:4px 10px;
    align-items:center;justify-content:center;padding:5px 12px;font-size:10.5px;line-height:1.35;
    color:rgba(255,255,255,.94);background:rgba(0,0,0,.66);backdrop-filter:blur(3px);pointer-events:none}
  .lgl a{color:inherit;text-decoration:underline;text-underline-offset:2px;pointer-events:auto}
  .lgl a:hover{color:#fff}
  .lgl-sep{margin:0 6px;opacity:.8}
  .lgl-note{opacity:1}
  @media (max-width:640px){ .lgl{font-size:10px;padding:4px 10px} }
`;

module.exports = { init, legalFooter, LEGAL_CSS };
