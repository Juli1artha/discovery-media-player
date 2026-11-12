// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE GABARIT « LECTURE » (#595) — une barre fine et claire, UNE action pleine, la navigation dans une
// pastille flottante, le reste dans « ⋯ ». À CÔTÉ de l'ancienne barre, jamais à sa place : sans
// `?gabarit=lecture`, la page est servie à l'identique.
//
// ⚠️ CE QUI A ÉTÉ CONSTATÉ CHEZ UN HÔTE (11/11/2026) : treize commandes au même poids dans une barre
// noire, « Partager » en blanc comme seul repère quelle que soit l'intention, pivoter deux fois au
// premier rang, et le pied légal posé sur le bas de la page.
//
// ⚠️ LA MÊME MÉCANIQUE, D'AUTRES PLACES. Le script de la visionneuse retrouve ses boutons par leur id
// (zin, zout, rotL, rotR, vignBtn, fs, shareBtn, presentBtn, dlBtn, barMore, barMenu, pg…) et en lit
// certains SANS garde : un id manquant arrête la page entière. Chaque id existe donc ici aussi ; ce
// qui n'a pas sa place à l'écran attend dans une réserve masquée, et le menu « ⋯ » le déclenche par
// un clic relayé — exactement comme le menu de l'ancienne barre sous 860 px.

const { esc } = require("./texte");

/** Les actions du player qu'un hôte peut mettre en avant. Il les place et les renomme, il n'en invente pas.
 *  `contact` (#608) : écrire à l'expéditeur d'un lien tracé ouvert seul — voir `contactDuLien`. */
const ACTIONS = new Set(["contact", "share", "present", "download"]);
const LIBELLES = { contact: "Contacter l'expéditeur", share: "Partager", present: "Présenter", download: "Télécharger" };
const LIBELLES_MENU = { contact: "Contacter l'expéditeur", share: "Partager", present: "Présenter en direct", download: "Télécharger" };

// Une adresse qu'on peut mettre telle quelle dans un `mailto:` : ni espace, ni guillemet, ni chevron, ni `?`,
// `&` ou `#` qui ouvriraient d'autres paramètres. `created_by` est déjà mis en minuscules à la création.
const ADRESSE_SIMPLE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * L'ADRESSE À ÉCRIRE POUR « CONTACTER » (#608), ou `null` : l'action n'existe alors pas, ni en barre ni au menu.
 *
 * ⚠️ PAS SUR UN RE-PARTAGE. Un lien transféré porte en `created_by` l'adresse de CELUI QUI A TRANSFÉRÉ
 * (`createReshare` : `created_by: parent.recipient_email || …`) — un client, pas l'expéditeur d'origine.
 * « Contacter » lui écrirait, et donnerait son adresse au destinataire suivant.
 *
 * ⚠️ NI EN APERÇU (pas de lien), NI DANS UN CADRE : là, l'hôte a sa propre action, déclarée par `chrome`, et un
 * second « Contacter » dans « ⋯ » ferait doublon.
 */
function contactDuLien(share, { preview, embedded }) {
  if (!share || preview || embedded || share.parent_slug) return null;
  const a = String(share.created_by || "").trim();
  return ADRESSE_SIMPLE.test(a) ? a : null;
}

/** Le `mailto:` de « Contacter » : l'adresse, et le titre du document en objet. */
function mailtoContact(adresse, titre) {
  const objet = String(titre || "").replace(/\s+/g, " ").trim().slice(0, 140);
  return `mailto:${adresse}${objet ? `?subject=${encodeURIComponent(objet)}` : ""}`;
}

/** Un libellé est accepté entier ou pas du tout : tronquer le ferait mentir sur ce que fait le bouton. */
function libelle(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : "";
}

/**
 * Les réglages du gabarit, lus dans l'adresse. Réglages d'AFFICHAGE : ils n'ouvrent aucun droit (une
 * action interdite par le lien reste absente, où qu'on la place). `null` = l'ancienne barre.
 */
function reglagesLecture(q) {
  if (String((q && q.gabarit) || "") !== "lecture") return null;
  const primary = ACTIONS.has(q.primary) ? q.primary : "share";
  const secondary = ACTIONS.has(q.secondary) && q.secondary !== primary ? q.secondary : "";
  return {
    primary,
    secondary,
    primaryLabel: libelle(q.primaryLabel, 40),
    secondaryLabel: libelle(q.secondaryLabel, 40),
    subtitle: libelle(q.subtitle, 80),
  };
}

