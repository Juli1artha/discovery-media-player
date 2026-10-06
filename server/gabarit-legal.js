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
  // ⚠️ UNE PASTILLE REPLIÉE, PLUS UNE BARRE (06/10/2026, à la demande d'un hôte). La barre noire
  // pleine largeur recouvrait le bas de chaque page pour redire trois choses qu'on ne lit qu'une
  // fois. Repliée, la pastille garde VISIBLE ce qui doit l'être sans geste — « Lecture mesurée »,
  // le résumé de la mention due au lecteur — et la phrase exacte comme les liens (le code source
  // que l'AGPL doit à l'utilisateur) restent dans la page, à un clic. Rien n'est retiré du HTML :
  // seule la présentation change.
  //
  // ⚠️ `<details>`, SANS SCRIPT : la page tourne sous une CSP à nonce, et un pied qui aurait besoin
  // de JavaScript pour s'ouvrir resterait fermé — mention comprise — le jour où son script ne
  // passerait pas.
  //
  // ⚠️ « Informations » quand on ne mesure pas (aperçu interne) : écrire « Lecture mesurée » sur
  // une page qui ne mesure rien serait faux dans l'autre sens.
  const resume = tracked ? "Lecture mesurée" : "Informations";
  return `<details class=lgl><summary class=lgl-pill>${ICONE_INFO}<span>${resume}</span></summary>`
    + `<div class=lgl-panel>${mesure}${liens ? `<span class=lgl-links>${liens}</span>` : ""}</div></details>`;
}

// Un « i » cerclé, décoratif : le mot à côté suffit à un lecteur d'écran.
const ICONE_INFO = `<svg aria-hidden=true viewBox="0 0 24 24" width=13 height=13 fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><circle cx=12 cy=12 r=9.5 /><path d="M12 11v5.5M12 7.6v.1"/></svg>`;

const LEGAL_CSS = `
  /* ⚠️ EN BAS À GAUCHE, PAS À DROITE : le coin droit est déjà pris par la bulle de l'assistant,
     celle du chat en direct et « Propulsé par » — trois occupants qu'une pastille de plus
     viendrait chevaucher. Au-dessus des pages (z-index 5), sous le tiroir de vignettes (7). */
  .lgl{position:fixed;left:calc(10px + env(safe-area-inset-left));bottom:calc(10px + env(safe-area-inset-bottom));
    z-index:5;max-width:min(92vw,420px);font-size:11px;line-height:1.4;color:rgba(255,255,255,.94)}
  /* La colonne de vignettes, ouverte en grand écran, pousse le document : la pastille la suit
     au lieu de se poser sur la dernière vignette. */
  @media (min-width:861px){ body.vign-on .lgl{left:calc(178px + env(safe-area-inset-left))} }
  .lgl-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 9px 4px 7px;border-radius:999px;
    background:rgba(20,18,14,.74);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    cursor:pointer;list-style:none;user-select:none}
  /* ⚠️ DISCRÈTE PAR LA TAILLE, JAMAIS PAR L'OPACITÉ : la pastille flotte sur la page du
     document, souvent blanche, et un texte atténué y passerait sous le contraste exigé. Le fond
     à .74 garde le blanc à ~7:1 même sur une page blanche. */
  .lgl-pill::-webkit-details-marker{display:none}
  .lgl-pill:hover,.lgl[open] .lgl-pill{background:rgba(20,18,14,.88)}
  .lgl-pill:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .lgl-panel{display:flex;flex-direction:column;gap:5px;margin-top:6px;padding:9px 11px;border-radius:10px;
    background:rgba(20,18,14,.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  .lgl a{color:inherit;text-decoration:underline;text-underline-offset:2px}
  .lgl a:hover{color:#fff}
  .lgl-sep{margin:0 6px;opacity:.8}
  @media (max-width:640px){ .lgl{font-size:10.5px} }
`;

module.exports = { init, legalFooter, LEGAL_CSS };
