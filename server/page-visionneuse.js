// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 2, 19/08/2026) — texte déplacé À L'IDENTIQUE. Reste à
// PLAT dans server/ (les gardes de forge ciblent server/*.js).
const { esc, jsonPourScript } = require("./texte");
const { PDFJS, PDFJS_WORKER, TIERS, balise } = require("./tiers");
const { LIVE_CSS, LIVE_BAR, LIVE_PANEL, LIVE_JS } = require("./gabarit-live");
const { MAP_CSS, MAP_MARKUP, MAP_JS } = require("./gabarit-carte");
const { BOT_CSS, ICONS, botMarkup } = require("./gabarit-agent");
const { legalFooter, LEGAL_CSS } = require("./gabarit-legal");
const { cleSessionHote, CLE_SESSION_PLAYER, CLE_INVITE } = require("./session-cles");

// Le cœur navigateur (bundle committé) et les GREFFONS de l'hôte — résolus depuis le contexte,
// exactement comme handler.init le faisait : chaque usage reste gardé, le player continue sans eux.
const { PLAYER_BROWSER_JS } = require("./browser.generated.js");
let PLAYER = null, docbot = null, brandIntroRuntime = null, botBrowser = null;
const init = (ctx) => {
  PLAYER = ctx;
  docbot = ctx.plugins.bot;
  brandIntroRuntime = ctx.plugins.brandIntro && ctx.plugins.brandIntro.brandIntroRuntime;
  botBrowser = ctx.plugins.botBrowser;
};

/**
 * ⚠️ LE VISITEUR EST VENU SOUS UNE MARQUE ; C'EST CELLE-LÀ QU'IL DOIT LIRE.
 *
 * Le titre ajoutait le nom de l'INSTANCE — celui de la société qui exploite l'outil. Vrai tant
 * qu'une instance ne sert qu'un public ; faux dès qu'elle en sert deux, et le visiteur d'une
 * marque cliente voit alors le nom d'une société qui ne le concerne pas.
 *
 * Aucune configuration nouvelle : la marque du lien est DÉJÀ résolue (`brandForShare`, la même
 * qui habille le loader) et posée sur `share.brand_name` avant qu'on arrive ici. Le titre ne la
 * consultait simplement pas.
 *
 * Le « propulsé par » reste celui de l'instance, lui, et c'est délibéré : dire qui opère l'outil
 * est une information honnête, pas une trahison de marque.
 */
function titreOnglet(share) {
  const base = share.doc_title || share.file_name || "Document";
  const marque = String((share && share.brand_name) || "").trim();
  return marque ? `${base} — ${marque}` : PLAYER.branding.title(base);
}