const ID_ELEMENT = { contact: "contactBtn", share: "shareBtn", present: "presentBtn", download: "dlBtn" };

/**
 * Les actions du player DISPONIBLES ici, avec leur place et leur libellé d'ouverture. Une seule source
 * pour le balisage du serveur et pour la page, qui y revient quand l'hôte retire sa déclaration
 * (`chrome` sans `actions`, #596). ⚠️ Une action indisponible n'y figure pas : rien ne pourra la placer.
 */
function actionsDeLecture(r, { preview, allowDownload, contact = null }) {
  const dispo = { contact: !!contact, share: true, present: !!preview, download: allowDownload !== false };
  return ["contact", "share", "present", "download"].filter((a) => dispo[a]).map((a) => {
    const place = a === r.primary ? "primary" : a === r.secondary ? "secondary" : "menu";
    const label = (a === r.primary && r.primaryLabel) || (a === r.secondary && r.secondaryLabel) || LIBELLES[a];
    return { id: a, label: place === "menu" ? LIBELLES_MENU[a] : label, place };
  });
}

const SVG = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  retour: SVG('<path d="M15 6l-6 6 6 6"/>', 2.2),
  prec: SVG('<path d="M15 6l-6 6 6 6"/>', 2.2),
  suiv: SVG('<path d="M9 6l6 6-6 6"/>', 2.2),
  pages: SVG('<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  plus: SVG('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>'),
  rotL: SVG('<path d="M3 8h11a5 5 0 0 1 5 5v1M3 8l4-4M3 8l4 4"/>'),
  rotR: SVG('<path d="M21 8H10a5 5 0 0 0-5 5v1M21 8l-4-4M21 8l-4 4"/>'),
  fs: SVG('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
};

/**
 * La barre, la pastille, le menu et la réserve.
 * @param {object} o
 * @param {object} o.reglages   sortie de `reglagesLecture`
 * @param {boolean} o.preview   aperçu interne (Présenter n'existe qu'ici)
 * @param {boolean} o.embed     lien tracé encadré (croix de l'hôte)
 * @param {string} o.title      titre DÉJÀ échappé
 * @param {string} o.fileUrl    adresse du fichier (Télécharger)
 * @param {boolean} o.allowDownload
 * @param {boolean} o.isTest
 * @param {string} o.liveBar    boutons de présence et de discussion (aperçu)
 * @param {string} o.legalHtml  le pied légal (`legalFooter`)
 * @param {boolean} o.tracked   lien tracé : « Lecture mesurée » doit rester VISIBLE
 * @param {string|null} [o.contactHref]  le `mailto:` de « Contacter » (#608), ou `null` : l'action n'existe pas
 */
function barreLecture(o) {
  const r = o.reglages;
  const element = (a, cls, label) => {
    const t = esc(label);
    if (a === "download") return `<a class="${cls}" id=dlBtn href="${o.fileUrl}" download>${t}</a>`;
    if (a === "contact") return `<a class="${cls}" id=contactBtn href="${esc(o.contactHref)}">${t}</a>`;
    if (a === "present") return `<button type=button class="${cls}" id=presentBtn title="Présenter en direct (lien public, page synchronisée)">${t}</button>`;
    return `<button type=button class="${cls}" id=shareBtn>${t}</button>`;
  };
  const enBarre = [], enReserve = [], auMenu = [];
  // ⚠️ une action que le lien interdit n'existe pas — ni en barre, ni au menu (actionsDeLecture l'a écartée)
  for (const a of actionsDeLecture(r, { preview: o.preview, allowDownload: o.allowDownload, contact: o.contactHref || null })) {
    if (a.place === "primary") enBarre.unshift(element(a.id, "gbtn gprim", a.label));
    else if (a.place === "secondary") { enBarre.push(element(a.id, "gbtn gsec", a.label)); auMenu.push(`<button type=button class="g-act g-mob" data-t=${ID_ELEMENT[a.id]}>${esc(a.label)}</button>`); }
    else { enReserve.push(element(a.id, "dl", LIBELLES[a.id])); auMenu.push(`<button type=button class=g-act data-t=${ID_ELEMENT[a.id]}>${esc(a.label)}</button>`); }
  }
  const retour = o.preview
    ? `<button type=button class=ic id=closeBtn title="Fermer" aria-label="Fermer">${I.retour}</button>`
    : o.embed ? `<button type=button class="ic barx" id=embedCloseBtn title="Fermer" aria-label="Fermer">${I.retour}</button>` : "";
  // Le sous-titre et la rangée d'onglets existent toujours, vides s'il le faut : l'hôte peut les remplir
  // ensuite par `chrome` (#596), sans que la page ait à inventer leur place.
  const sousTitre = `<span class=gsub id=gSub${r.subtitle ? "" : " hidden"}>${esc(r.subtitle)}</span>`;
  // ⚠️ « LECTURE MESURÉE » RESTE À L'ÉCRAN SANS GESTE, sur un lien tracé : c'est la mention due au
  // lecteur (cf. gabarit-legal.js). Elle monte dans la barre — qui, elle, ne s'efface jamais. En aperçu
  // interne (« Informations »), rien n'est mesuré chez un tiers : elle rejoint le menu.
  const legalEnBarre = o.tracked ? o.legalHtml : "";
  const legalAuMenu = o.tracked ? "" : o.legalHtml;
  return `<div class="bar gbar">${retour}<div class=gtitre><b>${o.title}</b>${sousTitre}</div><div class=gtabs id=gTabs role=tablist aria-label="Documents" hidden></div>${o.isTest ? '<span class=testchip>🎭 Répétition — session de test</span>' : ""}${legalEnBarre}<span class=sp></span>${o.liveBar || ""}<span class=gslots id=gSlots>${enBarre.join("")}</span><button type=button class="ic barMore" id=barMore title="Plus d'actions" aria-label="Plus d'actions" aria-haspopup=menu>${I.plus}</button><div class=gprog aria-hidden=true><i id=gProg></i></div></div>
  <div class="barmenu gmenu" id=barMenu role=menu>${auMenu.join("")}<button type=button data-t=rotL>Pivoter à gauche</button><button type=button data-t=rotR>Pivoter à droite</button><button type=button data-t=fs>Plein écran</button>${legalAuMenu ? `<div class=gapropos>${legalAuMenu}</div>` : ""}</div>
  <div class=gcache hidden>${enReserve.join("")}<button type=button class=ic id=rotL title="Pivoter à gauche" aria-label="Pivoter le document à gauche">${I.rotL}</button><button type=button class=ic id=rotR title="Pivoter à droite" aria-label="Pivoter le document à droite">${I.rotR}</button><button type=button class=ic id=fs title="Plein écran">${I.fs}</button></div>
  <div class=gpill id=gPill role=toolbar aria-label="Navigation dans le document"><button type=button class=ic id=vignBtn title="Toutes les pages" aria-label="Afficher toutes les pages" aria-pressed=false>${I.pages}</button><span class=gsep></span><button type=button class=ic id=pillPrev title="Page précédente" aria-label="Page précédente">${I.prec}</button><button type=button class=pg id=pg title="Aller à une page" aria-label="Aller à une page"></button><button type=button class=ic id=pillNext title="Page suivante" aria-label="Page suivante">${I.suiv}</button><span class=gsep></span><button type=button class=gfit id=fitBtn aria-pressed=false>Page entière</button><span class=zoom><button type=button id=zout title="Dézoomer" aria-label="Dézoomer">−</button><span id=zlbl>100%</span><button type=button id=zin title="Zoomer" aria-label="Zoomer">+</button></span></div>`;
}

// Encre : #1b1d22 sur blanc = 16,9:1 ; #5d6470 sur blanc = 6,0:1 ; sur #f1f3f6 = 5,4:1. Rien sous 4,5:1.
const LECTURE_CSS = `
  body.g-lecture{--bg:#e9ebef;--bar:#fff;color:#1b1d22}
  html:fullscreen body.g-lecture{--bg:#15171c}
  body.g-lecture .gbar{position:relative;gap:8px;min-height:56px;padding-top:calc(8px + env(safe-area-inset-top));padding-bottom:8px;border-bottom:1px solid #e3e6eb;color:#1b1d22}
  body.g-lecture .gbar .ic,body.g-lecture .gpill .ic{color:#1b1d22;border-color:transparent;border-radius:999px;width:34px;height:34px}
  body.g-lecture .gbar .ic svg,body.g-lecture .gpill .ic svg{width:18px;height:18px}
  body.g-lecture .gbar .ic:hover,body.g-lecture .gpill .ic:hover{background:#f1f3f6}
  body.g-lecture .gbar .ic:focus-visible,body.g-lecture .gpill button:focus-visible,body.g-lecture .gbtn:focus-visible{outline:2px solid #1b1d22;outline-offset:2px}
  body.g-lecture .gbar .ic:disabled,body.g-lecture .gpill .ic:disabled{opacity:.35;cursor:default;background:transparent}
  .gtitre{display:flex;flex-direction:column;min-width:0;line-height:1.25}
  .gtitre b{font-size:15px;font-weight:700;color:#1b1d22;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
  .gsub{font-size:12px;color:#5d6470;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
  .gbtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:650;border-radius:999px;padding:7px 15px;cursor:pointer;white-space:nowrap;text-decoration:none;flex:none}
  .gprim{background:#1b1d22;color:#fff;border:1px solid #1b1d22}
  .gprim:hover{background:#33363d}
  .gsec{background:transparent;color:#1b1d22;border:1px solid #c9ced8}
  .gsec:hover{background:#f1f3f6}
  .gslots{display:inline-flex;align-items:center;gap:8px}
  /* LES ONGLETS DU DOSSIER (#596), déclarés par l'hôte : un clic ne change rien ici, il est RENVOYÉ
     (host-action) — seul l'hôte sait fabriquer le lien tracé de l'autre document. */
  .gtabs{display:flex;gap:2px;margin:0 auto;padding:3px;background:#f1f3f6;border-radius:999px;overflow-x:auto;scrollbar-width:none;max-width:44vw;flex:none}
  .gtabs[hidden]{display:none}
  .gtab{font:inherit;font-size:12.5px;font-weight:600;color:#5d6470;background:transparent;border:0;border-radius:999px;padding:5px 12px;cursor:pointer;white-space:nowrap}
  .gtab:hover{color:#1b1d22}
  .gtab.on{background:#fff;color:#1b1d22;box-shadow:0 1px 2px #0a0f2a24}
  .gtab:focus-visible{outline:2px solid #1b1d22;outline-offset:1px}
  .gprog{position:absolute;left:0;right:0;bottom:-1px;height:3px;background:#e3e6eb;pointer-events:none}
  .gprog i{display:block;height:100%;width:0;background:#1b1d22;transition:width .25s ease}
  .gpill{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:2px;padding:4px 6px;background:#fff;color:#1b1d22;border-radius:999px;box-shadow:0 6px 22px #0a0f2a2e,0 0 0 1px #0a0f2a0f;transition:opacity .2s ease;white-space:nowrap}
  .gsep{width:1px;height:18px;background:#e3e6eb;margin:0 4px}
  body.g-lecture .gpill .pg{color:#1b1d22;font-weight:650;font-variant-numeric:tabular-nums}
  body.g-lecture .gpill .pg:hover{background:#f1f3f6;color:#1b1d22}
  body.g-lecture .gpill .pg:focus-visible{outline:2px solid #1b1d22}
  body.g-lecture .gpill .pgin{color:#1b1d22;background:#fff;border-color:#c9ced8}
  .gfit{font:inherit;font-size:12.5px;font-weight:600;color:#1b1d22;background:#f1f3f6;border:0;border-radius:999px;padding:5px 11px;cursor:pointer}
  .gfit:hover{background:#e6e9ee}
  body.g-lecture .gpill .zoom{display:inline-flex;align-items:center;gap:0}
  body.g-lecture .gpill .zoom button{width:30px;height:30px;border:0;border-radius:999px;color:#1b1d22;background:transparent;font-size:17px;cursor:pointer}
  body.g-lecture .gpill .zoom button:hover{background:#f1f3f6}
  /* Le pourcentage quitte l'écran (#595) mais reste lu par un lecteur d'écran : « 160 % » ne dit rien
     à qui veut seulement voir la page entière. */
  body.g-lecture #zlbl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  body.g-lecture:not(.multi) #pillPrev,body.g-lecture:not(.multi) #pillNext,body.g-lecture:not(.multi) .gpill .gsep:first-of-type{display:none}
  /* LES COMMANDES S'EFFACENT, LA BARRE NON. Effacer la barre décalerait le document (elle est dans le
     flux) et forcerait une reconstruction des pages à chaque geste ; et sur un lien tracé elle porte
     « Lecture mesurée », qui doit rester visible. Seules la pastille et les flèches flottantes partent. */
  body.g-lecture.g-off .gpill,body.g-lecture.g-off .navp{opacity:0;pointer-events:none}
  body.g-lecture .navp{background:#fff;color:#1b1d22;box-shadow:0 2px 10px #0a0f2a2e;transition:opacity .2s ease}
  body.g-lecture .navp:hover{background:#f1f3f6}
  body.g-lecture .navp:focus-visible{outline:2px solid #1b1d22}
  body.g-lecture .barMore{display:inline-flex}
  body.g-lecture .gmenu{top:62px;right:12px}
  body.g-lecture .gmenu .g-mob{display:none}
  body.g-lecture .gapropos{border-top:1px solid #e3e6eb;margin-top:4px;padding:6px 6px 2px}
  /* Le pied légal, dans la barre (lien tracé) ou dans le menu (aperçu) : plus jamais posé sur la page. */
  body.g-lecture .gbar .lgl,body.g-lecture .gapropos .lgl{position:relative;left:auto;bottom:auto;z-index:auto}
  body.g-lecture .gbar .lgl-pill,body.g-lecture .gapropos .lgl-pill{background:#f1f3f6;color:#1b1d22}
  body.g-lecture .gbar .lgl-pill:hover,body.g-lecture .gbar .lgl[open] .lgl-pill{background:#e6e9ee}
  body.g-lecture .gbar .lgl-panel{position:absolute;top:calc(100% + 6px);left:0;width:min(320px,80vw);background:#fff;color:#1b1d22;box-shadow:0 18px 54px #0a0f2a40;z-index:46}
  body.g-lecture .gapropos .lgl-panel{background:#f1f3f6;color:#1b1d22}
  body.g-lecture .gbar .lgl a:hover,body.g-lecture .gapropos .lgl a:hover{color:#1b1d22}
  body.g-lecture .vign{background:#fff;border-right-color:#e3e6eb}
  body.g-lecture .vg{background:#f1f3f6}
  body.g-lecture .vg:hover{border-color:#c9ced8}
  body.g-lecture .vg.on{border-color:#1b1d22;box-shadow:none}
  body.g-lecture .vg:focus-visible{outline-color:#1b1d22}
  /* L'ancienne barre range ses boutons dans « ⋯ » sous 860 px, PAR LEUR ID. Ces ids vivent ici dans
     la pastille et dans la barre : sans cette reprise, la règle les cacherait, et la pastille perdrait
     ses vignettes et la barre son bouton plein. */
  /* ⚠️ PAR ID, PAS PAR CLASSE : la règle de l'ancienne barre vise #shareBtn, #presentBtn, #dlBtn, et un id
     l'emporte sur toute pile de classes. La première version disait « .gbar .gbtn » — le bouton plein
     disparaissait sous 860 px, vu dans Chrome sur un écran de 375 px le 11/11. */
  @media (max-width:860px){
    body.g-lecture #vignBtn{display:inline-flex}
    body.g-lecture .gbar .gbtn#shareBtn,body.g-lecture .gbar .gbtn#presentBtn,body.g-lecture .gbar .gbtn#dlBtn{display:inline-flex}
  }
  @media (max-width:640px){
    body.g-lecture .gbar{flex-wrap:wrap}
    .gtabs{order:9;width:100%;max-width:none;margin:2px 0 0}
    body.g-lecture .gbar .gsec#shareBtn,body.g-lecture .gbar .gsec#presentBtn,body.g-lecture .gbar .gsec#dlBtn{display:none}
    body.g-lecture .gmenu .g-mob{display:block}
    body.g-lecture .gmenu{top:auto;left:0;right:0;bottom:0;border-radius:16px 16px 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
    body.g-lecture .gmenu button{padding:13px 14px;font-size:15px}
    .gtitre b,.gsub{max-width:40vw}
  }
  @media (max-width:520px){ body.g-lecture .gbar>.gtitre{display:flex} }
  @media (prefers-reduced-motion:reduce){ .gpill,body.g-lecture .navp,.gprog i{transition:none} }
`;

module.exports = { reglagesLecture, barreLecture, actionsDeLecture, contactDuLien, mailtoContact, LECTURE_CSS };