function viewerHtml(share, nonce, logoUrl, pitch) {
  const title = esc(share.doc_title || share.file_name || "Document");
  // Aperçu interne : slug vide (= pas de tracking, pas de bouton de re-partage) + stream depuis le bucket public.
  const preview = !!share.preview;
  // Assistant IA : greffon PRÉSENT côté serveur ET activé sur ce lien. Sans le greffon, la colonne
  // `bot_enabled` restait vraie en base → on injectait le style, le balisage et 116 Ko de script
  // d'un assistant qui n'aurait jamais répondu.
  const botOn = !preview && !!share.bot_enabled && !!docbot && !!botBrowser;
  // INTÉGRÉ (?embed=1) : la visionneuse est en surimpression dans une page hôte de MÊME
  // ORIGINE (le plan d'un lot dans une expérience 3D). L'hôte n'a alors plus besoin de sa
  // propre barre de titre : celle-ci porte la croix, et la sortie remonte en postMessage.
  // ⚠️ DEUX QUESTIONS DIFFÉRENTES, QU'UNE SEULE VARIABLE CONFONDAIT.
  //
  // `embed` décide de l'HABILLAGE : la visionneuse porte sa propre croix, et l'hôte retire sa
  // barre de titre. L'aperçu a déjà la sienne (`closeBtn`, à droite) — lever la condition
  // afficherait donc DEUX croix. Le `!preview` n'était pas arbitraire.
  //
  // `embedded` répond à l'autre question : cette page est-elle SERVIE dans un cadre ? C'est elle
  // qui commande la poignée de main. Le serveur le sait déjà — il en tire les `frame-ancestors`
  // de la réponse — mais le navigateur ne l'apprenait qu'en aperçu de lien tracé.
  //
  // ⚠️ Conséquence signalée par le second hôte, et c'est exactement la panne que le contrat
  // décrit : `embed-ready` n'était jamais émis en aperçu, donc l'hôte recevait un SILENCE. Or le
  // silence couvre deux cas opposés — instance absente, ou player vivant. Leur guetteur de
  // démarrage a conclu « injoignable » et remplacé un player qui fonctionnait par la visionneuse
  // du navigateur, six secondes après l'ouverture, sous les yeux du lecteur. Et l'aperçu est
  // précisément le mode qu'un hôte utilise pour SES documents.
  //
  // La page était pourtant encadrable et parlait déjà (`share`, `close` en postMessage) : il ne
  // lui manquait que de dire qu'elle était là.
  const embed = !preview && !!share.embed;
  const embedded = !!share.embed;
  const fileUrl = preview ? share.stream_url : `/api/doc?slug=${encodeURIComponent(share.slug)}&file=1`;
  // Logo de MARQUE du loader : celui du promoteur (brand_logo, ex. MJ
  // Développement) s'il est renseigné, avec la mention de l'éditeur dessous (si configurée)
  // dessous ; SINON l'intro animée de la marque (api/_brand-intro.js), qui
  // remplace l'ancien wordmark statique (et son grand vide sans logo).
  const brandLogo = esc(share.brand_logo || "");
  const brandDark = !!share.brand_dark; // fond sombre du loader (logo clair/blanc)
  // Texte de remplacement de l'image : ce que le lecteur voit si le logo ne charge pas. C'est
  // TOUT l'intérêt de `name` — un logo cassé laisse sinon un vide à la place d'une marque.
  const brandName = esc(share.brand_name || "");
  // En aperçu interne, on embarque de quoi démarrer une présentation live (URL Storage brute + métadonnées).
  // `fileName` : c'est LUI qui dit la nature du document côté page. L'URL publique est
  // `/api/doc?slug=…&file=1`, sans extension — sans ce champ, une image partait dans pdf.js.
  const cfg = jsonPourScript({ brand: PLAYER.branding.name, slug: preview ? "" : share.slug, fileUrl, fileName: share.file_name || "", pdfjs: PDFJS, pdfjsWorker: PDFJS_WORKER, title, preview, embed, embedded, bot: botOn, botGuided: !preview && !!share.bot_enabled && share.bot_guided !== false, botAv: (!preview && share.bot_enabled && share.bot_avatar) || "", botName: (!preview && share.bot_enabled && share.bot_name) || "", botGreet: (!preview && share.bot_enabled && share.bot_greeting) || "", botGreetDoc: (!preview && share.bot_enabled && share.bot_greeting_doc) || "", dl: share.allow_download !== false, autoPresent: !!share.auto_present, botAnim: share.bot_page_anim !== false, botVoice: !preview && !!share.bot_enabled && !!process.env.ELEVENLABS_API_KEY, vIcOn: ICONS.sound, vIcOff: ICONS.mute, kStyle: (!preview && share.bot_enabled && share.bot_karaoke) || "classic", vLayout: (!preview && share.bot_enabled && share.video_layout) || "", vClips: !preview && !!share.bot_vclips, botVAv: (!preview && share.bot_enabled && share.bot_vphoto) || "", resumeSlug: preview ? (share.resume_slug || "") : "", supaUrl: preview ? (share.supa_url || "") : "", supaKey: preview ? (share.supa_key || "") : "", internal: preview && share.internal_email ? { email: share.internal_email, name: share.presenter_name || "", docId: share.doc_id || "", it: share.internal_token || "" } : null, present: preview ? { url: share.raw_url || "", name: share.file_name || "", title: share.doc_title || "", docId: share.doc_id || "", by: share.presenter_name || "", email: share.internal_email || "", av: share.presenter_avatar || "" } : null });
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=3,viewport-fit=cover,interactive-widget=resizes-content">
<meta name=robots content="noindex,nofollow">
<link rel=icon href="data:,">
<title>${esc(titreOnglet(share))}</title>
<style>
  :root{--bg:#33312e;--bar:#26241f}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{background:var(--bg);font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#eee;display:flex;flex-direction:column}
  .bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bar);border-bottom:1px solid #0003;flex:none}
  /* Header façon PLAYER VIDÉO : il FLOTTE en verre dépoli PAR-DESSUS le document (qui occupe l'écran
     jusqu'en haut) et s'escamote en 1,5 s — aucun espace réservé pour un élément visible 5 % du temps. */
  body.deskcap .bar,body.deskaudio .bar{position:fixed;top:0;left:0;right:0;z-index:34;transition:transform .32s,opacity .32s;background:rgba(20,18,14,.52);backdrop-filter:blur(14px) saturate(1.1);-webkit-backdrop-filter:blur(14px) saturate(1.1);border-bottom-color:#ffffff14}
  body.light.deskcap .bar,body.light.deskaudio .bar{background:rgba(247,245,241,.6);border-bottom-color:#00000012}
  body.barhide .bar{transform:translateY(-100%);opacity:0;pointer-events:none}
  body.deskcap.onepage #pages,body.deskaudio.onepage #pages{padding-top:12px} /* le doc monte jusqu'en haut — le header passe DESSUS */
  body.deskpresent #fs{display:none} /* plein écran BLOQUÉ pendant la présentation guidée (le fit est piloté) */
  /* Ligne de PROGRESSION (2px, tout en haut, au-dessus du header) : le repère silencieux des players
     vidéo — le prospect sait où il en est sans chercher « Page x/y » dans un header escamoté. */
  .pgline{display:none;position:fixed;top:0;left:0;right:0;height:2px;z-index:36;background:rgba(255,255,255,.16)}
  body.deskpresent .pgline{display:block}
  .pgline i{display:block;height:100%;width:0;background:#fff;opacity:.85;transition:width .5s ease}
  body.light .pgline{background:rgba(0,0,0,.14)}
  body.light .pgline i{background:#15130f;opacity:.8}
  @media(max-width:820px){.pgline{display:none !important} body.botplayer .pgline{display:block !important;z-index:44}}
  /* viewport-fit=cover : la barre ne passe pas sous l'encoche / la barre d'état (env()=0 ailleurs). */
  .bar{padding-top:calc(10px + env(safe-area-inset-top));padding-left:max(16px,env(safe-area-inset-left));padding-right:max(16px,env(safe-area-inset-right))}
  .bar b{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .testchip{flex:none;font-size:11px;font-weight:800;letter-spacing:.03em;color:#15130f;background:#ffd66b;border-radius:999px;padding:3px 10px;white-space:nowrap}
  .bar .sp{flex:1}
  .pg{font-size:12.5px;color:#bbb;white-space:nowrap}
  .zoom{display:flex;align-items:center;gap:6px}
  .zoom button{width:27px;height:27px;border:1px solid #fff3;background:transparent;color:#fff;border-radius:7px;cursor:pointer;font-size:16px;line-height:0}
  .zoom button:hover{background:#fff2}
  .zoom span{font-size:12px;color:#bbb;min-width:40px;text-align:center}
  .dl{color:#fff;text-decoration:none;font:inherit;font-size:12.5px;border:1px solid #fff3;border-radius:8px;padding:6px 11px;background:transparent;cursor:pointer}
  .dl:hover{background:#fff2}
  .dl.primary{background:#fff;color:#1a1a1a;border-color:#fff;font-weight:600}
  .dl.primary:hover{filter:brightness(.93)}
  .ic{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #fff3;background:transparent;color:#fff;border-radius:8px;cursor:pointer;padding:0;font-size:15px;line-height:0}
  .ic:hover{background:#fff2}
  .ic svg{width:16px;height:16px;display:block}
  /* Croix du mode INTÉGRÉ : elle OUVRE la barre, à gauche du titre — la place où l'œil
     cherche une sortie. Sans bordure : c'est une sortie, pas une action de plus. Elle
     reste visible sous 520px, où le titre s'efface (.bar>b{display:none}). */
  .barx{border-color:transparent;margin-right:-4px;flex:none}
  .scroll{flex:1;overflow:auto;position:relative;touch-action:pan-x pan-y} /* ⚠️ pan-x pan-y, PAS auto : le navigateur garde le défilement et NOUS rendons le pincement. Sans cette ligne le geste à deux doigts est happé par le zoom de page avant qu'aucun événement de pointeur ne nous parvienne. Le zoom navigateur reste disponible SUR LE RESTE de l'interface — le retirer partout serait une régression d'accessibilité pour qui grossit le chrome, pas le document. */
  #pages{display:flex;flex-direction:column;align-items:center;gap:16px;width:max-content;min-width:100%;margin:0 auto;padding:22px 14px}
  .page{position:relative;background:#fff;box-shadow:0 6px 22px #0006;border-radius:3px}
  .page canvas{display:block;border-radius:3px}
  /* Couche texte pdf.js : invisible, superposée au canvas → sélection du texte possible (requiert --scale-factor). */
  .textLayer{position:absolute;inset:0;overflow:hidden;line-height:1;opacity:1;z-index:2;forced-color-adjust:none}
  .textLayer span,.textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0}
  .textLayer ::selection{background:rgba(60,120,255,.4)}
  .ph{display:grid;place-items:center;color:#999;font-size:12px}
${LEGAL_CSS}
  /* Loader (moderne) : couvre la zone, logo + barre de progression réelle, puis fondu. */
  #load{position:absolute;inset:0;background:#fff;display:flex;align-items:center;justify-content:center;z-index:6;transition:opacity .4s ease}
  #load.hide{opacity:0;pointer-events:none}
  .lbox{display:flex;flex-direction:column;align-items:center;gap:20px}
  .lbox img{height:40px;animation:lpulse 1.6s ease-in-out infinite}
  .lbox img.lbrand{height:56px;max-width:220px;object-fit:contain;margin-bottom:-12px}
  .lpowered{font-size:10.5px;color:#a8a29a;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
  #load.ldark{background:#15130f}
  #load.ldark .lpowered{color:#8a857c}
  #load.ldark .lpct{color:#9c968c}
  #load.ldark .lbar{background:#2a2620}
  .lword{font-weight:800;font-size:23px;color:#15130f;letter-spacing:-.02em;animation:lpulse 1.6s ease-in-out infinite}
  /* Intro animée de la marque (sans logo promoteur) : elle occupe tout le cadre — le vol a
     toute la largeur, la marque atterrit au centre — et la barre passe en bas. Le wordmark
     statique reste dedans comme repli (JS indisponible) ; createBrandIntro le remplace. */
  .lintro{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
  #load.has-intro .lbox{position:absolute;left:0;right:0;bottom:13%;gap:12px}
  #load.ldark .lword{color:#fff}
  @keyframes lpulse{0%,100%{opacity:.5}50%{opacity:1}}
  .lbar{position:relative;width:200px;height:4px;background:#ececec;border-radius:999px;overflow:hidden}
  .lbar i{position:absolute;left:0;top:0;height:100%;width:10%;background:linear-gradient(90deg,#15130f,#6b6457);border-radius:999px;transition:width .25s ease}
  /* balayage « tech » tant qu'on ne connaît pas encore le total */
  .lbar.idle i{width:36%;animation:lsweep 1.1s ease-in-out infinite}
  @keyframes lsweep{0%{left:-36%}100%{left:100%}}
  .lpct{font-size:11px;color:#6e695f;letter-spacing:.04em;text-transform:uppercase;font-weight:600}
  .lerr{color:#c0392b;font-size:13px}
  /* Filigrane discret (libère la barre du bas) — masqué sur mobile (chevauche le FAB/teaser, sans valeur). */
  .brand{position:fixed;right:13px;bottom:10px;font-size:10px;color:#fff;opacity:.42;pointer-events:none;letter-spacing:.02em;z-index:3}
  @media (max-width:820px){ .brand{display:none} }
  /* Popover de partage (forward) */
  .pop{position:fixed;top:52px;right:14px;width:308px;background:#fff;color:#1c1c1c;border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.4);padding:15px;z-index:20;display:none}
  .pop.open{display:block}
  .pop h4{margin:0 0 3px;font-size:14px}
  .pop .h{margin:0 0 11px;font-size:11.5px;color:#777;line-height:1.4}
  .pop input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #e4e0d9;border-radius:9px;font:inherit;font-size:13px;margin-bottom:8px;color:#1c1c1c}
  .pop .pbtn{width:100%;padding:9px;border:0;border-radius:9px;background:#111;color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .pop .pbtn:disabled{opacity:.5}
  .pop .pbtn2{width:100%;padding:8px;margin-top:7px;border:1px solid #e4e0d9;border-radius:9px;background:#fff;color:#555;font:inherit;font-size:12.5px;cursor:pointer}
  .pop .pbtn2:hover{background:#f6f4ef}
  .pop .msg{font-size:12.5px;color:#1f9254;font-weight:600;margin:0 0 8px}
  .pop .res{display:none;margin-top:11px}
  .pop .res.on{display:block}
  .prow{display:flex;gap:6px;margin-top:2px}
  .prow a,.prow button{flex:1;text-align:center;text-decoration:none;padding:8px;border-radius:9px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid #e4e0d9;color:#1c1c1c;background:#f6f4ef}
  .pop .err{color:#c0392b;font-size:12px;margin:0 0 8px;display:none}
  .plive{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#0a7d34;background:#e8f6ed;border-radius:9px;padding:9px 11px;margin:0 0 10px}
  .pdot{width:9px;height:9px;border-radius:50%;background:#15b85a;flex:none;animation:pdb 1.4s infinite}
  @keyframes pdb{0%{box-shadow:0 0 0 0 rgba(21,184,90,.5)}70%{box-shadow:0 0 0 7px rgba(21,184,90,0)}100%{box-shadow:0 0 0 0 rgba(21,184,90,0)}}
  /* Bandeau « présentation en direct » : fixe, persistant, en bas (ne gêne pas la barre). */
  .pbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:9px;max-width:94vw;padding:8px 9px 8px 15px;background:#fff;color:#1c1c1c;border-radius:999px;box-shadow:0 14px 46px rgba(0,0,0,.5)}
  .pbar-live{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#e5384d;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;border:0;background:transparent;cursor:pointer;font-family:inherit;padding:4px 2px}
  .pbar-live i{width:9px;height:9px;border-radius:50%;background:#ff3b3b;animation:blink 1.4s infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
  .pbar-chev{font-size:9px;opacity:.5;transition:transform .2s}
  .pbar.min .pbar-chev{transform:rotate(180deg)}
  .pbar.min{padding:6px 14px}
  .pbar.min>#pbarLink,.pbar.min>#pbarCopy,.pbar.min>#pbarSwitch,.pbar.min>#pbarMap,.pbar.min>#pbarInvite,.pbar.min>#pbarHandover,.pbar.min>#pbarEnd{display:none}
  .pbar-link{border:1px solid #e4e0d9;border-radius:8px;padding:6px 9px;font:inherit;font-size:12px;color:#555;width:240px;max-width:32vw;background:#f8f6f2}
  .pbar-btn{border:1px solid #e4e0d9;background:#f6f4ef;color:#1c1c1c;border-radius:8px;padding:7px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pbar-btn:hover{background:#eceae5}
  .pbar-err{display:none;color:#b3261e;font-size:12px;font-weight:600;max-width:260px;line-height:1.25}
  .pbar-err.on{display:inline-block}
  #pbarEnd{color:#c0392b}
  /* Barre d'outils responsive : sous 860px, zoom/plein écran/Présenter/Partager/Télécharger passent dans le
     menu « ⋯ » ; le titre se tronque puis disparaît. */
  .bar>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:40vw}
  .barMore{display:none;font-size:19px}
  .barmenu{position:fixed;top:52px;right:12px;min-width:190px;background:#fff;color:#1c1c1c;border-radius:12px;box-shadow:0 18px 54px rgba(0,0,0,.4);padding:6px;z-index:45;display:none}
  .barmenu.open{display:block}
  .barmenu button{display:block;width:100%;text-align:left;border:0;background:transparent;font:inherit;font-size:13.5px;color:#1c1c1c;padding:9px 12px;border-radius:8px;cursor:pointer}
  .barmenu button:hover{background:#f2efe9}
  @media (max-width:860px){
    .bar .zoom,#rotL,#rotR,#vignBtn,#fs,#presentBtn,#shareBtn,#dlBtn{display:none}
    .barMore{display:inline-flex}
  }
  @media (max-width:520px){ .bar>b{display:none} }
  /* Structure doc+colonne : TOUJOURS émise — un lien sans bot ni live n'avait ni LIVE_CSS ni BOT_CSS
     → .lrow/.lmain sans flex, la fenêtre scrollait à la place du conteneur et le rendu paresseux mourait. */
  .lrow{flex:1;display:flex;min-height:0;position:relative}
  .lmain{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
    /* PANNEAU DE VIGNETTES. Largeur POSÉE D'UN COUP, sans transition : la reconstruction du
       document mesure scrollEl.clientWidth juste après la bascule, et une largeur en cours
       d'animation lui ferait calculer des pages à une taille qui n'existe qu'un dixième de
       seconde. Le confort d'un glissement coûterait une mesure fausse. */
    .vign{flex:0 0 auto;width:0;overflow:hidden;background:#0000004d;border-right:1px solid #ffffff14}
    body.vign-on .vign{width:168px}
    .vign-in{width:168px;height:100%;overflow-y:auto;overflow-x:hidden;padding:12px 0 24px;display:flex;flex-direction:column;align-items:center;gap:10px;scrollbar-width:thin}
    .vg{position:relative;width:132px;flex:0 0 auto;padding:0;border:2px solid transparent;border-radius:4px;background:#ffffff10;cursor:pointer;overflow:hidden}
    .vg canvas{display:block;width:100%;height:100%}
    .vg:hover{border-color:#ffffff4d}
    .vg.on{border-color:#fff;box-shadow:0 0 0 1px #0008}
    .vg-n{position:absolute;right:3px;bottom:3px;padding:0 5px;border-radius:3px;background:#000a;color:#fff;font-size:11px;line-height:16px;pointer-events:none}
    .vg:focus-visible{outline:2px solid #fff;outline-offset:1px}
    /* Sous le point de rupture de la barre : TIROIR qui recouvre, pas colonne qui pousse — une
       colonne de 168 px sur un écran de 380 px ne laisserait pas de document à lire. */
    @media(max-width:860px){ body.vign-on .vign{position:absolute;left:0;top:0;bottom:0;z-index:7;box-shadow:0 0 24px #000a} }
  ${preview ? LIVE_CSS : ""}
  ${preview ? MAP_CSS : ""}
  ${botOn ? BOT_CSS : ""}
</style></head>
<body>
  <div class=bar>${embed ? '<button class="ic barx" id=embedCloseBtn title=Fermer aria-label=Fermer><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ""}<b>${title}</b>${share.is_test ? '<span class=testchip>\ud83c\udfad Répétition — session de test</span>' : ""}<span class=sp></span><span class=pg id=pg></span>
    ${preview ? LIVE_BAR : ""}
    <div class=zoom><button id=zout title="Dézoomer">−</button><span id=zlbl>100%</span><button id=zin title="Zoomer">+</button></div>
    <button class=ic id=rotL title="Pivoter à gauche" aria-label="Pivoter le document à gauche"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a5 5 0 0 1 5 5v1M3 8l4-4M3 8l4 4"/></svg></button>
    <button class=ic id=rotR title="Pivoter à droite" aria-label="Pivoter le document à droite"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8H10a5 5 0 0 0-5 5v1M21 8l-4-4M21 8l-4 4"/></svg></button>
    <button class=ic id=vignBtn title="Vignettes" aria-label="Afficher les vignettes" aria-pressed=false><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="7" rx="1"/><rect x="3" y="13" width="6" height="7" rx="1"/><path d="M13 6h8M13 12h8M13 18h8"/></svg></button>
    <button class=ic id=fs title="Plein écran"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
    ${preview ? '<button class=dl id=presentBtn title="Présenter en direct (lien public, page synchronisée)">Présenter</button>' : ''}
    <button class="dl primary" id=shareBtn>Partager</button>
    ${share.allow_download === false ? "" : `<a class=dl id=dlBtn href="${fileUrl}" download>Télécharger</a>`}<button class="ic barMore" id=barMore title="Plus d'actions">⋯</button>${preview ? '<button class=ic id=closeBtn title="Fermer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ''}</div>
  <div class=barmenu id=barMenu>
    <button data-t=zin>Zoom avant</button>
    <button data-t=zout>Zoom arrière</button>
    <button data-t=rotL>Pivoter à gauche</button>
    <button data-t=rotR>Pivoter à droite</button>
    <button data-t=vignBtn>Vignettes</button>
    <button data-t=fs>Plein écran</button>
    ${preview ? '<button data-t=presentBtn>Présenter en direct</button>' : ''}
    <button data-t=shareBtn>Partager</button>
    ${share.allow_download === false ? "" : "<button data-t=dlBtn>Télécharger</button>"}
  </div>
  ${preview ? `<div class=pbar id=pbar style="display:none">
    <button class=pbar-live id=pbarToggle title="Replier / déplier"><i></i> En direct <span class=pbar-chev>▾</span></button>
    <input class=pbar-link id=pbarLink readonly>
    <button class=pbar-btn id=pbarCopy>Copier</button>
    <button class=pbar-btn id=pbarSwitch>Changer de document</button>
    <button class=pbar-btn id=pbarMap>Afficher une carte</button>
    <button class=pbar-btn id=pbarInvite>Inviter l'équipe</button>
    <button class=pbar-btn id=pbarHandover>Passer la main</button>
    <button class=pbar-btn id=pbarEnd>Terminer</button>
    <span class=pbar-err id=pbarErr role=alert></span>
  </div>` : ""}
  <div class=pop id=pop>
    <h4>Transmettre le document</h4>
    <p class=h>Envoyez-le à un contact par email — il recevra un lien dédié, à votre nom.</p>
    <p class=err id=shErr></p>
    <input id=shEmail type=email placeholder="email du destinataire" autocomplete=off>
    <input id=shName placeholder="nom (facultatif)" autocomplete=off>
    <button class=pbtn id=shSend>Envoyer le document</button>
    <button class=pbtn2 id=shSelf>Envoyer depuis ma messagerie</button>
    <div class=res id=shRes>
      <div class=msg id=shMsg></div>
      <input id=shLink readonly>
      <div class=prow><button id=shCopy>Copier le lien</button><a id=shMail style="display:none">Ouvrir l'email</a></div>
    </div>
  </div>
  <div class=lrow>
    <div class=vign id=vign aria-hidden=true><div class=vign-in id=vignIn role=list aria-label="Vignettes des pages"></div></div>
    <div class=lmain>
      <div class=scroll id=scroll tabindex=0 role=region aria-label="Document">
        <div id=pages></div>
        <div id=load class="${brandDark ? "ldark" : ""}${brandLogo ? "" : " has-intro"}">${brandLogo || !PLAYER.branding.loaderName ? "" : `<div class=lintro id=lintro data-theme="${brandDark ? "dark" : "light"}"><div class=lword>${esc(PLAYER.branding.loaderName)}</div></div>`}<div class=lbox>${brandLogo ? `<img class=lbrand src="${brandLogo}" alt="${brandName}">${PLAYER.branding.poweredBy ? `<div class=lpowered>Powered by ${esc(PLAYER.branding.poweredBy)}</div>` : ""}` : ""}<div class="lbar idle" id=lbar><i id=lbarFill></i></div><div class=lpct id=lpct>Chargement…</div></div></div>
      </div>
      ${share.bot_enabled ? `<button class="op-arrow op-prev" id=opPrev title="Page précédente" aria-label="Page précédente">${ICONS.prev}</button><button class="op-arrow op-next" id=opNext title="Page suivante" aria-label="Page suivante">${ICONS.next}</button><div class=dcap id=dcap><span class=dcap-av>${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : esc(String(share.bot_name || "◆").trim().charAt(0).toUpperCase())}</span><div class=dcap-body><div id=dcapT></div></div></div><div class=dkov id=dkov><div class=dkov-card><button class=dkov-big id=dkovBig aria-label="Reprendre la présentation">${ICONS.play}</button><div class=dkov-opts id=dkovOpts></div></div></div><div class=rateov id=rateov><div class=rate-card role=dialog aria-modal=true aria-label="Votre avis sur la présentation"><button class=rate-x id=rateX aria-label=Fermer>${ICONS.close}</button><b>Votre avis compte</b><p>Comment avez-vous trouvé cette présentation ?</p><div class=rate-stars id=rateStars></div><span class=rate-thx>Merci pour votre retour \ud83d\ude4f</span></div></div><div class=qov id=qov><div class=qov-card id=qovCard></div></div><div class=byeov id=byeov><div class=bye-card><span class=bye-av>${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : esc(String(share.bot_name || "◆").trim().charAt(0).toUpperCase())}</span><b id=byeT>Merci !</b><p id=byeS>Et à très bientôt</p></div></div><div class=pgline id=pgline><i id=pglineF></i></div>` : ""}
      ${preview ? MAP_MARKUP : ""}
    </div>
    ${preview ? LIVE_PANEL : ""}
    ${botOn ? botMarkup(share, pitch) : ""}
  </div>
  ${PLAYER.branding.poweredBy ? `<div class=brand>Propulsé par ${esc(PLAYER.branding.poweredBy)}</div>` : ""}
  ${legalFooter({ tracked: !preview && !!share.slug, sansExpediteur: !share.recipient_email && !share.created_by })}
  ${brandLogo || !brandIntroRuntime ? "" : `<script nonce="${nonce}">(${brandIntroRuntime.toString()})();</script>`}
  <script nonce="${nonce}">${PLAYER_BROWSER_JS}</script>
  ${preview ? `${balise(nonce, TIERS.supa)}
  <script nonce="${nonce}">var LIVECFG=${jsonPourScript({ supaUrl: share.supa_url || "", supaKey: share.supa_key || "", hostAuthKey: cleSessionHote(), liveAuthKey: CLE_SESSION_PLAYER, guestKey: CLE_INVITE })};var GMAPS_KEY=${jsonPourScript((PLAYER.config && PLAYER.config.mapsKey) || "")};${LIVE_JS}
  ${MAP_JS}</script>` : ""}
  <script nonce="${nonce}">
  (function(){
    var CFG=${cfg};
    var cur=0, numPages=0;
    // Nature du document : le nom de fichier fait foi (le type MIME n'est pas toujours
    // renvoyé par le stockage). Une image = une page, sans pdf.js.
    var IS_IMG=Player.viewer.isImageDocument(CFG.fileName,CFG.fileUrl);
    var imgSrc='';
    var scrollEl=document.getElementById('scroll'), pagesEl=document.getElementById('pages'), vignIn=document.getElementById('vignIn');
    // Suivi de lecture (temps réel à l'écran par page, page la plus loin atteinte, session) :
    // player/src/tracking.ts — typé et testé, y compris la séparation prospect / aperçu interne.
    var T=Player.tracking.createTracker({ slug:CFG.slug||'', internal:CFG.internal||null, scrollElement:scrollEl });
    // POIGNÉE DE VISIONNEUSE : le contrat offert aux greffons — et la seule chose qu'ils
    // connaissent du lecteur. Les fonctions et éléments sont STABLES ; la page courante, le nombre
    // de pages, le document et le mode une-page sont des ACCESSEURS (ils changent pendant la
    // lecture, les figer donnerait un assistant qui commente la mauvaise page).
    var VIEWER={cfg:CFG,scrollEl:scrollEl,pagesEl:pagesEl,isLand:isLand,showPage:showPage,
      enterOnePage:enterOnePage,exitOnePage:exitOnePage,build:build,scrollToPage:scrollToPage,
      vsplitTint:vsplitTint,
      get cur(){return cur;},get numPages(){return numPages;},get pdfDoc(){return pdfDoc;},
      get onePage(){return onePage;},
      get soloOffered(){return soloOffered;},set soloOffered(v){soloOffered=!!v;}};
    var pdfDoc=null, zoom=1, rot=0, firstAspect=1.35, rendered={}, io=null, ioCur=null;
    // ATTENTION : LE LECTEUR GARDAIT TOUTES LES PAGES RENDUES (P1 audit externe).
    //
    // rendered[n] n etait jamais evince, les canvas restaient dans le DOM, et un build() de refit
    // n annulait pas les taches deja lancees. Sur un ecran haute densite un seul canvas pese
    // plusieurs dizaines de mega-octets : un document long parcouru en entier faisait exploser la
    // memoire de l onglet. rendered[n] etait aussi pose AVANT le succes — un echec laissait donc la
    // page definitivement consideree comme rendue, sans nouvelle tentative possible.
    //
    // Note de forme : ce script vit dans un litteral de gabarit — pas d accent grave ici.
    var renderGen=0;          // invalide les callbacks d un build() precedent
    var taches={};            // n -> RenderTask, pour pouvoir ANNULER
    var enCours={};           // n -> 1 tant que la page n a pas abouti
    var MARGE_PAGES=2;        // on garde la page courante et deux de chaque cote
    // ATTENTION : UNE GENERATION PAR PAGE. La generation globale (renderGen) ne bouge qu au build ;
    // une page liberee PENDANT que son rendu ou sa couche texte est en vol gardait donc la meme
    // generation, et le resultat tardif se posait sur une page remise en reserve. On incremente
    // donc a chaque liberation, et chaque callback verifie SA page.
    var genPage=Object.create(null);
    var DPR_MAX=2;            // au-dela, le gain visuel est nul et le cout quadratique
    var PIXELS_MAX=4e6;       // plafond par canvas : ~4 M pixels = ~16 Mo de tampon
    var onePage=false, soloOffered=false; // mode « une seule page » (présentation guidée) + offre de découverte solo
    function setCur(p){ if(!p||p===cur)return; cur=p; try{ evincerLoin(p); }catch(e){} T.setPage(p); try{ vignMarquer(p); }catch(e){} try{ if(window.__soloEnd)window.__soloEnd(p); }catch(e){} var pg=document.getElementById('pg'); if(pg&&numPages)pg.textContent='Page '+p+' / '+numPages; if(PRES) pushPage(); }
    // Bouton « Partager » : re-partage tracé (forward) → crée un lien ENFANT et propose de l'envoyer par email.
    function wireShare(){
      var pop=document.getElementById('pop'), btn=document.getElementById('shareBtn'), err=document.getElementById('shErr');
      btn.addEventListener('click',function(e){ e.stopPropagation(); pop.classList.toggle('open'); });
      pop.addEventListener('click',function(e){ e.stopPropagation(); });
      document.addEventListener('click',function(){ pop.classList.remove('open'); });
      function doReshare(send,b){
        var em=document.getElementById('shEmail').value.trim(), nm=document.getElementById('shName').value.trim();
        err.style.display='none';
        if(!/.+@.+[.].+/.test(em)){ err.textContent='Indiquez un email valide.'; err.style.display='block'; return; }
        var old=b.textContent; b.disabled=true; b.textContent='…';
        fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reshare',slug:CFG.slug,email:em,name:nm,send:send})})
          .then(function(r){return r.json();}).then(function(d){
            b.disabled=false; b.textContent=old;
            if(!d||!d.ok||!d.slug){ err.textContent=(d&&d.message)||"Impossible de créer le lien."; err.style.display='block'; return; }
            var url=location.origin+'/doc/'+d.slug;
            document.getElementById('shLink').value=url;
            var mailA=document.getElementById('shMail');
            mailA.href='mailto:'+encodeURIComponent(em)+'?subject='+encodeURIComponent(CFG.title+(CFG.brand?' — '+CFG.brand:''))+'&body='+encodeURIComponent('Bonjour,\\n\\nVoici le document : '+url+'\\n\\nBien à vous,');
            var msg=document.getElementById('shMsg');
            if(send&&d.sent){ msg.textContent='✓ Document envoyé à '+em+'.'; mailA.style.display='none'; }
            else if(send){ msg.textContent='Lien créé (envoi auto indisponible).'; mailA.style.display=''; }
            else { msg.textContent='Lien créé.'; mailA.style.display=''; }
            document.getElementById('shRes').classList.add('on');
          }).catch(function(){ b.disabled=false; b.textContent=old; err.textContent='Erreur réseau.'; err.style.display='block'; });
      }
      document.getElementById('shSend').addEventListener('click',function(){ doReshare(true,this); });
      document.getElementById('shSelf').addEventListener('click',function(){ doReshare(false,this); });
      document.getElementById('shCopy').addEventListener('click',function(){ var i=document.getElementById('shLink'); i.select(); var b=this; try{ navigator.clipboard.writeText(i.value); b.textContent='Copié !'; setTimeout(function(){b.textContent='Copier le lien';},1500); }catch(e){} });
    }
    // Plein écran (depuis l'iframe → nécessite allow="fullscreen" côté hôte).
    var _fs=document.getElementById('fs');
    if(_fs) _fs.addEventListener('click',function(){ try{ if(document.fullscreenElement){document.exitFullscreen();} else if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen();} }catch(e){} });
    document.addEventListener('fullscreenchange',function(){ if(window.__refit)setTimeout(window.__refit,120); }); // la page suit la nouvelle taille (hors présentation, où #fs est masqué)
    // Menu « ⋯ » (barre responsive) : les items relaient un clic sur les VRAIS boutons de la barre (masqués sur mobile).
    var _bm=document.getElementById('barMore'), _bmenu=document.getElementById('barMenu');
    if(_bm&&_bmenu){
      _bm.addEventListener('click',function(e){ e.stopPropagation(); _bmenu.classList.toggle('open'); });
      _bmenu.addEventListener('click',function(e){ e.stopPropagation(); });
      document.addEventListener('click',function(){ _bmenu.classList.remove('open'); });
      var mb=_bmenu.querySelectorAll('button'); for(var i=0;i<mb.length;i++){ mb[i].addEventListener('click',function(){ var el=document.getElementById(this.getAttribute('data-t')); _bmenu.classList.remove('open'); if(el) el.click(); }); }
    }
    // Présentation live — GÉRÉE DANS L'IFRAME (toujours servie fraîche, en-tête no-store) → robuste même si le
    // bundle React de l'app est en cache. Bandeau fixe persistant en bas : lien + copier + inviter + terminer.
    // Seul l'envoi par chat (Inviter) est délégué à l'app (postMessage) car il exige le JWT.
    var PRES=null, _hbIv=0;
    // JWT de la session app (MÊME ORIGINE, localStorage) → autorise le rattachement de la présentation au membre
    // (reprise / liste / transfert) et les actions authentifiées (reclaim).
    function appToken(){ try{ var raw=localStorage.getItem(LIVECFG.hostAuthKey||''); if(!raw)return''; var s=JSON.parse(raw); var t=(s&&(s.access_token||(s.currentSession&&s.currentSession.access_token)||(s.session&&s.session.access_token)))||''; return t; }catch(e){ return ''; } }
    function ctlKey(slug){ return '3dd-pres-ctl-'+slug; }
    function saveCtl(slug,control){ try{ localStorage.setItem(ctlKey(slug),control); }catch(e){} }
    function clearCtl(slug){ try{ localStorage.removeItem(ctlKey(slug)); }catch(e){} }
    // Heartbeat : signale que la présentation est vivante (sinon marquée « orpheline » côté serveur au bout de 3 min).
    function startHb(){ clearInterval(_hbIv); _hbIv=setInterval(function(){ if(!PRES){ clearInterval(_hbIv); return; } fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-touch',slug:PRES.slug,control:PRES.control})}).catch(function(){}); },30000); }
    function showBar(slug){ var lk=document.getElementById('pbarLink'); if(lk) lk.value=location.origin+'/present/'+slug; var pb=document.getElementById('pbar'); if(pb) pb.style.display='flex'; }
    // Le présentateur DIFFUSE l'état qu'il vient de persister. La base reste la vérité (les
    // arrivants tardifs la relisent) ; la diffusion évite à l'audience de lire la table.
    // ⚠️ ÉCRIRE, PUIS SIGNALER — ET PAS L'INVERSE.
    //
    // Le signal partait AVANT l'écriture. L'audience relisait donc l'état pendant que la base
    // portait encore l'ancien, et aucun second signal n'était garanti : la page tournée se perdait
    // jusqu'au filet de resynchronisation. Le commentaire d'origine affirmait pourtant l'ordre
    // inverse — il décrivait l'intention, pas le code.
    //
    // Depuis 0.1.19 le signal ne sert qu'à dire « relis » : le retarder d'un aller-retour ne coûte
    // rien, alors que l'émettre trop tôt fait relire pour rien ET perdre le changement.
    // (audit P0-3)
    function diffuserEtat(){ if(!PRES||!window.Live)return; try{ Live.sendState(); }catch(e){} }
    // ⚠️ UNE SEULE FILE, ET CE SONT LES FONCTIONS D'ÉCRITURE QUI L'EMPRUNTENT — PAS LEURS APPELANTS.
    //
    // Six chemins écrivaient : « pushPage », « showMap », « hideMap », « toMap », la recherche Street
    // View, et les deux ordonnanceurs de carte. Deux étaient protégés. Le correctif de 0.1.41, qui
    // annonçait des écritures de carte séquentielles, n'en couvrait qu'un chemin sur trois.
    //
    // Demander à chaque appelant de passer par la bonne porte serait une LISTE : le prochain
    // l'oubliera, et rien ne le dira. On range donc la file DANS « pushPage » et « presentContent » :
    // il n'existe plus de chemin direct, donc plus rien à oublier.
    //
    // Le rythme minimum remplace les deux ordonnanceurs qu'elle absorbe — un déplacement de carte à
    // la souris produirait sinon une écriture par image.
    // ⚠️ LE RANG D'ÉCRITURE, ET POURQUOI IL VIT ICI. La file garantit une seule écriture en vol,
    // donc l'ordre des DÉPARTS. Elle ne peut rien sur une requête abandonnée par le délai maximal :
    // le navigateur cesse de l'attendre, il ne l'annule pas chez le serveur, et elle peut atterrir
    // après celle qui l'a remplacée. Le rang ferme ce dernier cas.
    //
    // Remis à zéro à chaque prise de pilotage — démarrage ou reprise — parce qu'un jeton de contrôle
    // neuf ouvre un nouveau domaine d'ordre côté serveur.
    var _seq=0;
    function prochainRang(){ return ++_seq; }
    var _file=null;
    function fileEcritures(){
      if(!_file&&window.Player&&Player.live&&Player.live.createFileEcritures){
        _file=Player.live.createFileEcritures({minMs:500});
      }
      return _file;
    }
    // ⚠️ L'ANTI-REBOND DE 250 ms A DISPARU, ET C'EST VOULU. Il repoussait l'échéance à chaque appel —
    // un défilement continu pouvait donc ne JAMAIS écrire. La file regroupe par genre sans jamais
    // repousser : la dernière page demandée part au prochain tour, et elle part.
    function pushPage(){ if(!PRES)return;
      var f=fileEcritures(); var page=cur||1;
      if(!f) return envoyerPage(page);
      return f.poser('page',function(){ return envoyerPage(cur||page); }); }
    function envoyerPage(page){ if(!PRES)return Promise.resolve();
      return Player.live.fetchBorne('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-page',slug:PRES.slug,control:PRES.control,page:page,seq:prochainRang()})})
        .then(function(r){ if(r&&r.ok)diffuserEtat(); })
        .catch(function(){}); }
    // ⚠️ TROIS GESTES, ET L'ORDRE ÉTAIT LE PIRE DES SIX. On signalait la fin, puis on COUPAIT LE
    // CANAL, puis on envoyait l'avis de fin. Le signal partait donc avant l'écriture (relecture sur
    // un état périmé), et la coupure avant l'envoi. L'audience pouvait ne jamais apprendre que la
    // présentation était terminée — jusqu'au filet, 25 s plus tard, ou jamais si elle s'était
    // rechargée entre-temps.
    //
    // sendBeacon ne s'attend pas, mais il rend la main une fois la requête MISE EN FILE : signaler
    // juste après, puis couper, respecte l'ordre autant que ce transport le permet.
    // FERMER UNE PRÉSENTATION EST UN ACTE, PAS UNE INTENTION.
    //
    // ⚠️ Cette fonction annonçait la fin avant de l'obtenir. « sendBeacon » ne rend AUCUNE réponse —
    // ni « enregistré » ni « refusé » — et pourtant l'interface se nettoyait, le jeton de contrôle
    // était effacé et le canal fermé dans la foulée. Si l'appel échouait, la présentation restait
    // VIVANTE pour l'audience pendant que le présentateur la croyait close ; et il n'avait même plus
    // de quoi la refermer, « clearCtl » ayant déjà jeté son jeton.
    //
    // ⚠️ Le beacon n'achetait rien ici : il sert à faire partir une requête pendant que la page
    // MEURT. Or le seul appelant était un bouton — on a tout le temps d'attendre. Il est désormais à
    // sa place, sur « pagehide », et là seulement.
    //
    // ⚠️ ET L'ORDRE COMPTE : l'audience ne relit l'état qu'APRÈS le 2xx. Diffuser avant, c'était lui
    // faire relire une présentation encore marquée active — elle rejouait donc l'ancien état.
    //
    // On n'efface donc rien tant que le serveur n'a pas confirmé : en cas d'échec le pilotage reste
    // entier et le présentateur peut réessayer. Une présentation vraiment abandonnée est rattrapée
    // par la péremption (STALE_MS, 3 min), qui existe exactement pour ce cas.
    //
    // Signalé par un audit externe.
    function endPresent(){
      if(!PRES) return Promise.resolve();
      var p=PRES, btn=document.getElementById('pbarEnd'), libelle=btn?btn.textContent:'';
      if(btn){ btn.disabled=true; btn.textContent='…'; }
      var errAvant=document.getElementById('pbarErr'); if(errAvant){ errAvant.classList.remove('on'); }
      return Player.live.fetchBorne('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,
          body:JSON.stringify({action:'present-end',slug:p.slug,control:p.control})})
        .then(function(r){ if(!r||!r.ok) throw new Error('present-end'); })
        .then(function(){
          // RELIRE, PAS REUTILISER : un second aller-retour, indépendant de l'écriture. Réserve
          // posée par le second hôte, et elle est juste — relire la réponse du PATCH ferait ce que
          // faisait le cache négatif : la mesure confirmerait ce que l'écriture CROIT avoir fait.
          // C'est le seul moyen de rendre observable la classe entière des succès silencieux, y
          // compris contre un futur serveur qui répondrait ok sans avoir écrit.
          return Player.live.fetchBorne('/api/doc?present='+encodeURIComponent(p.slug)+'&state=1')
            .then(function(r){ return r&&r.ok?r.json():null; })
            .catch(function(){ return null; });   // relecture INDISPONIBLE n'est pas « encore active »
        })
        .then(function(d){
          if(d&&d.state&&d.state.active){
            // Le serveur a dit oui, la base dit encore active : fin non prise, ou reprise ailleurs.
            // Dans les deux cas, fermer l'interface mentirait au présentateur.
            if(btn){ btn.disabled=false; btn.textContent=libelle||'Terminer'; }
            var err2=document.getElementById('pbarErr');
            if(err2){ err2.textContent='La présentation est ENCORE ACTIVE après la fin — reprise ailleurs, ou fin non prise. Réessayez.'; err2.classList.add('on'); }
            return;
          }
          PRES=null; clearInterval(_hbIv); clearCtl(p.slug);
          var pb=document.getElementById('pbar'); if(pb)pb.style.display='none';
          try{ if(window.Live){ Live.sendState(); Live.disconnect(); } }catch(e){}
        }, function(){
          // L'échec d'une clôture ne prive de rien qu'on regarde : son succès ne produit rien,
          // donc son échec non plus. La première version le disait dans un TITLE — un tooltip que
          // personne ne survole. Le second hôte a eu des présentations « actives » trois jours.
          if(btn){ btn.disabled=false; btn.textContent=libelle||'Terminer'; }
          var err=document.getElementById('pbarErr');
          if(err){ err.textContent='La présentation est TOUJOURS ACTIVE — la fin n’a pas été enregistrée. Réessayez.'; err.classList.add('on'); }
        });
    }
    // ⚠️ LE SEUL ENDROIT OÙ « sendBeacon » A UN SENS : la page s'en va, aucune réponse ne pourra être
    // lue, et une présentation laissée ouverte ferait suivre l'audience dans le vide jusqu'à la
    // péremption. On ne nettoie rien ici — la page disparaît de toute façon.
    window.addEventListener('pagehide',function(){
      if(!PRES) return;
      try{
        var b=JSON.stringify({action:'present-end',slug:PRES.slug,control:PRES.control});
        if(navigator.sendBeacon) navigator.sendBeacon('/api/doc',new Blob([b],{type:'application/json'}));
        else fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});
      }catch(e){}
    });
    // Transfert : je passe la main → je cesse de piloter SANS clôturer la présentation (le nouvel owner reprendra).
    function stopPilotingLocally(){ if(!PRES)return; var s=PRES.slug; PRES=null; clearInterval(_hbIv); clearCtl(s); var pb=document.getElementById('pbar'); if(pb)pb.style.display='none'; try{ if(window.Live) Live.disconnect(); }catch(e){} }
    function liveConnect(slug,control){ try{ if(window.Live){ var P=CFG.present||{}; Live.connect(slug,{name:P.by||'Présentateur',email:P.email||'',avatar:P.av||'',role:'presenter',member:true},control); } }catch(e){} }
    function startPresent(){
      if(PRES) return; var b=CFG.present; if(!b||!b.url) return;
      var btn=document.getElementById('presentBtn'); if(btn){ btn.disabled=true; btn.textContent='…'; }
      var h={'Content-Type':'application/json'}; var tk=appToken(); if(tk) h['Authorization']='Bearer '+tk;
      fetch('/api/doc',{method:'POST',headers:h,body:JSON.stringify({action:'present-start',fileUrl:b.url,fileName:b.name,docTitle:b.title,docId:b.docId,presenterName:b.by,presenterAvatar:b.av})})
        .then(function(r){return r.json();}).then(function(d){
          if(btn){ btn.disabled=false; btn.textContent='Présenter'; }
          if(!d||!d.ok||!d.slug) return;
          PRES={slug:d.slug,control:d.control}; saveCtl(d.slug,d.control); _seq=0;
          showBar(d.slug); liveConnect(d.slug,d.control); startHb(); pushPage();
        }).catch(function(){ if(btn){ btn.disabled=false; btn.textContent='Présenter'; } });
    }
    // Reprise : le membre propriétaire re-génère un control_token frais (via JWT) → reprend le pilotage, la
    // présentation reste la même (même slug/audience), et on saute à la page en cours.
    function resumePresent(slug){
      if(PRES||!slug) return;
      var h={'Content-Type':'application/json'}; var tk=appToken(); if(tk) h['Authorization']='Bearer '+tk;
      fetch('/api/doc',{method:'POST',headers:h,body:JSON.stringify({action:'present-reclaim',slug:slug})})
        .then(function(r){return r.json();}).then(function(d){
          if(!d||!d.ok||!d.control){ if(d&&d.status===403){ Player.bridge.sendToHost({type:'present-denied'}); } return; }
          PRES={slug:slug,control:d.control}; saveCtl(slug,d.control); _seq=0;
          showBar(slug); liveConnect(slug,d.control); startHb();
          var target=Math.max(1,d.page||1);
          var tries=0; (function jump(){ var el=(document.getElementById('pages')||document).querySelector('.page[data-p="'+target+'"]'); if(el){ el.scrollIntoView({block:'start'}); } else if(tries++<40){ setTimeout(jump,150); } })();
        }).catch(function(){});
    }
    // Carte live : persiste le contenu (present-content) → l'audience bascule/suit via Realtime.
    // On envoie le jeton de contrôle EN PLUS de la session : une présentation démarrée sans
    // session pilote sa carte comme elle tourne ses pages. Sans lui, l'appel repartait en 401,
    // avale par le .catch ci-dessous, et la carte ne suivait pas sans que rien ne le dise.
    // ⚠️ REND SA PROMESSE, ET CE N'EST PAS DÉCORATIF. L'ordonnanceur des écritures de carte
    // appelait fini() juste après l'appel, sans attendre : il croyait donc l'écriture terminée
    // alors qu'elle venait de PARTIR. Sa garantie « une seule en vol, la dernière gagne » ne
    // s'appliquait qu'à l'ordre des APPELS, pas à celui des écritures — plusieurs PATCH pouvaient
    // voler ensemble, et une position ancienne atterrir après une récente.
    function presentContent(content){ if(!PRES)return Promise.resolve();
      var f=fileEcritures(); if(!f) return envoyerContenu(content);
      return f.poser('content',function(){ return envoyerContenu(content); }); }
    function envoyerContenu(content){ if(!PRES)return Promise.resolve(); var h={'Content-Type':'application/json'}; var tk=appToken(); if(tk) h['Authorization']='Bearer '+tk;
      return Player.live.fetchBorne('/api/doc',{method:'POST',headers:h,body:JSON.stringify({action:'present-content',slug:PRES.slug,control:PRES.control,content:content})})
        .then(function(r){ if(r&&r.ok)diffuserEtat(); })
        .catch(function(){}); }
    function showMap(){ if(!PRES||!window.Map3DD)return; var wrap=document.getElementById('mapWrap'); if(wrap&&wrap.classList.contains('on')){ Map3DD.enter(null,true,presentContent); return; } var init=Player.presentation.initialMapContent(); presentContent(init); Map3DD.enter(init,true,presentContent); }
    function hideMap(){ if(!window.Map3DD)return; Map3DD.exit(); presentContent(null); }
    // Mode INTÉGRÉ : la page hôte délègue sa barre de titre à celle-ci. On lui dit
    // qu'on est là — sans cette poignée de main elle ne peut pas savoir si la croix
    // existe (visionneuse d'une version antérieure) et garde la sienne par sécurité.
    // Le format du fil, le targetOrigin et la validation vivent dans player/src/bridge.ts.
    if(CFG.embedded){
      Player.bridge.sendToHost({type:'embed-ready'});
      var _xb=document.getElementById('embedCloseBtn');
      if(_xb) _xb.addEventListener('click',function(){ Player.bridge.sendToHost({type:'close'}); });
      // Échap ferme aussi : dans une surimpression, c'est le geste attendu.
      document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ Player.bridge.sendToHost({type:'close'}); } });
    }
    if(CFG.preview){
      // « Partager » et « Fermer » délégués à l'app (postMessage). « Présenter » géré localement.
      var _sb=document.getElementById('shareBtn'); if(_sb) _sb.addEventListener('click',function(){ Player.bridge.sendToHost({type:'share'}); });
      // Fermer le viewer NE clôture PAS la présentation (elle reste reprenable via le panneau « Présentations
      // en direct »). Seul « Terminer » (pbarEnd) coupe la vue de l'audience. Sans reprise sous 3 min → auto-purge.
      var _cb=document.getElementById('closeBtn'); if(_cb) _cb.addEventListener('click',function(){ Player.bridge.sendToHost({type:'close'}); });
      var _pb=document.getElementById('presentBtn'); if(_pb) _pb.addEventListener('click',startPresent);
      var _co=document.getElementById('pbarCopy'); if(_co) _co.addEventListener('click',function(){ var l=document.getElementById('pbarLink'); try{ l.select(); }catch(e){} try{ navigator.clipboard.writeText(l.value); _co.textContent='Copié !'; setTimeout(function(){_co.textContent='Copier';},1400); }catch(e){} });
      var _iv=document.getElementById('pbarInvite'); if(_iv) _iv.addEventListener('click',function(){ if(PRES){ Player.bridge.sendToHost({type:'present-invite',slug:PRES.slug}); } });
      var _en=document.getElementById('pbarEnd'); if(_en) _en.addEventListener('click',endPresent);
      // Bandeau Présenter : repli manuel (clic « En direct ») + repli AUTO au scroll du document (s'il est déplié).
      var _pt=document.getElementById('pbarToggle'); if(_pt) _pt.addEventListener('click',function(e){ e.stopPropagation(); var pb=document.getElementById('pbar'); if(pb)pb.classList.toggle('min'); });
      if(scrollEl) scrollEl.addEventListener('scroll',function(){ var pb=document.getElementById('pbar'); if(pb&&pb.style.display!=='none'&&!pb.classList.contains('min')) pb.classList.add('min'); },{passive:true});
      // Passer la main : le bandeau demande à l'app d'ouvrir le sélecteur de membre (le transfert exige le JWT).
      var _ho=document.getElementById('pbarHandover'); if(_ho) _ho.addEventListener('click',function(){ if(PRES){ Player.bridge.sendToHost({type:'present-handover',slug:PRES.slug}); } });
      // Changer de document : l'app ouvre le sélecteur (bibliothèque Documents, réservé aux membres) sans couper la session.
      var _sw=document.getElementById('pbarSwitch'); if(_sw) _sw.addEventListener('click',function(){ if(PRES){ Player.bridge.sendToHost({type:'present-switch',slug:PRES.slug}); } });
      // Carte live : afficher une carte (recherche + pan/zoom synchronisés) / revenir au document.
      var _mp=document.getElementById('pbarMap'); if(_mp) _mp.addEventListener('click',showMap);
      var _mb=document.getElementById('mapBack'); if(_mb) _mb.addEventListener('click',hideMap);
      // Reprise d'une présentation existante (depuis le panneau « Présentations en direct ») → prioritaire.
      if(CFG.resumeSlug){ setTimeout(function(){ resumePresent(CFG.resumeSlug); }, 200); }
      // Ouverture « Présenter » depuis le menu Documents → démarre tout de suite.
      else if(CFG.autoPresent){ setTimeout(startPresent, 120); }
      // Le transfert a réussi côté app → je cesse de piloter localement sans clôturer.
      // Transfert confirmé : on cesse de piloter ET on retire la présence (untrack) AVANT de laisser l'app fermer
      // le viewer → pas de présence fantôme. On rend la main à l'app (present-left) une fois nettoyé.
      Player.bridge.onHostMessage(function(m){ if(m.type==='handover-done'){ stopPilotingLocally(); setTimeout(function(){ Player.bridge.sendToHost({type:'present-left'}); }, 120); } });
    } else {
      try{ wireShare(); }catch(e){}
    }
    function loadError(m){ var l=document.getElementById('lpct'); if(l){ l.textContent=m; l.className='lerr'; } var b=document.getElementById('lbar'); if(b)b.style.display='none'; }
    function hideLoader(){ var l=document.getElementById('load'); if(l&&!l.classList.contains('hide')){ l.classList.add('hide'); setTimeout(function(){ if(l.parentNode) l.parentNode.removeChild(l); },450); } }
    // (Ici vivait « if(!window.pdfjsLib) return » — sentinelle de l'époque où pdf.js entrait par
    // une balise AVANT ce script. La bibliothèque s'importe désormais dans le boot lui-même : la
    // garde ne protégeait plus rien et faisait sortir la visionneuse ENTIÈRE, sans un mot — vu à
    // la sonde du banc : zéro requête d'actif, zéro erreur, zéro document.)
    function start(){
      // Ouverture journalisée, chrono lancé, écouteurs de visibilité / focus / inactivité posés.
      T.start();
      document.getElementById('zin').addEventListener('click',function(){ setZoom(zoom+0.2); });
      document.getElementById('zout').addEventListener('click',function(){ setZoom(zoom-0.2); });
      document.getElementById('rotL').addEventListener('click',function(){ tournerDe(-1); });
      document.getElementById('rotR').addEventListener('click',function(){ tournerDe(1); });
      document.getElementById('vignBtn').addEventListener('click',basculerVignettes);
      if(vignIn){
        var desarmer=function(){ vignSuivi=false; };
        vignIn.addEventListener('wheel',desarmer,{passive:true});
        vignIn.addEventListener('pointerdown',desarmer,{passive:true});
        vignIn.addEventListener('keydown',function(e){ if(e.key==='ArrowDown'||e.key==='ArrowUp') vignSuivi=false; },{passive:true});
      }
      // Un document d une seule page, ou une image : le panneau n aurait rien a montrer.
      if(IS_IMG){ var vb=document.getElementById('vignBtn'); if(vb) vb.style.display='none'; }
      brancherZoomAuGeste();
      render();
    }
    // ── ZOOM AU GESTE : apercu immediat, reconstruction differee ─────────────────────────────────
    //
    // ⚠️ POURQUOI LE PINCEMENT ZOOMAIT L ECRAN ENTIER : PERSONNE N ECOUTAIT. Sur trackpad, un pincement
    // n est pas un evenement tactile — le navigateur l envoie comme un wheel portant ctrlKey. Aucun
    // ecouteur ici ne le lisait, donc le navigateur appliquait son defaut, que la balise viewport
    // autorise explicitement. Ce n etait pas un reglage manquant, c etait un silence.
    //
    // ⚠️ ET LE DEFAUT ETAIT PLUS LARGE QUE LE CONFORT : sous 860 px la barre replie le bloc de zoom.
    // Sur mobile le pincement est donc le SEUL geste qu un lecteur tente — et il deformait toute
    // l interface. Ce bloc ne rajoute pas une commodite, il repare le seul zoom jamais essaye.
    //
    // ⚠️ EN DEUX TEMPS, PARCE QU UN SEUL NE TIENT PAS. build() vide le conteneur, annule les rendus en
    // vol et recree toutes les pages : juste pour un clic, ruineux pour un pincement qui produit des
    // dizaines d evenements par seconde. Pendant le geste on ne pose qu une transformation CSS ; la
    // reconstruction arrive UNE fois, quand les doigts s arretent.
    //
    // Note de forme : ce script vit dans un litteral de gabarit — pas d accent grave ici.
    var geste=null, tGeste=null;
    var DELAI_CONFIRMATION=180;   // ms de silence avant de reconstruire

    function majEtiquetteZoom(){ var l=document.getElementById('zlbl'); if(l)l.textContent=Math.round(zoom*100)+'%'; }

    // L ancre est prise DANS LE CONTENEUR DES PAGES et une seule fois, au debut du geste : la mesurer a
    // nouveau pendant l apercu la lirait a travers la transformation deja posee.
    function ancreDuGeste(cx,cy){
      var r=pagesEl.getBoundingClientRect();
      return { x:cx-r.left, y:cy-r.top, largeur:r.width||1, cx:cx, cy:cy };
    }
    // ⚠️ ORIGINE EN HAUT AU CENTRE, ET UNE TRANSLATION QUI IMMOBILISE LE POINT VISE. #pages est centre
    // (align-items:center, margin:0 auto) : grandir autour de son centre ferait FUIR le point que le
    // lecteur regarde. La translation qui le fige vaut (ancre - origine) x (1 - facteur).
    function poserApercu(f,ancre){
      var tx=(ancre.x-ancre.largeur/2)*(1-f), ty=ancre.y*(1-f);
      pagesEl.style.transformOrigin='50% 0';
      pagesEl.style.transform='translate('+tx+'px,'+ty+'px) scale('+f+')';
      pagesEl.style.willChange='transform';
    }
    function retirerApercu(){ pagesEl.style.transform=''; pagesEl.style.transformOrigin=''; pagesEl.style.willChange=''; }
    // L apercu s arrete aux memes bornes que la reconstruction, sinon le document continue de grandir
    // sous les doigts puis SAUTE en arriere au relachement.
    function facteurBorne(g){ return Player.viewer.clampZoom(g.depart*g.facteur)/g.depart; }

    // ⚠️ LA PART FIXE DU CONTENU N EST PAS UN DETAIL. #pages porte 22 px de marge en haut et en bas et
    // 16 px entre chaque page : cent pages font plus de 1500 px qui ne grandissent PAS avec le zoom. Les
    // compter comme proportionnels projette le lecteur trop bas, d autant plus qu il est loin dans le
    // document.
    function partFixeDuContenu(){ return { largeur:28, hauteur:44+16*Math.max(0,numPages-1) }; }
    // ⚠️ ET LA TETE DE CE FIXE SE COMPORTE AUTREMENT : les 22 px de marge HAUTE arrivent avant la
    // premiere page et ne bougent jamais, alors que les espaces entre pages sont proportionnels au
    // nombre de pages au-dessus du point vise. Les confondre coutait 14,5 px de fuite, MESURES dans
    // Chromium sur un document de 40 pages : le point vise glissait d autant plus qu on lisait loin.
    function teteFixeDuContenu(){ return { largeur:14, hauteur:22 }; }

    // Le point de passage unique : boutons, molette, trackpad et doigts finissent tous ici.
    function confirmerZoom(z,cx,cy){
      clearTimeout(tGeste); tGeste=null; geste=null;
      retirerApercu();
      var avant=zoom, apres=Player.viewer.clampZoom(z);
      if(apres===avant){ majEtiquetteZoom(); return; }
      var sr=scrollEl.getBoundingClientRect();
      var cible=Player.viewer.ancrageApresZoom({
        defilement:{x:scrollEl.scrollLeft,y:scrollEl.scrollTop},
        point:{x:cx-sr.left,y:cy-sr.top},
        cadre:{largeur:scrollEl.clientWidth,hauteur:scrollEl.clientHeight},
        contenu:{largeur:scrollEl.scrollWidth,hauteur:scrollEl.scrollHeight},
        fixe:partFixeDuContenu(), fixeDebut:teteFixeDuContenu(),
        zoomAvant:avant, zoomApres:apres });
      zoom=apres; majEtiquetteZoom();
      // ⚠️ if(pdfDoc) SEUL LAISSAIT LES IMAGES SANS ZOOM. Le commentaire de renderImage annonce que
      // « tout le chrome — loader, zoom, plein ecran… — fonctionne tel quel » : c etait faux pour le
      // zoom, pdfDoc restant nul sur une image. Le defaut passait inapercu tant que le zoom tenait a
      // deux boutons ; intercepter le pincement sans le corriger aurait AVALE le geste sur ces
      // documents, donc fait pire qu avant.
      if(!pdfDoc && !IS_IMG) return;
      build();
      scrollEl.scrollLeft=cible.x; scrollEl.scrollTop=cible.y;
    }

    // Les boutons visent le centre du cadre. Ils heritent donc de l ancrage, et la derive qu ils avaient
    // deja — les pages changent de largeur, le defilement reste en pixels — disparait.
    function setZoom(z){
      var sr=scrollEl.getBoundingClientRect();
      confirmerZoom(z, sr.left+scrollEl.clientWidth/2, sr.top+scrollEl.clientHeight/2);
    }

    function brancherZoomAuGeste(){
      // A. TRACKPAD ET CTRL+MOLETTE. NON PASSIF, et c est la ligne qui compte : wheel est passif par
      // defaut sur les navigateurs recents, et un ecouteur passif voit son preventDefault IGNORE —
      // l ecran zoomerait quand meme, en silence.
      scrollEl.addEventListener('wheel',function(e){
        if(!e.ctrlKey)return;
        e.preventDefault();
        if(!geste) geste={ancre:ancreDuGeste(e.clientX,e.clientY),depart:zoom,facteur:1};
        // Exponentielle plutot que lineaire : le geste devient symetrique — pincer puis ecarter d autant
        // revient exactement au zoom de depart, ce qu une addition ne donne pas.
        geste.facteur*=Math.exp(-e.deltaY/180);
        geste.ancre.cx=e.clientX; geste.ancre.cy=e.clientY;
        poserApercu(facteurBorne(geste),geste.ancre);
        // La molette n a pas de fin declaree : le silence en tient lieu.
        clearTimeout(tGeste);
        tGeste=setTimeout(function(){ if(geste) confirmerZoom(geste.depart*geste.facteur,geste.ancre.cx,geste.ancre.cy); },DELAI_CONFIRMATION);
      },{passive:false});

      // B. SAFARI. Ses evenements de geste ne sont pas standard mais sont les seuls disponibles la-bas ;
      // sans le preventDefault du gesturestart, Safari zoome la page avant nous.
      if('ongesturestart' in window){
        scrollEl.addEventListener('gesturestart',function(e){ e.preventDefault(); geste={ancre:ancreDuGeste(e.clientX,e.clientY),depart:zoom,facteur:1}; },{passive:false});
        scrollEl.addEventListener('gesturechange',function(e){ e.preventDefault(); if(!geste)return; geste.facteur=e.scale||1; poserApercu(facteurBorne(geste),geste.ancre); },{passive:false});
        scrollEl.addEventListener('gestureend',function(e){ e.preventDefault(); if(!geste)return; confirmerZoom(geste.depart*geste.facteur,geste.ancre.cx,geste.ancre.cy); },{passive:false});
      }

      // C. TACTILE A DEUX DOIGTS. On ne prend la main qu a DEUX pointeurs : un seul doigt reste le
      // defilement du navigateur, qui le fait mieux que nous et sans a-coups.
      var doigts=Object.create(null), nDoigts=0, ecart0=0;
      function ecartEtMilieu(){
        var a=null,b=null;
        for(var k in doigts){ if(!a)a=doigts[k]; else { b=doigts[k]; break; } }
        if(!a||!b)return null;
        var dx=a.x-b.x, dy=a.y-b.y;
        return { d:Math.sqrt(dx*dx+dy*dy), cx:(a.x+b.x)/2, cy:(a.y+b.y)/2 };
      }
      scrollEl.addEventListener('pointerdown',function(e){
        if(e.pointerType!=='touch')return;
        if(!doigts[e.pointerId]) nDoigts++;
        doigts[e.pointerId]={x:e.clientX,y:e.clientY};
        if(nDoigts===2){ var m=ecartEtMilieu(); if(m&&m.d>0){ ecart0=m.d; geste={ancre:ancreDuGeste(m.cx,m.cy),depart:zoom,facteur:1}; } }
      },{passive:true});
      scrollEl.addEventListener('pointermove',function(e){
        if(e.pointerType!=='touch'||!doigts[e.pointerId])return;
        doigts[e.pointerId]={x:e.clientX,y:e.clientY};
        if(nDoigts!==2||!geste||!ecart0)return;
        var m=ecartEtMilieu(); if(!m)return;
        e.preventDefault();
        geste.facteur=m.d/ecart0; geste.ancre.cx=m.cx; geste.ancre.cy=m.cy;
        poserApercu(facteurBorne(geste),geste.ancre);
      },{passive:false});
      // ⚠️ ON CONFIRME DES QU IL NE RESTE QU UN DOIGT, pas quand ils sont tous partis : un lecteur qui
      // leve un doigt et garde l autre pose continue a lire, et l apercu resterait fige sur une
      // transformation que rien ne viendrait plus confirmer.
      function doigtLeve(e){
        if(e.pointerType!=='touch'||!doigts[e.pointerId])return;
        delete doigts[e.pointerId]; nDoigts=Math.max(0,nDoigts-1);
        if(nDoigts<2&&geste){ var g=geste; ecart0=0; confirmerZoom(g.depart*g.facteur,g.ancre.cx,g.ancre.cy); }
      }
      scrollEl.addEventListener('pointerup',doigtLeve,{passive:true});
      scrollEl.addEventListener('pointercancel',doigtLeve,{passive:true});
    }
    // ⚠️ UN REFUS ARRÊTE LE LECTEUR, et les deux replis plus doux ont été MESURÉS avant d'être
    // écartés — pas jugés sur leur mine :
    //
    //   • rendre l'URL distante : pdf.js l'enveloppe LUI-MÊME dans un blob de même origine, et le
    //     code non vérifié s'exécute. C'était le comportement livré : l'empreinte ne servait à rien ;
    //   • laisser la valeur vide : pdf.js DÉDUIT une adresse par défaut depuis sa propre position
    //     sur le CDN, et le charge quand même.
    //
    // Les deux annulaient la vérification EN SILENCE, et aucun raisonnement ne l'aurait dit : il a
    // fallu regarder les workers réellement créés. Il ne reste qu'une sortie honnête — ne pas
    // afficher, et le dire. Un document qu'on ne rend pas se voit ; un document rendu par du code
    // qu'on n'a pas vérifié, non.
    //
    // Le drapeau posé sur la fenêtre permet au banc d'EXIGER le refus, au lieu de constater une
    // absence de rendu qui aurait dix causes.
    // ⚠️ ON NE FERME QUE CE QUI DÉPEND DU WORKER. Le premier correctif gatait la mise en route du
    // lecteur ENTIER — or elle sert aussi au chemin IMAGE, qui n appelle pdf.js à aucun moment. Un
    // worker invérifiable empêchait donc d afficher un PNG : une porte fermée sur une pièce que le
    // code refusé ne pouvait pas atteindre.
    //
    // ⚠️ PAS D ACCENT GRAVE ICI : ce commentaire vit dans le gabarit de la page, un accent grave y
    // ferme la chaîne. Troisième fois aujourd hui.
    //
    // Trouvé par le harnais de l hôte, pas ici : son essai d assistant a cessé de démarrer, et j ai
    // d abord diagnostiqué un artefact de jsdom. Corriger le harnais aurait masqué le défaut.
    //
    // Le refus reste ENTIER pour un PDF, là où le worker s exécute.
    function refuserWorker(){
      window.__workerRefuse=1;
      if(IS_IMG){ start(); return; }
      loadError("Document non affiche : une dependance n a pas pu etre verifiee.");
    }
    // La bibliothèque vient de NOTRE origine, en module ES : l'import qui échoue est un échec de
    // NOTRE serveur — même refus fermé qu'avant (l'image, elle, n'a pas besoin du worker).
    try{
      import(CFG.pdfjs).then(function(m){
        window.pdfjsLib=m;
        pdfjsLib.GlobalWorkerOptions.workerSrc=CFG.pdfjsWorker;
        start();
      }).catch(refuserWorker);
    }catch(e){ refuserWorker(); }
    // Bord à bord en une-page mobile : chaque millimètre compte, surtout pour un PDF paysage.
    function baseWidth(){ var pad=(onePage&&window.innerWidth<=820)?0:30; return (scrollEl.clientWidth||900)-pad; }
    // Hauteur du document OCCULTÉE par la bottom sheet du bot (mobile, état compagnon) : la page une-page se
    // re-fit dans l'espace VISIBLE au-dessus — le prospect voit la page ET la conversation en même temps.
    // 0 sur desktop (panneau latéral), sheet réduite, ou état plein (doc en pause derrière le scrim).
    function isLand(){ return window.matchMedia&&matchMedia('(orientation: landscape) and (max-height: 520px)').matches; } // téléphone tenu en paysage
    function botOverlap(){ if(window.innerWidth>820)return 0; var p=document.getElementById('botc'); if(!p||p.classList.contains('min')||document.body.classList.contains('botsheet-c'))return 0;
      try{ var r=p.getBoundingClientRect(), s=scrollEl.getBoundingClientRect(); return Math.max(0,s.bottom-r.top); }catch(e){ return 0; } }
    // Largeur cible d'une page. En mode « une seule page » on la borne par la HAUTEUR dispo (moins la sheet) →
    // la page tient entièrement dans le cadre visible. Sinon largeur classique (défilement vertical).
    // Bande basse du mode barre : hauteur RÉELLE occupée par le bandeau (+ son décalage 26px). Sert au
    // centrage (padding-bottom) ET au fit (avec 20px de respiration en plus) → marges symétriques ~24px
    // au-dessus du document et entre le document et le bandeau (avant : collé en haut, tout le vide en bas).
    function capReserve(){ if(!document.body.classList.contains('deskcap'))return 0;
      var dc=document.getElementById('dcap'); var bh=(dc&&dc.offsetHeight)||0; return Math.max(112,bh+26); }
    // En barre, le header est en position:fixed (il RECOUVRE le haut) → on réserve aussi sa hauteur
    // (padding-top 58px en CSS) pour que la page ne passe jamais dessous : band+54 = 58 haut + 20 bas + marge.
    function onePageReserve(){ var band=capReserve(); return document.body.classList.contains('botplayer')?(document.body.classList.contains('vsplit')?Math.round(window.innerHeight*0.38)+70:(isLand()?12:260)):(band?band:(document.body.classList.contains('deskaudio')?4:0)); }
    // La géométrie (bornes, respiration, seuil d'abandon) vit dans player/src/viewer.ts ; ici on ne
    // fournit que les MESURES, seules choses que le DOM connaisse.
    // ⚠️ LA PROPORTION EFFECTIVE GOUVERNE LE SUIVI DE LECTURE, PAS SEULEMENT L AFFICHAGE. Elle fixe la
    // hauteur des gabarits poses AVANT rendu ; ces gabarits fixent la longueur du document ; cette
    // longueur decide de la page que l observateur d intersection appelle « courante » ; et c est cette
    // page-la que le suivi enregistre. Une proportion non tournee a 90 degres fausse donc les
    // statistiques d un partage, en silence et sans rien casser a l ecran.
    function aspectEffectif(){ return Player.viewer.aspectApresRotation(firstAspect,rot); }
    function targetWidth(){ return Player.viewer.fitWidth({containerWidth:baseWidth(),containerHeight:scrollEl.clientHeight,zoom:zoom,onePage:onePage,aspect:firstAspect,rotation:rot,overlap:botOverlap(),reserve:onePageReserve()}); }
    // IMAGE — la visionneuse ne savait lire QUE du PDF (pdf.js). Une axonométrie en .jpg
    // partait donc dans getDocument() et échouait sur « structure invalide ».
    // Elle devient une page unique : tout le chrome — loader, zoom, plein écran, Partager,
    // Télécharger, suivi de consultation — est générique et fonctionne tel quel.
    function renderImage(){
      var img=new Image();
      img.onload=function(){
        numPages=1; window.__n=1; T.setPageCount(1);
        firstAspect=(img.naturalHeight||1)/(img.naturalWidth||1);
        var pg=document.getElementById('pg'); if(pg)pg.textContent='Page 1 / 1';
        imgSrc=CFG.fileUrl;
        build();
        try{if(window.PlayerBot)window.PlayerBot.init(VIEWER);}catch(e){}
      };
      img.onerror=function(){ loadError("Impossible d'afficher ce document."); };
      img.src=CFG.fileUrl;
    }
    function render(){
      if(IS_IMG){ renderImage(); return; }
      var task=pdfjsLib.getDocument({url:CFG.fileUrl,isEvalSupported:false});
      task.onProgress=function(p){ if(p&&p.total){ var pct=Math.max(8,Math.min(99,Math.round(p.loaded/p.total*100))); var bar=document.getElementById('lbar'); if(bar)bar.classList.remove('idle'); var f=document.getElementById('lbarFill'); if(f)f.style.width=pct+'%'; var l=document.getElementById('lpct'); if(l)l.textContent=pct+' %'; } };
      task.promise.then(function(pdf){
        pdfDoc=pdf; numPages=pdf.numPages; window.__n=pdf.numPages; T.setPageCount(pdf.numPages);
        // Un document d une seule page : le panneau de vignettes n aurait rien a montrer.
        if(numPages<2){ var vb1=document.getElementById('vignBtn'); if(vb1) vb1.style.display='none'; }
        document.getElementById('pg').textContent='Page 1 / '+pdf.numPages;
        pdf.getPage(1).then(function(p){ var vp=p.getViewport({scale:1}); firstAspect=vp.height/vp.width; build(); try{if(window.PlayerBot)window.PlayerBot.init(VIEWER);}catch(e){} })
          .catch(function(){ build(); try{if(window.PlayerBot)window.PlayerBot.init(VIEWER);}catch(e){} });
      }).catch(function(){ loadError("Impossible d'afficher ce document."); });
    }
    function build(){
      // Un apercu de zoom n a plus de sens des qu on reconstruit : le laisser poserait une
      // transformation orpheline sur des pages neuves. Cas reel : un redimensionnement de
      // fenetre pendant un pincement.
      retirerApercu();
      // Une nouvelle construction invalide tout ce qui etait en vol : sans cela, les rendus lances
      // par la precedente peignent dans des elements DETACHES (pagesEl a ete vide) et le travail est
      // fait deux fois. C est le meme mecanisme de generation que la page audience.
      renderGen++;
      annulerTout();
      rendered={}; enCours={};
      if(io) io.disconnect();
      if(ioCur) ioCur.disconnect();
      // PRÉ-RENDU : marge de 500px → on rend les pages un peu avant qu'elles arrivent (fluide).
      io=new IntersectionObserver(function(es){es.forEach(function(e){var n=+e.target.dataset.p; if(e.isIntersecting){renderPage(n,e.target);}});},{root:scrollEl,rootMargin:Player.viewer.PRERENDER_MARGIN,threshold:0.01});
      // PAGE COURANTE : bande FINE au centre du viewport (marge négative) → cur = la page réellement centrée,
      // pas polluée par la marge de pré-rendu. Corrige le décalage d'une page présentateur ↔ audience.
      ioCur=new IntersectionObserver(function(es){es.forEach(function(e){ if(e.isIntersecting){ setCur(+e.target.dataset.p); } });},{root:scrollEl,rootMargin:Player.viewer.CURRENT_PAGE_MARGIN,threshold:0});
      pagesEl.innerHTML='';
      var w=Math.round(targetWidth());
      for(var i=1;i<=numPages;i++){ var d=document.createElement('div'); d.className='page ph'; d.dataset.p=i; d.style.width=w+'px'; d.style.height=Math.round(w*aspectEffectif())+'px'; d.textContent='Page '+i; pagesEl.appendChild(d); io.observe(d); ioCur.observe(d); }
      var _band=capReserve(); var _pb=document.body.classList.contains('botplayer')?(document.body.classList.contains('vsplit')?Math.round(window.innerHeight*0.38)+50:(isLand()?0:240)):(botOverlap()+(_band?_band+12:(document.body.classList.contains('deskaudio')?16:0))); pagesEl.style.paddingBottom = onePage ? (_pb+'px') : ''; // centre la page dans l'espace VISIBLE (au-dessus de la sheet mobile / du bandeau desktop / sous le header en audio seul)
      if(onePage) showPage(cur||1);
    }
    // ── Mode « une seule page » : afficher / tourner une page à la fois, sans défilement ──────────────────
    function syncArrows(){ var st=Player.viewer.arrowState(cur,numPages); var pv=document.getElementById('opPrev'), nx=document.getElementById('opNext'); if(pv)pv.disabled=st.prevDisabled; if(nx)nx.disabled=st.nextDisabled; }
    function showPage(p){ p=Player.viewer.clampPage(p,numPages); try{ document.body.classList.toggle('pgback',(+p)<(cur||1)); }catch(e){} // sens du glissé (avant/arrière)
      var els=pagesEl.querySelectorAll('.page'); for(var i=0;i<els.length;i++){ els[i].classList.toggle('cur',(+els[i].dataset.p)===p); } var el=pagesEl.querySelector('.page[data-p="'+p+'"]'); if(el){ renderPage(p,el); var nx=pagesEl.querySelector('.page[data-p="'+(p+1)+'"]'); if(nx)renderPage(p+1,nx); } setCur(p); syncArrows();
      var pf=document.getElementById('pglineF'); if(pf&&numPages)pf.style.width=Player.viewer.progressPercent(p,numPages)+'%'; } // ligne de progression (mode présentation)
    function enterOnePage(){ if(onePage)return; onePage=true; document.body.classList.add('onepage'); document.body.classList.add('botlock'); if(pdfDoc){ var c=cur||1; build(); showPage(c); } syncArrows(); }
    function exitOnePage(){ if(!onePage)return; onePage=false; soloOffered=false; document.body.classList.remove('onepage'); document.body.classList.remove('botlock'); var c=cur||1; if(pdfDoc){ build(); setTimeout(function(){ scrollToPage(c); },30); } syncArrows(); }
    // Re-fit du document à la largeur réelle (resize fenêtre, ouverture/fermeture du chat ancré, plein écran)
    // en conservant la page courante. Débouncé pour rester fluide.
    function scrollToPage(p){ var el=pagesEl.querySelector('.page[data-p="'+p+'"]'); if(el) el.scrollIntoView({block:'start'}); }
    // ⚠️ PAS window.__refit ICI : il commence par « if(!pdfDoc) return », donc il ne ferait RIEN sur un
    // document image — le meme garde qui laissait les images sans zoom avant le lot 1.
    // ── PANNEAU DE VIGNETTES ─────────────────────────────────────────────────────────────────────
    //
    // ⚠️ LE MOTEUR EXISTAIT DEJA, DANS LE CHAT — et une seule de ses parties ne se transpose pas.
    // gabarit-live.js fabrique des vignettes de pieces jointes avec un cache borne, une file de
    // concurrence, un chargement paresseux et des URL objet plutot que des data-URL. Tout cela sert
    // ici. Ce qui NE se transpose pas est le getDocument suivi d un destroy : ce panneau montre les
    // pages du document DEJA OUVERT. Le reprendre tel quel telechargerait le fichier une seconde fois
    // et ferait tourner deux workers sur le meme PDF.
    //
    // ⚠️ ET LE CACHE EST BORNE PARCE QU UN DOCUMENT NE L EST PAS. Cinq cents pages font cinq cents
    // boutons — c est peu — mais cinq cents canvas seraient le defaut que la fenetre glissante ferme
    // deja pour les pages. On garde les derniers, on rend les autres a l etat de gabarit, et
    // l observateur les refabrique s ils reviennent a l ecran.
    var VIGN_LARGEUR=132, VIGN_MAX=48, VIGN_PARALLELE=2;
    var vignOuvert=false, vignIO=null, vignFile=[], vignActifs=0, vignOrdre=[], vignFaites=Object.create(null), vignEchecs=Object.create(null);
    // ⚠️ LE SUIVI AUTOMATIQUE SE DESARME DES QUE LE LECTEUR TOUCHE LE PANNEAU. Sans ca, parcourir les
    // vignettes ramene sans cesse le panneau sur la page en cours et le lecteur se bat contre son
    // outil. On ecoute les GESTES, pas l evenement scroll : un defilement que NOUS provoquons ne doit
    // pas compter comme une intention du lecteur.
    var vignSuivi=true;

    function vignVider(bt){
      bt.innerHTML='';
      bt.style.height=Math.round(VIGN_LARGEUR*aspectEffectif())+'px';
      var s=document.createElement('span'); s.className='vg-n'; s.textContent=bt.dataset.p; bt.appendChild(s);
    }
    function vignEvincer(){
      while(vignOrdre.length>VIGN_MAX){
        var vieux=vignOrdre.shift();
        delete vignFaites[vieux];
        var bt=vignIn.querySelector('.vg[data-p="'+vieux+'"]');
        if(bt){ vignVider(bt); if(vignIO) vignIO.observe(bt); }
      }
    }
    function vignSuivante(){
      if(vignActifs>=VIGN_PARALLELE||!vignFile.length)return;
      var t=vignFile.shift(); vignActifs++;
      Promise.resolve().then(t).catch(function(){}).then(function(){ vignActifs--; vignSuivante(); });
    }
    function vignRendre(bt){
      var n=+bt.dataset.p;
      if(!pdfDoc||vignFaites[n])return;
      vignFaites[n]=1; vignOrdre.push(n); vignEvincer();
      // ⚠️ UN ECHEC DOIT POUVOIR ETRE RETENTE, ET C EST LE DEFAUT QUE LE CHEMIN PRINCIPAL DOCUMENTE
      // DEJA : « on ne marque pas RENDUE avant de l avoir fait ». Ici la marque est posee AVANT, pour
      // dedoublonner les demandes concurrentes ; il faut donc la RETIRER si le rendu echoue, sinon la
      // vignette reste vide pour toujours et plus rien ne la redemande. Trouve en mesurant : le
      // navigateur d essai rejetait chaque rendu, et la file avalait le rejet sans un mot.
      //
      // ⚠️ ET LA REPRISE EST BORNEE, PARCE QU OBSERVER UN ELEMENT DEJA VISIBLE RAPPELLE LE CALLBACK
      // TOUT DE SUITE. Re-observer sans compter fabriquerait une BOUCLE INFINIE des que les rendus
      // echouent en serie — un moteur trop ancien, une memoire pleine — et brulerait le processeur du
      // lecteur en silence. Mesure sur un navigateur ou chaque rendu echoue : sans borne, la file ne
      // se vidait jamais. Deux tentatives, puis on laisse la vignette vide plutot que de tourner.
      var oublier=function(){
        delete vignFaites[n];
        var j=vignOrdre.indexOf(n); if(j>=0) vignOrdre.splice(j,1);
        vignEchecs[n]=(vignEchecs[n]||0)+1;
        if(vignEchecs[n]<2 && vignIO && bt.isConnected) vignIO.observe(bt);
      };
      vignFile.push(function(){
        return pdfDoc.getPage(n).then(function(page){
          if(!vignFaites[n])return;                      // evincee pendant l attente
          var rotEff=Player.viewer.rotationEffective(page.rotate,rot);
          var v0=page.getViewport({scale:1,rotation:rotEff});
          var v=page.getViewport({scale:VIGN_LARGEUR/v0.width,rotation:rotEff});
          var c=document.createElement('canvas');
          c.width=Math.ceil(v.width); c.height=Math.ceil(v.height);
          return page.render({canvasContext:c.getContext('2d'),viewport:v}).promise.then(function(){
            if(!vignFaites[n])return;
            bt.style.height=''; bt.innerHTML=''; bt.appendChild(c);
            var s=document.createElement('span'); s.className='vg-n'; s.textContent=n; bt.appendChild(s);
          }, oublier);
        }, oublier);
      });
      vignSuivante();
    }
    function vignMarquer(p){
      if(!vignOuvert||!vignIn)return;
      var els=vignIn.querySelectorAll('.vg');
      for(var i=0;i<els.length;i++) els[i].classList.toggle('on',(+els[i].dataset.p)===p);
      if(!vignSuivi)return;
      var el=vignIn.querySelector('.vg[data-p="'+p+'"]');
      // On deplace le defilement DU PANNEAU, jamais scrollIntoView : celui-ci remonte la chaine des
      // ancetres scrollables et emporterait le document avec lui.
      if(el) vignIn.scrollTop=Math.max(0,el.offsetTop-(vignIn.clientHeight-el.offsetHeight)/2);
    }
    function vignConstruire(){
      if(!vignIn)return;
      if(vignIO){ vignIO.disconnect(); vignIO=null; }
      vignIn.innerHTML=''; vignFaites=Object.create(null); vignEchecs=Object.create(null); vignOrdre=[]; vignFile=[];
      if(!pdfDoc||numPages<2)return;
      vignIO=new IntersectionObserver(function(es){
        es.forEach(function(e){ if(e.isIntersecting){ vignIO.unobserve(e.target); vignRendre(e.target); } });
      },{root:vignIn,rootMargin:'220px 0px'});
      for(var i=1;i<=numPages;i++){
        var bt=document.createElement('button');
        bt.type='button'; bt.className='vg'; bt.dataset.p=i; bt.setAttribute('role','listitem');
        bt.setAttribute('aria-label','Aller à la page '+i);
        vignVider(bt);
        bt.addEventListener('click',function(){
          var n=+this.dataset.p; vignSuivi=true;
          if(onePage) showPage(n); else scrollToPage(n);
          vignMarquer(n);
        });
        vignIn.appendChild(bt); vignIO.observe(bt);
      }
      vignMarquer(cur||1);
    }
    function basculerVignettes(){
      vignOuvert=!vignOuvert;
      document.body.classList.toggle('vign-on',vignOuvert);
      var b=document.getElementById('vignBtn'); if(b) b.setAttribute('aria-pressed',vignOuvert?'true':'false');
      var v=document.getElementById('vign'); if(v) v.setAttribute('aria-hidden',vignOuvert?'false':'true');
      if(vignOuvert){ vignSuivi=true; vignConstruire(); }
      else if(vignIO){ vignIO.disconnect(); vignIO=null; vignIn.innerHTML=''; vignFaites=Object.create(null); vignEchecs=Object.create(null); vignOrdre=[]; vignFile=[]; }
      // Le cadre a change de largeur : le document se recalcule, en gardant sa page.
      var c=cur||1;
      if(pdfDoc||IS_IMG){ build(); if(onePage) showPage(c); else setTimeout(function(){ scrollToPage(c); },30); }
    }

    function tournerDe(quarts){
      rot=Player.viewer.rotationEffective(rot,quarts*90);
      var c=cur||1;
      if(!pdfDoc && !IS_IMG) return;
      build();
      if(vignOuvert) vignConstruire();   // la proportion des vignettes a change
      if(onePage) showPage(c); else setTimeout(function(){ scrollToPage(c); },30);
    }
    window.__refit=function(){ if(!pdfDoc)return; var c=cur||1; build(); setTimeout(function(){ scrollToPage(c); },30); };
    var _rzT; window.addEventListener('resize',function(){ clearTimeout(_rzT); _rzT=setTimeout(function(){ window.__refit(); },160); });
    // ÉCRAN PARTAGÉ mobile : le fond au-dessus/en-dessous du document prolonge les couleurs de la page
    // (échantillon des bords haut/bas du canvas) — du header jusqu'à la vidéo, dynamique à chaque page.
    function vsplitTint(){ if(!document.body.classList.contains('vsplit'))return;
      var el=document.querySelector('.page[data-p="'+(cur||1)+'"] canvas'); if(!el)return;
      try{ var cx=el.getContext('2d'); var w=el.width,h=el.height; if(!w||!h)return;
        function avg(y,rows){ var d=cx.getImageData(0,y,w,rows).data,r=0,g=0,b=0,n=d.length/4;
          for(var i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
          return 'rgb('+Math.round(r/n)+','+Math.round(g/n)+','+Math.round(b/n)+')'; }
        var top=avg(2,3), bot=avg(Math.max(0,h-5),3);
        scrollEl.style.background='linear-gradient(180deg,'+top+' 0%,'+top+' 42%,'+bot+' 58%,'+bot+' 100%)';
      }catch(e){ /* canvas indisponible → fond par défaut */ } }
    function annulerTout(){
      for(var k in taches){ try{ taches[k].cancel(); }catch(e){} }
      taches={};
    }
    // Rend une page a l etat de reserve : on retire le canvas et la couche texte, on remet la boite
    // avec sa hauteur estimee. Le defilement ne bouge pas, et la page se re-rendra si on y revient.
    function libererPage(n){
      genPage[n]=(genPage[n]||0)+1;             // invalide tout callback en vol pour CETTE page
      var el=pagesEl.querySelector('.page[data-p="'+n+'"]'); if(!el)return;
      if(taches[n]){ try{ taches[n].cancel(); }catch(e){} delete taches[n]; }
      var w=Math.round(targetWidth());
      el.innerHTML=''; el.className='page ph'; el.textContent='Page '+n;
      el.style.width=w+'px'; el.style.height=Math.round(w*aspectEffectif())+'px';
      delete rendered[n]; delete enCours[n];
    }
    // ATTENTION : ON BORNE PAR UN BUDGET DE PIXELS, PAS SEULEMENT PAR UN NOMBRE DE PAGES.
    // Deux pages A4 sur un ecran ×3 pesent plus que dix vignettes : compter les pages laisserait
    // passer le cas qui fait tomber l onglet. On garde donc la fenetre courante, et on evince
    // au-dela — le nombre de canvas reste borne quel que soit le parcours du document.
    function evincerLoin(centre){
      // ATTENTION : LE MODE UNE-PAGE EVINCAIT ZERO, ET MON COMMENTAIRE DISAIT POURQUOI — A TORT.
      //
      // Il portait « une seule page affichee : rien a evincer ». Une seule est AFFICHEE, mais
      // showPage() rend la page courante ET la suivante a chaque navigation, et toutes les
      // precedentes restent dans le DOM. Une presentation guidee de 100 pages finissait donc avec
      // pres de 100 canvas — exactement le defaut que la fenetre glissante ferme ailleurs.
      // Un raisonnement faux ecrit avec assurance fait passer un defaut pour une intention.
      // (Releve par un audit externe.)
      var marge = onePage ? 1 : MARGE_PAGES;    // une-page : courante, suivante, precedente
      // ATTENTION : ON PARCOURT L UNION DES TROIS REGISTRES. rendered seul ignore ce qui est EN
      // VOL : une page eloignee dont le getPage n est pas resolu continuait a travailler, et sa
      // couche texte pouvait se poser plus tard sur une page deja liberee.
      var vus = Object.create(null);
      for(var a in rendered) vus[a]=1;
      for(var b in enCours) vus[b]=1;
      for(var c in taches) vus[c]=1;
      for(var k in vus){
        var n=+k;
        if(n<centre-marge || n>centre+marge) libererPage(n);
      }
    }
    function renderPage(n,el){
      if(rendered[n]||enCours[n])return;
      // ATTENTION : ON NE MARQUE PAS « RENDUE » AVANT DE L AVOIR FAIT. rendered[n]=1 etait pose ici,
      // donc un echec de getPage ou de render laissait la page marquee pour toujours : elle ne se
      // retentait jamais et restait vide. On distingue « en cours » de « aboutie ».
      enCours[n]=1;
      var gen=renderGen, monGenPage=genPage[n]||0;
      if(IS_IMG){
        var w=Math.round(targetWidth());
        var im=document.createElement('img');
        im.src=imgSrc; im.alt=''; im.style.display='block';
        el.classList.remove('ph'); el.textContent=''; el.style.width=w+'px';
        // ⚠️ UN DOCUMENT IMAGE N A PAS DE VIEWPORT : sa rotation ne peut etre qu une transformation CSS.
        // Et un element transforme occupe TOUJOURS sa boite d origine — sans echanger les dimensions du
        // cadre et sortir l image du flux, la mise en page se disloque : la page suivante viendrait se
        // poser par-dessus.
        if(rot===90||rot===270){
          im.style.width=Math.round(w/(firstAspect||1))+'px';
          im.style.position='absolute'; im.style.left='50%'; im.style.top='50%';
          im.style.transform='translate(-50%,-50%) rotate('+rot+'deg)';
          el.style.height=Math.round(w*aspectEffectif())+'px';
        } else {
          im.style.width=w+'px'; el.style.height='';
          if(rot===180) im.style.transform='rotate(180deg)';
        }
        el.appendChild(im);
        im.onload=function(){ if(gen!==renderGen)return; delete enCours[n]; rendered[n]=1; hideLoader(); };
        im.onerror=function(){ delete enCours[n]; };      // reessayable
        if(im.complete){ delete enCours[n]; rendered[n]=1; hideLoader(); }
        return;
      }
      pdfDoc.getPage(n).then(function(page){
      // Un build() est passe (generation globale), ou CETTE page a ete liberee entre-temps.
      if(gen!==renderGen || monGenPage!==(genPage[n]||0)){ delete enCours[n]; return; }
      // ATTENTION : LE DPR N ETAIT PAS PLAFONNE. Sur un ecran ×3, une page de 900 px de large fait
      // pres de 10 M pixels, soit environ 39 Mo de tampon pour UNE page — le gain visuel au-dela de
      // ×2 est nul, le cout est quadratique. On plafonne le DPR, puis on plafonne le NOMBRE DE
      // PIXELS du canvas : deux bornes, parce que le zoom peut faire grandir la page independamment
      // de la densite de l ecran.
      // ⚠️ ON COMPOSE, ON N ECRASE PAS. La documentation de getViewport dit : « si omise, la rotation
      // vaut celle de la page ». Passer une valeur ABSOLUE ecraserait donc le /Rotate du fichier — que
      // portent tres couramment les documents numerises en paysage. Un « remettre a zero » qui passerait
      // 0 ne redresserait pas un document de travers : il COUCHERAIT un document qui etait droit. La
      // composition vit dans src/viewer.ts, ou elle est eprouvee.
      var rotEff=Player.viewer.rotationEffective(page.rotate,rot);
      var scale=Math.min(5,targetWidth()/page.getViewport({scale:1,rotation:rotEff}).width);
      var v=page.getViewport({scale:scale,rotation:rotEff});
      // ATTENTION : LE PLANCHER A 1 CREVAIT LE BUDGET, ET LE BUDGET ETAIT ANNONCE.
      //
      // L ancienne formule reduisait le DPR sans jamais le laisser descendre SOUS 1. Or au zoom
      // maximal la taille CSS a elle seule depasse le budget : a 300 %, une page de 4110×5319 CSS
      // faisait 21,9 M pixels — soit ×5,5 le plafond annonce, environ 83 Mo de tampon pour UNE
      // page. Le plancher visait la nettete ; il annulait la borne exactement quand elle servait.
      //
      // Le facteur se calcule donc depuis la taille CSS, borne par trois choses a la fois : le
      // plafond de densite, la densite REELLE de l ecran (ne jamais sur-rendre), et le budget de
      // pixels — qui peut le faire descendre sous 1. Verifie par calcul sur cinq configurations
      // avant d etre ecrit. (Releve par un audit externe.)
      var pixelsCss=Math.max(1, v.width*v.height);
      var dpr=Math.min(DPR_MAX, window.devicePixelRatio||1, Math.sqrt(PIXELS_MAX/pixelsCss));
      var c=document.createElement('canvas');
      c.setAttribute('role','img'); c.setAttribute('aria-label','Page '+n);
      c.width=Math.floor(v.width*dpr); c.height=Math.floor(v.height*dpr);   // backing store HD → net comme du natif
      c.style.width=v.width+'px'; c.style.height=v.height+'px';
      el.style.height=''; el.classList.remove('ph'); el.textContent=''; el.style.width=v.width+'px'; el.appendChild(c); // classList.remove (PAS className=) : ne pas écraser .cur — en mode une-page la page disparaissait une fois rendue (refit après réduction/réouverture du chat)
      var tache=page.render({canvasContext:c.getContext('2d'),viewport:v,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
      taches[n]=tache;
      tache.promise.then(function(){
        if(taches[n]===tache) delete taches[n];
        if(gen!==renderGen || monGenPage!==(genPage[n]||0)){ delete enCours[n]; return; }
        delete enCours[n]; rendered[n]=1;                  // AVEREE, pas seulement demandee
        hideLoader(); if(n===cur)setTimeout(vsplitTint,60);
      },function(){
        // Annule ou en echec : on retire la marque pour que la page puisse etre retentee.
        if(taches[n]===tache) delete taches[n];
        delete enCours[n];
      });
      // Couche texte (sélection). En pdf.js v3, les spans utilisent font-size:calc(var(--scale-factor)*Npx)
      // → SANS --scale-factor, taille nulle = pas de sélection. On le pose sur le conteneur.
      try{ page.getTextContent().then(function(tc){
        // ATTENTION : LA COUCHE TEXTE ARRIVE APRES, ET SE POSAIT SUR UNE PAGE LIBEREE. Elle
        // ressuscitait alors une page remise en reserve — visible comme un bloc de texte
        // selectionnable flottant sur un cadre vide.
        if(gen!==renderGen || monGenPage!==(genPage[n]||0)) return;
        var tl=document.createElement('div'); tl.className='textLayer';
        tl.style.width=v.width+'px'; tl.style.height=v.height+'px'; tl.style.setProperty('--scale-factor', scale);
        el.appendChild(tl);
        try{ new pdfjsLib.TextLayer({textContentSource:tc,container:tl,viewport:v}).render(); }
        catch(e){ try{ pdfjsLib.renderTextLayer({textContentSource:tc,container:tl,viewport:v}); }
        catch(e2){ try{ pdfjsLib.renderTextLayer({textContent:tc,container:tl,viewport:v}); }catch(e3){} } }
      }); }catch(e){}
    },function(){ delete enCours[n]; }); }
    // ── Assistant IA « présentateur » : chat requête/réponse (bot-start/bot-say) + saut de page piloté ──
${botOn && botBrowser ? botBrowser.botViewerJs(ICONS) : ""}
  })();
  </script>
</body></html>`;
}

// CSP de la page audience (Présenter) : pdf.js vient de NOTRE origine ; supabase-js (jsdelivr) et la connexion
// Realtime (https + wss vers le projet Supabase). Plus permissive que la visionneuse, limitée à cette page.
/**
 * Les origines d'images qu'une page a le droit de charger.
 *
 * ⚠️ FOURNIR UNE URL SANS AUTORISER SON ORIGINE REVIENT À NE PAS LA FOURNIR — avec l'apparence du
 * contraire. Le HTML est parfait, le fichier répond 200, et le navigateur refuse quand même. C'est
 * arrivé en 0.1.47 : la marque du client était résolue, écrite dans la page, et bloquée. Le chemin
 * du lien tracé ajoutait bien son origine ; celui de l'aperçu, non. Deux politiques sur la même
 * instance, à la même minute.
 *
 * ⚠️ ET AUCUNE SONDE SERVEUR NE PEUT LE VOIR. Le HTML rendu est correct, le script se compile, le
 * paquet est conforme. Ni notre étape de fumée, ni la garde d'artefact, ni un test qui exécute la
 * page ne mordent : seul un navigateur le montre. C'est le second hôte qui l'a vu, à l'œil, chez son
 * client.
 *
 * D'où cette fonction : une seule liste, pour toutes les routes qui rendent la visionneuse. La
 * remplir est une décision ; l'oublier n'est plus possible, parce qu'il n'y a plus qu'un endroit.
 *
 * ⚠️ CE QU'ELLE NE COUVRE PAS, ET QUI EST UN AUTRE PROBLÈME. La page d'AUDIENCE affiche les avatars
 * des participants, qui arrivent par la présence — donc à l'exécution, et depuis autant d'origines
 * qu'il y a de membres chez l'hôte. Aucune liste posée au rendu ne peut les prévoir. Les
 * pré-autoriser demanderait d'élargir la politique à une origine d'hôte entière, ce qui est une
 * décision à prendre séparément, pas un oubli à corriger ici.
 *
 * ⚠️ ON NE DÉRIVE PAS CETTE LISTE DU HTML RENDU, et c'est délibéré. Ce serait plus général et ça
 * viderait la politique de son sens : autoriser tout ce que la page référence, c'est autoriser aussi
 * ce qu'une valeur mal filtrée y aurait glissé. La liste porte des CHAMPS connus, pas des URL
 * trouvées.
 */

module.exports = { init, titreOnglet, viewerHtml };
