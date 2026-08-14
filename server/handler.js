// Page publique de consultation d'un document commercial : /doc/:slug → visionneuse pdf.js qui TRACE
// l'ouverture et les PAGES VUES (un lien par destinataire → on sait qui a lu, combien de pages).
//  - GET  /doc/:slug            → HTML visionneuse (pdf.js depuis cdnjs, nonce CSP)
//  - GET  /doc/:slug?file=1     → stream le PDF depuis le Storage (MÊME ORIGINE → pas de souci CORS pour pdf.js)
//  - POST /api/doc {slug,event…}→ journalise un événement (open / page / heartbeat) — best-effort
const crypto = require("crypto");
const { getShareBySlug, logView, upsertSession, createReshare, sendReshareEmail, upsertInternalSession,
  createShare, revokeShare, setShareAuth, overview: docOverview, listSharesForDoc, listSessionsForDoc, internalStatsForDoc } = require("./shares");
const { createPresentation, getPresentation, setPage, endPresentation, addMessage, listMessages, toggleReaction, editMessage, deleteMessage, setChatLock, createUploadUrl, reclaimPresentation, touchPresentation, listActivePresentations, handoverPresentation, endPresentationByOwner, recordAttendance, presentationStats, listPresentationsForDoc, switchPresentationDoc, setPresentationContent } = require("./presentations");
// CONTEXTE INJECTÉ : tout ce que le player emprunte à l'application hôte passe par ici — stockage,
// base, identité, limites, marque, journalisation — et rien d'autre. C'est la frontière qui permettra
// de brancher un second projet, puis d'ouvrir le cœur. Cf. api/_player-context.js.
// ⚠️ Le contexte est REÇU (`init`), pas construit ici. Ce fichier ne sait pas quelle application
// l'héberge — c'est ce qui lui permettra de partir dans le dépôt du player. Le point d'entrée
// Vercel (api/doc.js) est le seul à connaître le studio.
let PLAYER = null;
function init(ctx) {
  PLAYER = ctx;
  // Le domaine reçoit le même contexte : une seule construction pour tout le player.
  require("./shares").init(ctx);
  require("./presentations").init(ctx);
  require("./brands").init(ctx);
  docbot = ctx.plugins.bot;
  brandIntroRuntime = ctx.plugins.brandIntro && ctx.plugins.brandIntro.brandIntroRuntime;
  botBrowser = ctx.plugins.botBrowser;
}
const isAllowedStorageUrl = (url) => PLAYER.storage.isAllowedUrl(url);

// GREFFONS de ce studio — jamais du player. `null` quand le module est absent ou coupé
// (`PLAYER_PLUGINS_OFF`) : chaque usage doit donc être gardé, et le player continue sans eux.
let docbot = null, brandIntroRuntime = null, botBrowser = null;
// Cœur du player (futur projet open source, cf. player/README.md) : code navigateur écrit en
// modules TypeScript testés sous player/src/, regroupé par `npm run build:player`. Injecté tel
// quel dans la visionneuse — `window.Player` y expose le contrat postMessage avec l'app.
const { PLAYER_BROWSER_JS } = require("./browser.generated.js");
// Version publiée du player — lue là où elle est déjà déclarée, pour qu'elle ne puisse pas
// diverger de ce que l'hôte a réellement installé.
const PLAYER_VERSION = require("../package.json").version;
// Registre des marques : le loader porte celle du CLIENT dont on montre le document.
const brands = require("./brands");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Content-Disposition sûr : un en-tête HTTP ne tolère QUE de l'ASCII imprimable (un accent/emoji dans le nom de
// fichier → TypeError ERR_INVALID_CHAR qui casse tout le stream). Repli ASCII pour filename= + RFC 5987 filename*
// pour conserver le nom unicode exact. (esc() = échappement HTML, inadapté à un en-tête → ne plus l'utiliser ici.)
const dispositionInline = (name) => {
  const raw = String(name || "document.pdf");
  const ascii = raw.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "").trim() || "document.pdf";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
};
const originOf = (u) => { try { return new URL(u).origin; } catch { return ""; } };
// ⚠️ CETTE VERSION EST DANS LA PLAGE DE CVE-2024-4367 (exécution de script à l'ouverture d'un PDF
// forgé, quand `isEvalSupported` garde sa valeur par défaut). Deux raisons pour lesquelles elle
// est encore là, et il faut les distinguer :
//
//   1. Notre CSP n'autorise pas `unsafe-eval`, ce qui bloque le chemin d'exploitation. Mais cette
//      atténuation était IMPLICITE — une modification de CSP la rouvrait sans que rien ne le dise.
//      Les quatre appels à `getDocument` forcent donc désormais `isEvalSupported: false`, en
//      défense en profondeur : la protection ne dépend plus d'un en-tête écrit ailleurs.
//   2. La montée vers 4.x n'est PAS un changement de numéro : cdnjs ne publie plus que des modules
//      ES (`pdf.min.mjs`) à partir de 4.0, alors qu'on charge un script classique et qu'on
//      configure le worker à la main. C'est une migration, elle est suivie séparément dans
//      docs/AUDIT-2026-08-14-SUIVI.md (P1-3) avec l'embarquement de la bibliothèque, qui règle
//      aussi la dépendance CDN sans intégrité (P2-4).
//
// Signalé par un audit externe. Fermer le chemin d'abord, migrer ensuite — dans cet ordre.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const SUPAJS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

// ————— Couche LIVE partagée (présence + chat historisé) — présentateur ET audience —————
// CSS injecté dans les deux vues.
const LIVE_CSS = `
  .lrow{flex:1;display:flex;min-height:0;position:relative}
  .lmain{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
  /* Mobile / fenêtre étroite : le chat passe EN SUPERPOSITION (le document garde toute sa largeur). */
  /* Chat mobile = BOTTOM SHEET : monte du bas, poignée pour replier, bouton flottant (FAB) quand fermé.
     Le document se cale en haut → le slide reste visible pendant qu'on discute. #chatPanel (id) bat la spécificité. */
  .chat-grip{display:none}
  /* Bouton flottant chat (mobile) : clair pour ressortir sur le document sombre ; pulse quand non-lus. */
  .chatfab{display:none;position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:38;width:58px;height:58px;border-radius:50%;border:0;background:#faf8f4;color:#1a1a1a;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.5);cursor:pointer}
  .chatfab svg{width:26px;height:26px}
  .chatfab.unread{animation:fabPulse 1.7s ease-out infinite}
  @keyframes fabPulse{0%{box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 0 0 rgba(229,56,77,.55)}70%{box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 0 14px rgba(229,56,77,0)}100%{box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 0 0 rgba(229,56,77,0)}}
  .chatfab-badge{position:absolute;top:-5px;right:-5px;min-width:23px;height:23px;padding:0 6px;border-radius:12px;background:#e5384d;color:#fff;font-size:12px;font-weight:800;line-height:23px;display:none;align-items:center;justify-content:center;box-shadow:0 0 0 2px #0a0a0a}
  /* Aperçu (ticker) : mini-bulle du dernier message qui glisse au-dessus du FAB et disparaît. */
  .chatpeek{display:none;position:fixed;right:16px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:38;max-width:76vw;background:#faf8f4;color:#1c1c1c;border-radius:16px;padding:10px 13px;box-shadow:0 12px 34px rgba(0,0,0,.5);gap:9px;align-items:center;opacity:0;transform:translateY(10px);transition:opacity .28s,transform .28s;cursor:pointer}
  .chatpeek.show{display:flex;opacity:1;transform:translateY(0)}
  .chatpeek .peek-a{width:30px;height:30px;border-radius:50%;flex:none;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:#e6e2db;color:#555;font-size:12px;font-weight:700}
  .chatpeek .peek-a img{width:100%;height:100%;object-fit:cover}
  .chatpeek .peek-b{min-width:0;display:flex;flex-direction:column;line-height:1.25}
  .chatpeek .peek-b b{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chatpeek .peek-t{font-size:13.5px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64vw}
  @media (max-width:720px){
    .chatBtn{display:none!important}
    body:not(.chat-open) .chatfab.on{display:flex}
    #chatPanel{position:fixed;left:0;right:0;bottom:0;top:auto;height:74vh;width:auto;max-width:none;border-left:0;border-radius:18px 18px 0 0;box-shadow:0 -12px 44px rgba(0,0,0,.3);transform:translateY(0);transition:transform .32s cubic-bezier(.22,1,.36,1);z-index:40}
    #chatPanel.hidden{display:flex;transform:translateY(103%)}
    .chat-grip{display:block;width:42px;height:5px;border-radius:3px;background:#0002;margin:9px auto 0;flex:none;cursor:grab}
    .chat-h{padding-top:8px}
    body.chat-open .stage{align-items:flex-start;padding-top:12px}
    /* Lisibilité mobile : corps 15px (au lieu de 13.5), input 16px (empêche le zoom auto iOS au focus).
       Préfixe #chatMsgs/#chatPanel (id) pour battre la spécificité des règles de base définies plus bas. */
    #chatMsgs .cm .txt{font-size:15px;line-height:1.4}
    #chatMsgs .cm .who{font-size:12.5px}
    #chatMsgs .cm .a{width:32px;height:32px;font-size:12px}
    .chat-in input#chatText{font-size:16px}
    #chatPanel .chat-h{font-size:15px}
  }
  .pres{display:none;align-items:center;gap:7px;height:32px;padding:0 11px;border:1px solid #fff3;background:transparent;color:#fff;border-radius:999px;cursor:pointer;font:inherit;font-size:12.5px}
  .pres:hover{background:#fff2}
  .pres .dot{width:7px;height:7px;border-radius:50%;background:#31c76a;flex:none}
  .pres-avs{display:inline-flex}
  .pres-av{width:22px;height:22px;border-radius:50%;margin-left:-7px;border:2px solid var(--bar);background:#8a857c;color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
  .pres-av:first-child{margin-left:0}
  .pres-av img{width:100%;height:100%;object-fit:cover}
  .pres-pop{position:fixed;top:52px;right:14px;width:250px;max-height:60vh;overflow:auto;background:#fff;color:#1c1c1c;border-radius:12px;box-shadow:0 18px 54px rgba(0,0,0,.4);padding:6px;z-index:40;display:none}
  .pres-pop.open{display:block}
  .pres-pop h5{margin:6px 8px 6px;font-size:11.5px;color:#888;font-weight:700}
  .pres-item{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px}
  .pres-item .a,.cm .a{width:28px;height:28px;border-radius:50%;flex:none;background:#e6e2db;color:#555;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
  .pres-item .a img,.cm .a img{width:100%;height:100%;object-fit:cover}
  .pres-item .n{font-size:13px;font-weight:600}
  .pres-item .e{font-size:11px;color:#888}
  .tag{font-size:9.5px;font-weight:800;color:#e5384d;text-transform:uppercase;letter-spacing:.02em}
  .chatBtn{display:none;position:relative}
  .chat-badge{display:none;position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:#e5384d;color:#fff;font-size:10px;font-weight:700;line-height:16px;align-items:center;justify-content:center;box-shadow:0 0 0 2px #1a1a1a}
  .chat{width:330px;max-width:82vw;flex:none;background:#faf8f4;border-left:1px solid #0002;display:flex;flex-direction:column;color:#1c1c1c;position:relative;z-index:6}
  .chat.hidden{display:none}
  .chat-h{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #0001;font-weight:700;font-size:13.5px}
  .chat-h-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-h button{border:0;background:transparent;cursor:pointer;color:#999;padding:0;display:inline-flex;align-items:center;line-height:1}
  .chat-h .cx{font-size:20px}
  .chat-h .cd svg{width:17px;height:17px}
  .chat-h button:hover{color:#333}
  /* Cloche « couper les notifs » : barrée + rouge quand actif. */
  #chatMute{position:relative}
  #chatMute.muted{color:#c0392b}
  #chatMute.muted::after{content:'';position:absolute;left:2px;right:2px;top:calc(50% - 1px);height:2px;background:currentColor;border-radius:2px;transform:rotate(-45deg)}
  /* Chat DÉTACHÉ (mode superposé forcé, même sur desktop) — via le bouton dock/undock. */
  .chat.float{position:absolute;top:0;right:0;bottom:0;width:min(360px,90vw);max-width:90vw;box-shadow:-10px 0 40px rgba(0,0,0,.45);z-index:25}
  .chat-msgs{flex:1;overflow:auto;padding:13px;display:flex;flex-direction:column;gap:11px}
  .chat-empty{color:#999;font-size:12.5px;text-align:center;margin:auto}
  .cm{display:flex;gap:8px;align-items:flex-start}
  .cm .b{min-width:0}
  .cm .who{font-size:11.5px;color:#777;margin-bottom:1px}
  .cm .who b{color:#1c1c1c}
  .cm .txt{font-size:13.5px;line-height:1.35;overflow-wrap:anywhere;white-space:pre-wrap}
  .cm-q{border-left:3px solid #d8d2c8;padding:1px 0 1px 8px;margin:0 0 3px;font-size:12px;color:#7a756c;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cm-q b{color:#555}
  .cm-re{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .re-chip{border:1px solid #e2ddd4;background:#fff;border-radius:999px;padding:1px 8px;font-size:12px;cursor:pointer;color:#333;line-height:1.6}
  .re-chip.on{background:#eef4ff;border-color:#9bb8f0;color:#2f5bd0}
  .cm-act{display:none;gap:3px;align-self:flex-start;margin-top:1px}
  .cm:hover .cm-act{display:inline-flex}
  .cm-act button{border:1px solid #0001;background:#fff;border-radius:7px;width:26px;height:26px;cursor:pointer;font-size:13px;line-height:0;color:#666;display:inline-flex;align-items:center;justify-content:center}
  .cm-act button:hover{background:#f2efe9}
  .cm-del{color:#9a948b;font-style:italic}
  .cm.isdel .cm-act,.cm.isdel .cm-re{display:none}
  .cm-ed{font-size:10.5px;color:#a9a39a}
  .cm-edit-in{width:100%;border:1px solid #c9c3b8;border-radius:7px;padding:5px 8px;font:inherit;font-size:13.5px;background:#fff}
  .chat-locked{padding:6px 14px;font-size:11.5px;color:#b26a00;background:#fdf3e2;border-top:1px solid #f0e2c8;text-align:center;flex:none}
  .chat-in input:disabled{background:#efece7;color:#aaa}
  .chat-in button:disabled{opacity:.5;cursor:default}
  #chatLockBtn.on{color:#e5384d}
  /* Bouton « + » (pièce jointe) façon Apple : petit rond sobre. */
  .chat-in button.chat-attach{border:0;background:#ecebe6;border-radius:50%;cursor:pointer;color:#5a554d;padding:0;flex:none;display:inline-flex;align-items:center;width:34px;height:34px;justify-content:center}
  .chat-in button.chat-attach:hover{color:#1c1c1c;background:#e2e0da}
  .chat-in button.chat-attach svg{width:20px;height:20px;display:block}
  /* Champ + flèche « envoyer » bleue à l'intérieur (Apple SMS), visible dès qu'on tape. */
  .chat-field{position:relative;flex:1;min-width:0;display:flex}
  #chatText{padding-right:44px}
  #chatSend{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:30px;height:30px;min-width:0;padding:0;border-radius:50%;background:#0a84ff;color:#fff;display:none;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(10,132,255,.35)}
  #chatSend.on{display:inline-flex}
  #chatSend svg{width:19px;height:19px;display:block}
  #chatSend:disabled{background:#c8c4bd;box-shadow:none}
  .cm-att{display:inline-block;margin-top:5px;max-width:210px}
  .cm-att img{max-width:210px;max-height:190px;border-radius:9px;display:block;border:1px solid #0001}
  .cm-att-pdf{display:block;text-decoration:none;color:#333;max-width:210px;margin-top:5px;border:1px solid #e2ddd4;border-radius:10px;overflow:hidden;background:#fff}
  .cm-att-pdf:hover{background:#f8f6f2}
  .cm-att-ph{display:block;width:100%;min-height:54px;background:#f0ede8;position:relative}
  .cm-att-ph canvas,.cm-att-ph img{width:100%;display:block}
  .cm-att-ph::after{content:"PDF";position:absolute;top:6px;left:6px;background:#e5484d;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:5px}
  .cm-pdflabel{display:block;font-size:12px;padding:7px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-top:1px solid #eee}
  .cm-file{display:inline-flex;align-items:center;gap:7px;margin-top:5px;background:#fff;border:1px solid #e2ddd4;border-radius:9px;padding:7px 11px;font-size:12.5px;color:#333;text-decoration:none;max-width:230px;overflow:hidden;white-space:nowrap}
  .cm-file:hover{background:#f6f4ef}
  .cm-mention{color:#2f5bd0;font-weight:600;background:#eef4ff;border-radius:4px;padding:0 3px}
  .cm-link{color:#2f5bd0;text-decoration:underline;overflow-wrap:anywhere}
  .cm.mentioned{background:#fff8ec;border-radius:8px;margin:0 -4px;padding:2px 4px}
  .mentionpop{position:absolute;left:10px;right:10px;bottom:56px;background:#fff;border-radius:11px;box-shadow:0 12px 34px rgba(0,0,0,.28);padding:5px;display:none;z-index:42;max-height:190px;overflow:auto}
  .mentionpop.open{display:block}
  .mentionpop button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;color:#1c1c1c}
  .mentionpop button:hover,.mentionpop button.sel{background:#f2efe9}
  .mentionpop .a{width:22px;height:22px;font-size:9px}
  .chat-typing{padding:0 14px;height:15px;font-size:11.5px;color:#9a948b;font-style:italic;flex:none}
  .chat-reply{align-items:center;gap:8px;padding:8px 12px;border-top:1px solid #0001;background:#f3f0ea}
  .chat-reply .cq{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#6a655c}
  .chat-reply .cq b{color:#333}
  .chat-reply button{border:0;background:transparent;font-size:17px;line-height:1;cursor:pointer;color:#999}
  .emojipick{position:fixed;display:none;background:#fff;border-radius:999px;box-shadow:0 10px 34px rgba(0,0,0,.32);padding:4px 6px;z-index:50}
  .emojipick.open{display:flex;gap:1px}
  .emojipick button{border:0;background:transparent;font-size:19px;cursor:pointer;padding:2px 5px;border-radius:8px}
  .emojipick button:hover{background:#f2efe9}
  .chat-in{display:flex;gap:7px;padding:10px;border-top:1px solid #0001}
  .chat-in input{flex:1;min-width:0;border:1px solid #e0dcd4;border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;background:#fff}
  .chat-in button{border:0;background:#1a1a1a;color:#fff;border-radius:999px;padding:0 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;flex:none}
  .join{position:fixed;inset:0;background:rgba(20,18,15,.66);display:flex;align-items:center;justify-content:center;z-index:60}
  .join-card{background:#fff;color:#1c1c1c;border-radius:16px;padding:22px;width:330px;max-width:90vw;text-align:center}
  .join-card h4{margin:0 0 5px;font-size:16px}
  .join-card p{margin:0 0 15px;font-size:12.5px;color:#777}
  .join-card input{width:100%;border:1px solid #e0dcd4;border-radius:10px;padding:10px 13px;font:inherit;font-size:14px;margin-bottom:9px}
  .join-card button{width:100%;border:0;background:#1a1a1a;color:#fff;border-radius:11px;padding:11px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  /* Modale de confirmation maison (remplace window.confirm dans l'iframe présentation). */
  .lmodal{position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;background:rgba(20,18,15,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
  .lmodal.open{display:flex}
  .lmodal-box{background:#faf8f4;border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,.4);width:min(340px,86vw);padding:22px 22px 16px;text-align:center;animation:lmIn .22s cubic-bezier(.22,1,.36,1)}
  @keyframes lmIn{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:none}}
  .lmodal-t{font-size:16px;font-weight:700;color:#1a1a1a}
  .lmodal-d{font-size:13px;color:#7a746b;margin-top:6px;line-height:1.4}
  .lmodal-a{display:flex;gap:9px;margin-top:18px}
  .lmodal-a button{flex:1;border:0;border-radius:12px;padding:11px 0;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  .lmodal-cancel{background:#ecebe6;color:#1c1c1c}
  .lmodal-cancel:hover{background:#e2e0da}
  .lmodal-ok{background:#e5484d;color:#fff}
  .lmodal-ok:hover{background:#d13b40}
`;

// Contrôles de la barre (pastille présence + bouton chat).
const LIVE_BAR = `<button class=pres id=presBtn><span class=dot></span><span id=presCount>1</span><span class=pres-avs id=presAvs></span></button><button class="ic chatBtn" id=chatBtn title="Discussion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg><span class=chat-badge id=chatBadge></span></button>`;

// Panneau chat (à droite) + popover présence.
const LIVE_PANEL = `<div class="chat hidden" id=chatPanel><div class=chat-grip id=chatGrip></div><div class=chat-h><span class=chat-h-t>Discussion</span><button class=cd id=chatMute title="Couper les notifications du chat"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button><button class=cd id=chatLockBtn title="Verrouiller le chat (lecture seule)" style="display:none"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect x=5 y=11 width=14 height=10 rx=2 /><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></button><button class=cd id=chatDock title="Ancrer / détacher le chat"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect x=3 y=4 width=18 height=16 rx=2 /><line x1=15 y1=4 x2=15 y2=20 /></svg></button><button class=cx id=chatClose title=Fermer>×</button></div><div class=chat-msgs id=chatMsgs></div><div class=chat-typing id=chatTyping></div><div class=chat-locked id=chatLocked style="display:none">Chat en lecture seule</div><div class=chat-reply id=chatReply style="display:none"></div><div class=mentionpop id=mentionPop></div><div class=chat-in><button class=chat-attach id=chatAttach title="Joindre une image ou un PDF"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2.2 stroke-linecap=round><line x1=12 y1=6 x2=12 y2=18 /><line x1=6 y1=12 x2=18 y2=12 /></svg></button><input type=file id=chatFile accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" style="display:none"><div class=chat-field><input id=chatText placeholder="Écrire un message…" maxlength=2000 autocomplete=off><button id=chatSend title=Envoyer><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2.4 stroke-linecap=round stroke-linejoin=round><line x1=12 y1=20 x2=12 y2=6 /><polyline points="6 12 12 6 18 12" /></svg></button></div></div></div><div class=pres-pop id=presList></div><div class=emojipick id=emojiPick></div><button class=chatfab id=chatFab title="Discussion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg><span class=chatfab-badge id=chatFabBadge></span></button><div class=chatpeek id=chatPeek></div><div class=lmodal id=lModal><div class=lmodal-box><div class=lmodal-t id=lModalT>Confirmer ?</div><div class=lmodal-d id=lModalD></div><div class=lmodal-a><button class=lmodal-cancel id=lModalNo>Annuler</button><button class=lmodal-ok id=lModalYes>Confirmer</button></div></div></div>`;

// JS partagé : présence + chat via Supabase Realtime. Live.connect(slug, me) / Live.disconnect().
const LIVE_JS = `
var Live=(function(){
  var sb=null,ch=null,ME=null,SLUG=null,CONTROL=null,LOCKED=false,AUTHTOK=null,PRESENT=[],seen={},msgEls={},msgData={},replyCtx=null,typers={},pdfCache={},_tyT=0,_tyIv=0,_atIv=0,unread=0,autoOpened=false,_histDone=false,_phWired=false,_onMap=null,_onState=null,_peekT=0,MUTED=false;
  try{ MUTED=localStorage.getItem('3dd-present-mute')==='1'; }catch(e){}
  // Couper/rétablir les notifications du chat (cloche) : coupé = plus de ticker ni de pulse (badge silencieux gardé).
  function applyMute(){ var b=document.getElementById('chatMute'); if(b){b.classList.toggle('muted',MUTED);b.title=MUTED?'Réactiver les notifications du chat':'Couper les notifications du chat';} setBadge(); }
  function toggleMute(){ MUTED=!MUTED; try{ localStorage.setItem('3dd-present-mute',MUTED?'1':'0'); }catch(e){} if(MUTED)hidePeek(); applyMute(); }
  // Flèche « envoyer » : visible seulement si le champ contient du texte et qu'on peut poster.
  function toggleSend(){ var s=document.getElementById('chatSend'),t=document.getElementById('chatText'); if(!s||!t)return; var can=!(LOCKED&&!canMod()); s.classList.toggle('on', can && (t.value||'').trim().length>0); }
  function sendMap(p){try{if(ch)ch.send({type:'broadcast',event:'map',payload:p});}catch(e){}}
  function onMap(fn){_onMap=fn;}
  // État de la présentation diffusé par le présentateur — même canal que la carte. Sert à se
  // passer de la lecture anonyme des tables : l'audience n'a plus besoin de lire la ligne.
  function sendState(p){try{if(ch)ch.send({type:'broadcast',event:'state',payload:p});}catch(e){}}
  // CHAT EN DIFFUSION. Les messages arrivaient jusqu'ici par la lecture de TABLE en temps réel,
  // qui exige que cette table soit lisible publiquement — donc, avec la clé publiable, les
  // conversations de TOUTES les présentations, pas seulement la sienne. C'était le dernier
  // obstacle avant de pouvoir fermer cette lecture.
  // L'émetteur diffuse la ligne que le serveur vient d'écrire ; les autres l'ajoutent chez eux.
  // ⚠️ La diffusion ne revient pas à son émetteur : il ajoute donc SA copie lui-même.
  function sendMsg(m){if(!m)return;try{if(ch)ch.send({type:'broadcast',event:'msg',payload:m});}catch(e){}}
  function sendMsgUpd(m){if(!m)return;try{if(ch)ch.send({type:'broadcast',event:'msg-upd',payload:m});}catch(e){}}
  // Édition, suppression, réaction : le serveur renvoie la ligne à jour, on l'applique chez soi
  // puis on la diffuse. Même chemin pour les trois — une seule façon de se tromper.
  function majDiffusee(r){return r.json().then(function(d){if(d&&d.ok&&d.message){updateMsg(d.message);sendMsgUpd(d.message);}}).catch(function(){});}
  function onState(fn){_onState=fn;}
  // Badge « non lus » sur le bouton chat/FAB (panneau fermé) + pulse du FAB. Aperçu (ticker) au nouveau message.
  function chatHidden(){var pn=document.getElementById('chatPanel');return !pn||pn.classList.contains('hidden');}
  function setBadge(){var t=Player.live.unreadLabel(unread); ['chatBadge','chatFabBadge'].forEach(function(id){var b=document.getElementById(id);if(!b)return;if(unread>0){b.textContent=t;b.style.display='flex';}else{b.style.display='none';}}); var fab=document.getElementById('chatFab'); if(fab)fab.classList.toggle('unread',unread>0&&!MUTED);}
  function clearUnread(){unread=0;setBadge();}
  // Aperçu du dernier message : mini-bulle qui glisse au-dessus du FAB puis disparaît (~4s), tappable → ouvre.
  function showPeek(m){ var pk=document.getElementById('chatPeek'); if(!pk||!isOverlay())return; var nm=m.author_name||'Invité'; var bd=m.deleted?'Message supprimé':((m.body&&m.body.trim())||(m.attachment?'📎 Pièce jointe':'')); if(!bd)return; pk.innerHTML='<span class=peek-a>'+av(m.author_avatar,m.author_name)+'</span><span class=peek-b><b>'+esc(nm)+'</b><span class=peek-t>'+esc(bd.slice(0,90))+'</span></span>'; pk.classList.add('show'); clearTimeout(_peekT); _peekT=setTimeout(function(){pk.classList.remove('show');},4200); }
  function hidePeek(){ var pk=document.getElementById('chatPeek'); if(pk)pk.classList.remove('show'); clearTimeout(_peekT); }
  // Ouvre le chat. Sur mobile = bottom sheet (le document se cale en haut, le slide reste visible) ; on ne
  // met PAS le focus (le clavier couvrirait la feuille). Sur desktop = panneau latéral.
  function openChatPanel(){var pn=document.getElementById('chatPanel');if(!pn)return;var mob=isOverlay();hidePeek();pn.classList.remove('hidden');if(mob)document.body.classList.add('chat-open');clearUnread();var t=document.getElementById('chatText');if(t&&!mob)t.focus();var box=document.getElementById('chatMsgs');if(box)box.scrollTop=box.scrollHeight;if(window.__refit)setTimeout(window.__refit,mob?340:60);}
  function closeChatPanel(){var pn=document.getElementById('chatPanel');if(pn)pn.classList.add('hidden');document.body.classList.remove('chat-open');if(window.__refit)setTimeout(window.__refit,340);}
  // Nouveau message reçu, chat fermé : badge + pulse FAB + aperçu (ticker). Plus d'auto-ouverture (trop intrusif).
  function notifyMsg(m){if(!Player.live.shouldNotify({msg:m,me:ME,historyLoaded:_histDone,chatHidden:chatHidden()}))return;unread++;setBadge();if(!MUTED)showPeek(m);}
  var MYID=Math.random().toString(36).slice(2,9);
  function _store(){try{return window.localStorage;}catch(e){return null;}}
  // Clé d'assistance STABLE (analytics de présentation) : email si connu, sinon id persistant par navigateur.
  function attKey(me){ return Player.live.attendeeKey(me,_store(),MYID); }
  // Heartbeat d'assistance → le serveur journalise qui suit, combien de temps, et les pages vues (via la page
  // courante de la présentation). Envoyé à la connexion puis toutes les 25 s. Best-effort (silencieux).
  function sendAttend(){ if(!SLUG||!ME)return; try{ fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-attend',slug:SLUG,key:attKey(ME),name:ME.name||'',email:ME.email||'',avatar:ME.avatar||'',isMember:!!ME.member,isPresenter:ME.role==='presenter'})}); }catch(e){} }
  var EMOJIS=['👍','❤️','😂','😮','👏','🎉'];
  var RSVG='<svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><circle cx=12 cy=12 r=9 /><path d="M8.5 14.5s1.4 1.7 3.5 1.7 3.5-1.7 3.5-1.7"/><line x1=9 y1=9.2 x2=9.01 y2=9.2 /><line x1=15 y1=9.2 x2=15.01 y2=9.2 /></svg>';
  function esc(s){return Player.live.escapeHtml(s);}
  function ini(n){return Player.live.initials(n);}
  function av(u,n){return Player.live.avatarHtml(u,n);}
  function isOverlay(){var pn=document.getElementById('chatPanel');return !!(window.matchMedia&&window.matchMedia('(max-width:720px)').matches)||!!(pn&&pn.classList.contains('float'));}
  // Aplatit l'état de présence en DÉDOUBLONNANT par identité (email, sinon nom) → un participant reconnecté
  // (nouveau MYID) ou un fantôme websocket non nettoyé n'apparaît qu'une fois. On garde la méta présentateur si dispo.
  function flat(st){return Player.live.flattenPresence(st);}
  function reactorId(){return Player.live.reactorId(ME);}
  function authToken(){if(!AUTHTOK)AUTHTOK=Player.live.authorToken(_store());return AUTHTOK;}
  function mineOf(m){return Player.live.isMine(m,ME);}
  function canMod(){return Player.live.canModerate(ME);}
  function fmt(s){return Player.live.formatMessageBody(s);}
  function isMentioned(m){return Player.live.isMentioned(m,ME);}
  function renderPres(st){var l=flat(st),c=l.length;PRESENT=l;var e=document.getElementById('presCount');if(e)e.textContent=c;
    var a=document.getElementById('presAvs');if(a)a.innerHTML=l.slice(0,4).map(function(m){return '<span class=pres-av>'+av(m.avatar,m.name)+'</span>';}).join('');
    var p=document.getElementById('presList');if(p)p.innerHTML='<h5>'+c+' en ligne</h5>'+l.map(function(m){return '<div class=pres-item><span class=a>'+av(m.avatar,m.name)+'</span><span class=b><div class=n>'+esc(m.name||'Invité')+(m.role==='presenter'?' <span class=tag>présentateur</span>':'')+'</div>'+(m.email?'<div class=e>'+esc(m.email)+'</div>':'')+'</span></div>';}).join('');}
  // Rendu d'un message → player/src/chat.ts (échappement testé sous jsdom : on y vérifie ce que
  // le NAVIGATEUR fabrique, pas seulement la chaîne produite).
  function renderRe(m){return Player.chat.renderReactions(m,ME);}
  function renderMsgInner(m){return Player.chat.renderMessage(m,{me:ME,reactIcon:RSVG});}
  function cmClass(m){return Player.chat.messageClassName(m,ME,isMentioned(m));}
  function hydratePdf(d,m){if(m&&m.attachment&&m.attachment.kind==='pdf'&&!m.deleted){var ph=d.querySelector('.cm-att-ph');if(ph)pdfThumb(m.attachment.url,ph);}}
  function pdfThumb(url,ph){if(!ph)return;if(pdfCache[url]){ph.innerHTML='<img src="'+pdfCache[url]+'" alt="">';return;}if(!window.pdfjsLib)return;try{pdfjsLib.getDocument({url:url,isEvalSupported:false}).promise.then(function(pdf){return pdf.getPage(1);}).then(function(pg){var v0=pg.getViewport({scale:1}),sc=Math.min(1.6,208/v0.width),vp=pg.getViewport({scale:sc}),cv=document.createElement('canvas');cv.width=Math.ceil(vp.width);cv.height=Math.ceil(vp.height);return pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise.then(function(){var u=cv.toDataURL('image/jpeg',0.8);pdfCache[url]=u;ph.innerHTML='<img src="'+u+'" alt="">';});}).catch(function(){});}catch(e){}}
  // Renvoie true seulement si le message a réellement été AJOUTÉ. Pendant la transition, il
  // arrive par deux voies (diffusion et lecture de table) : sans cette réponse, l'affichage était
  // bien dédoublonné mais le compteur de non-lus comptait deux fois — une pastille à 2 pour un
  // seul message. Le dédoublonnage doit valoir pour tout ce qui suit l'arrivée, pas seulement
  // pour le rendu.
  function addMsg(m){if(m.id&&seen[m.id])return false;if(m.id)seen[m.id]=1;var box=document.getElementById('chatMsgs');if(!box)return;var em=box.querySelector('.chat-empty');if(em)em.remove();
    if(m.id)msgData[m.id]=m;
    var d=document.createElement('div');d.className=cmClass(m);if(m.id)d.setAttribute('data-id',m.id);
    d.innerHTML=renderMsgInner(m);
    if(m.id)msgEls[m.id]=d;box.appendChild(d);box.scrollTop=box.scrollHeight;hydratePdf(d,m);
    return true;}
  function updateMsg(m){if(!m.id)return;msgData[m.id]=m;var d=msgEls[m.id];if(!d)return;d.className=cmClass(m);d.innerHTML=renderMsgInner(m);hydratePdf(d,m);}
  function startEdit(id){var d=msgEls[id],m=msgData[id];if(!d||!m||m.deleted)return;var txt=d.querySelector('.txt');if(!txt)return;var inp=document.createElement('input');inp.className='cm-edit-in';inp.value=m.body||'';txt.replaceWith(inp);inp.focus();
    function fin(save){var v=(inp.value||'').trim();if(save&&v&&v!==m.body){fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-msg-edit',slug:SLUG,msgId:+id,authorToken:authToken(),body:v})}).then(majDiffusee).catch(function(){});}d.innerHTML=renderMsgInner(m);}
    inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();fin(true);}else if(e.key==='Escape'){fin(false);}});
    inp.addEventListener('blur',function(){fin(false);});}
  function delMsg(id){fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-msg-delete',slug:SLUG,msgId:+id,authorToken:authToken(),control:CONTROL})}).then(majDiffusee).catch(function(){});}
  // Modale de confirmation maison (l'iframe de présentation ne peut pas utiliser le useConfirm React). Repli window.confirm si absente.
  function confirmDialog(opts,onOk){opts=opts||{};var m=document.getElementById('lModal');if(!m){if(!onOk)return;if(window.confirm(opts.title||'Confirmer ?'))onOk();return;}
    var t=document.getElementById('lModalT'),d=document.getElementById('lModalD'),y=document.getElementById('lModalYes'),n=document.getElementById('lModalNo');
    if(t)t.textContent=opts.title||'Confirmer ?';if(d){d.textContent=opts.desc||'';d.style.display=opts.desc?'block':'none';}
    if(y)y.textContent=opts.ok||'Confirmer';
    function close(){m.classList.remove('open');if(y)y.onclick=null;if(n)n.onclick=null;m.onclick=null;document.removeEventListener('keydown',key);}
    function key(e){if(e.key==='Escape'){close();}else if(e.key==='Enter'){close();if(onOk)onOk();}}
    if(y)y.onclick=function(){close();if(onOk)onOk();};if(n)n.onclick=close;m.onclick=function(e){if(e.target===m)close();};
    document.addEventListener('keydown',key);m.classList.add('open');if(y)try{y.focus();}catch(e){}}
  function history(){fetch('/api/doc?present='+encodeURIComponent(SLUG)+'&chat=1').then(function(r){return r.json();}).then(function(d){var box=document.getElementById('chatMsgs');if(d&&d.messages&&d.messages.length){d.messages.forEach(function(m){addMsg(m);});}else if(box&&!box.children.length){box.innerHTML='<div class=chat-empty>Aucun message. Lancez la discussion.</div>';}if(d&&typeof d.locked!=='undefined')applyLock(d.locked);_histDone=true;}).catch(function(){_histDone=true;});}
  function react(id,e){if(!ME||!id||!e)return;fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-react',slug:SLUG,msgId:+id,emoji:e,reactor:reactorId()})}).then(majDiffusee).catch(function(){});}
  function setReply(id){var m=msgData[id];if(!m||m.deleted)return;var nm=m.author_name||'Invité';replyCtx={id:+id,name:nm,text:(m.body||'').slice(0,120)};var el=document.getElementById('chatReply');if(el){el.style.display='flex';el.innerHTML='<span class=cq><b>'+esc(nm)+'</b> '+esc((m.body||'').slice(0,80))+'</span><button id=chatReplyX title=Annuler>×</button>';var x=document.getElementById('chatReplyX');if(x)x.addEventListener('click',clearReply);}var t=document.getElementById('chatText');if(t)t.focus();}
  function clearReply(){replyCtx=null;var el=document.getElementById('chatReply');if(el){el.style.display='none';el.innerHTML='';}}
  function send(){var i=document.getElementById('chatText');var t=(i.value||'').trim();if(!t||!ME)return;if(LOCKED&&!canMod())return;i.value='';toggleSend();
    var o={action:'present-chat',slug:SLUG,name:ME.name,email:ME.email,avatar:ME.avatar,isPresenter:ME.role==='presenter',isMember:!!ME.member,body:t,authorToken:authToken()};
    if(CONTROL)o.control=CONTROL;
    if(replyCtx){o.replyTo=replyCtx.id;o.replyName=replyCtx.name;o.replyText=replyCtx.text;clearReply();}
    fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)})
      .then(function(r){return r.json();})
      .then(function(d){if(d&&d.ok&&d.message){addMsg(d.message);sendMsg(d.message);}})
      .catch(function(){});}
  function uploadFile(file){if(!file||!ME||!sb)return;if(LOCKED&&!canMod())return;
    if(file.size>10*1024*1024){alert('Fichier trop volumineux (max 10 Mo).');return;}
    var s=document.getElementById('chatSend');if(s){s.disabled=true;s.textContent='…';}
    function done(){if(s){s.disabled=(LOCKED&&!canMod());s.textContent='Envoyer';}}
    fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-upload-url',slug:SLUG,name:file.name,type:file.type})}).then(function(r){return r.json();}).then(function(d){
      if(!d||!d.ok||!d.token)throw 0;
      return sb.storage.from('present-attachments').uploadToSignedUrl(d.path,d.token,file).then(function(u){
        if(u&&u.error)throw 0;
        var i=document.getElementById('chatText'),cap=(i&&i.value||'').trim();if(i)i.value='';
        var o={action:'present-chat',slug:SLUG,name:ME.name,email:ME.email,avatar:ME.avatar,isPresenter:ME.role==='presenter',isMember:!!ME.member,body:cap,authorToken:authToken(),attachment:{url:d.publicUrl,name:file.name,type:file.type,kind:d.kind}};
        if(CONTROL)o.control=CONTROL;
        return fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)});
      });
    }).then(done).catch(function(){done();});}
  function applyLock(v){LOCKED=!!v;var t=document.getElementById('chatText'),s=document.getElementById('chatSend');var can=!LOCKED||canMod();if(t){t.disabled=!can;t.placeholder=can?'Écrire un message…':'Chat en lecture seule';}if(s)s.disabled=!can;var lk=document.getElementById('chatLockBtn');if(lk)lk.classList.toggle('on',LOCKED);var no=document.getElementById('chatLocked');if(no)no.style.display=(LOCKED&&!canMod())?'block':'none';toggleSend();}
  function toggleLock(){if(!canMod())return;var nv=!LOCKED;fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-chatlock',slug:SLUG,control:CONTROL,locked:nv})}).then(function(){applyLock(nv);try{if(ch)ch.send({type:'broadcast',event:'lock',payload:{locked:nv}});}catch(e){}}).catch(function(){});}
  function pingTyping(){var n=Date.now();if(n-_tyT<1600)return;_tyT=n;try{if(ch)ch.send({type:'broadcast',event:'typing',payload:{id:MYID,name:ME&&ME.name}});}catch(e){}}
  function onTyping(p){if(!p||p.id===MYID)return;typers[p.id]={name:p.name,t:Date.now()};renderTyping();}
  function renderTyping(){var el=document.getElementById('chatTyping');if(!el)return;var n=Date.now(),names=[];for(var k in typers){if(n-typers[k].t<4200)names.push(typers[k].name||'Quelqu\\'un');else delete typers[k];}el.textContent=names.length?(names.slice(0,2).join(', ')+(names.length>1?' écrivent…':' écrit…')):'';}
  function openPicker(btn,id){var p=document.getElementById('emojiPick');if(!p)return;p.__id=id;var r=btn.getBoundingClientRect();p.style.left=Math.max(8,Math.min(r.left-120,window.innerWidth-200))+'px';p.style.top=Math.max(8,r.top-44)+'px';p.classList.add('open');}
  function mentionCheck(){var t=document.getElementById('chatText'),pop=document.getElementById('mentionPop');if(!t||!pop)return;var pos=t.selectionStart||0,pre=t.value.slice(0,pos),mm=pre.match(/@([\\p{L}0-9_'.-]*)$/u);if(!mm){pop.classList.remove('open');return;}var q=(mm[1]||'').toLowerCase();var seenN={},uniq=[];(PRESENT||[]).forEach(function(p){if(!p.name)return;var k=p.name.toLowerCase();if(seenN[k]||(ME&&p.name===ME.name))return;if(q&&k.indexOf(q)<0)return;seenN[k]=1;uniq.push(p);});uniq=uniq.slice(0,6);if(!uniq.length){pop.classList.remove('open');return;}pop.__len=(mm[1]||'').length;pop.innerHTML=uniq.map(function(p,i){return '<button class="'+(i===0?'sel':'')+'" data-n="'+esc(p.name)+'"><span class=a>'+av(p.avatar,p.name)+'</span>'+esc(p.name)+'</button>';}).join('');pop.classList.add('open');}
  function pickMention(name){var t=document.getElementById('chatText'),pop=document.getElementById('mentionPop');if(!t)return;var pos=t.selectionStart||t.value.length,len=(pop&&pop.__len)||0,before=t.value.slice(0,pos-len-1),after=t.value.slice(pos),ins='@'+name+' ';t.value=before+ins+after;var np=before.length+ins.length;t.focus();try{t.setSelectionRange(np,np);}catch(e){}if(pop)pop.classList.remove('open');}
  function wire(){var s=document.getElementById('chatSend'),t=document.getElementById('chatText'),cb=document.getElementById('chatBtn'),cl=document.getElementById('chatClose'),pn=document.getElementById('chatPanel'),pb=document.getElementById('presBtn'),pp=document.getElementById('presList'),box=document.getElementById('chatMsgs'),pick=document.getElementById('emojiPick');
    if(s&&!s._w){s._w=1;s.addEventListener('click',send);
      t.addEventListener('keydown',function(e){var pop=document.getElementById('mentionPop'),open=pop&&pop.classList.contains('open');
        if(open&&(e.key==='Enter'||e.key==='Tab')){var b=pop.querySelector('button.sel')||pop.querySelector('button');if(b){e.preventDefault();pickMention(b.getAttribute('data-n'));return;}}
        if(open&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();var bs=pop.querySelectorAll('button'),si=-1,i;for(i=0;i<bs.length;i++)if(bs[i].classList.contains('sel'))si=i;if(si>=0)bs[si].classList.remove('sel');var ni=e.key==='ArrowDown'?(si+1)%bs.length:(si-1+bs.length)%bs.length;bs[ni].classList.add('sel');return;}
        if(open&&e.key==='Escape'){pop.classList.remove('open');return;}
        if(e.key==='Enter'){e.preventDefault();send();}});
      t.addEventListener('input',function(){pingTyping();mentionCheck();toggleSend();});}
    var mp=document.getElementById('mentionPop');
    if(mp&&!mp._w){mp._w=1;mp.addEventListener('mousedown',function(e){var b=e.target.closest?e.target.closest('button'):null;if(b){e.preventDefault();pickMention(b.getAttribute('data-n'));}});}
    var af=document.getElementById('chatAttach'),ff=document.getElementById('chatFile');
    if(af&&ff&&!af._w){af._w=1;af.addEventListener('click',function(){ff.click();});ff.addEventListener('change',function(){if(ff.files&&ff.files[0])uploadFile(ff.files[0]);ff.value='';});}
    if(cb&&!cb._w){cb._w=1;cb.addEventListener('click',function(){ if(pn.classList.contains('hidden'))openChatPanel(); else closeChatPanel(); });}
    if(cl&&!cl._w){cl._w=1;cl.addEventListener('click',closeChatPanel);}
    // Mobile : bouton flottant (FAB) pour ouvrir la feuille ; poignée pour la replier (tap ou swipe vers le bas).
    var fab=document.getElementById('chatFab'); if(fab&&!fab._w){fab._w=1;fab.addEventListener('click',openChatPanel);}
    var peek=document.getElementById('chatPeek'); if(peek&&!peek._w){peek._w=1;peek.addEventListener('click',openChatPanel);}
    var mute=document.getElementById('chatMute'); if(mute&&!mute._w){mute._w=1;mute.addEventListener('click',toggleMute);applyMute();}
    toggleSend();
    var grip=document.getElementById('chatGrip');
    if(grip&&!grip._w){grip._w=1; var _gy=0,_gd=0,_gdrag=false;
      grip.addEventListener('touchstart',function(e){ _gy=e.touches[0].clientY; _gd=0; _gdrag=true; pn.style.transition='none'; },{passive:true});
      grip.addEventListener('touchmove',function(e){ if(!_gdrag)return; _gd=Math.max(0,e.touches[0].clientY-_gy); pn.style.transform='translateY('+_gd+'px)'; },{passive:true});
      grip.addEventListener('touchend',function(){ if(!_gdrag)return; _gdrag=false; pn.style.transition=''; pn.style.transform=''; if(_gd>90||_gd<6) closeChatPanel(); });
      grip.addEventListener('click',function(){ if(!('ontouchstart' in window)) closeChatPanel(); }); // souris (desktop réduit) seulement
    }
    var dk=document.getElementById('chatDock');
    if(dk&&!dk._w){dk._w=1; try{ if(localStorage.getItem('3dd-chat-float')==='1') pn.classList.add('float'); }catch(e){}
      dk.addEventListener('click',function(){var f=pn.classList.toggle('float');try{localStorage.setItem('3dd-chat-float',f?'1':'0');}catch(e){} if(window.__refit) setTimeout(window.__refit,60);});}
    if(pb&&!pb._w){pb._w=1;pb.addEventListener('click',function(e){e.stopPropagation();pp.classList.toggle('open');});pp.addEventListener('click',function(e){e.stopPropagation();});document.addEventListener('click',function(){pp.classList.remove('open');});}
    // Actions sur les messages (délégation) : chip réaction, bouton réagir (picker), bouton répondre.
    if(box&&!box._w){box._w=1;box.addEventListener('click',function(e){
      var chip=e.target.closest?e.target.closest('.re-chip'):null;if(chip){var c1=chip.closest('.cm');if(c1)react(c1.getAttribute('data-id'),chip.getAttribute('data-e'));return;}
      var rb=e.target.closest?e.target.closest('.cm-react'):null;if(rb){var c2=rb.closest('.cm');if(c2)openPicker(rb,c2.getAttribute('data-id'));return;}
      var rp=e.target.closest?e.target.closest('.cm-reply'):null;if(rp){var c3=rp.closest('.cm');if(c3)setReply(c3.getAttribute('data-id'));return;}
      var ee=e.target.closest?e.target.closest('.cm-edit'):null;if(ee){var c4=ee.closest('.cm');if(c4)startEdit(c4.getAttribute('data-id'));return;}
      var dd=e.target.closest?e.target.closest('.cm-del-btn'):null;if(dd){var c5=dd.closest('.cm');if(c5)confirmDialog({title:'Supprimer ce message ?',desc:'Ce message sera retiré de la discussion pour tout le monde.',ok:'Supprimer'},function(){delMsg(c5.getAttribute('data-id'));});}
    });}
    var lb=document.getElementById('chatLockBtn');
    if(lb&&!lb._w){lb._w=1;if(canMod())lb.style.display='inline-flex';lb.addEventListener('click',toggleLock);}
    if(pick&&!pick._w){pick._w=1;pick.innerHTML=EMOJIS.map(function(e){return '<button data-e="'+e+'">'+e+'</button>';}).join('');
      pick.addEventListener('click',function(e){e.stopPropagation();var b=e.target.closest?e.target.closest('button'):null;if(b){react(pick.__id,b.getAttribute('data-e'));pick.classList.remove('open');}});
      document.addEventListener('click',function(){pick.classList.remove('open');});}}
  function connect(slug,me,control){if(!window.supabase||!LIVECFG.supaUrl||!LIVECFG.supaKey||!slug)return;SLUG=slug;ME=me;CONTROL=control||null;
    var pb=document.getElementById('presBtn');if(pb)pb.style.display='inline-flex';
    var cb=document.getElementById('chatBtn');if(cb)cb.style.display='inline-flex';var _fb=document.getElementById('chatFab');if(_fb)_fb.classList.add('on');
    wire();history();
    try{sb=window.supabase.createClient(LIVECFG.supaUrl,LIVECFG.supaKey,{realtime:{params:{eventsPerSecond:10}}});
      ch=sb.channel('plive-'+slug,{config:{presence:{key:(me.email||me.name||'x')+':'+MYID}}});
      ch.on('presence',{event:'sync'},function(){renderPres(ch.presenceState());});
      // Plus d'abonnement à la table des messages : elle n'est plus publiée ni lisible
      // publiquement. Tout passe par la diffusion, et l'historique par la route de chat.
      // ⚠️⚠️ TOUT CE BLOC VIT DANS UN TEMPLATE LITERAL : AUCUN BACKTICK, MÊME EN COMMENTAIRE.
      // Un seul termine la chaîne qui porte tout le script navigateur, et l'erreur remonte
      // ailleurs — « Unexpected token » sur une ligne qui n'a rien fait. Cinq fois sur ce fichier.
      // Le lint l'attrape à chaque fois ; ça coûte un aller-retour, pas une panne.
      //
      // ⚠️ UNE DIFFUSION EST UN SIGNAL, PAS UNE VÉRITÉ.
      //
      // Ce canal est PUBLIC : la clé publiable et le slug sont dans la page, donc tout participant
      // peut émettre. Appliquer directement la charge utile revenait à laisser n'importe quel
      // spectateur annoncer la fin de la présentation, changer la page affichée, verrouiller le
      // chat, ou publier un message signé du nom de quelqu'un d'autre.
      //
      // Déplacer l'émission vers le serveur n'y changerait rien : sur un canal public, un
      // attaquant émet quand même, et le client ne distingue pas les deux sources. La seule
      // défense qui tienne est de CESSER DE CROIRE le transport — on relit auprès du serveur, qui
      // est déjà la source de vérité (routes state=1 et chat=1, elles existaient).
      //
      // Un attaquant peut donc toujours émettre : il déclenche une relecture, et n'obtient rien.
      // C'est une meilleure propriété que d'essayer de l'empêcher — elle vaut aussi le jour où le
      // transport lui-même a un défaut.
      //
      // ⚠️ 'map' et 'typing' restent appliqués tels quels, et c'est un choix : ce sont des signaux
      // ÉPHÉMÈRES (mouvements de carte, « untel écrit »), sans état serveur à confronter et à
      // fréquence élevée. Les revérifier coûterait un aller-retour par déplacement de souris pour
      // protéger… un déplacement de souris. Ce qui fait autorité — la page affichée, le document,
      // la fin de la présentation — passe par 'state', qui est relu.
      function relire(url,applique){
        fetch('/api/doc?present='+encodeURIComponent(SLUG)+url)
          .then(function(r){return r.json();})
          .then(function(d){if(d&&d.ok)applique(d);})
          .catch(function(){});
      }
      var _relEtat=null,_relChat=null;
      // Groupé : dix diffusions d'affilée ne doivent pas produire dix requêtes.
      function relireEtat(){clearTimeout(_relEtat);_relEtat=setTimeout(function(){
        relire('&state=1',function(d){if(d.state&&_onState)_onState(d.state);});
      },120);}
      function relireChat(){clearTimeout(_relChat);_relChat=setTimeout(function(){
        relire('&chat=1',function(d){
          // ⚠️ NOTIFIER CE QUI VIENT D'ARRIVER, ET SEULEMENT ÇA. 'addMsg' rend faux pour un
          // message déjà connu — la relecture ramène tout l'historique, donc sans cette condition
          // la pastille de non-lus compterait chaque message à chaque relecture. Et sans l'appel,
          // elle ne compte plus rien : c'est la régression que le test d'un hôte a attrapée en
          // lisant le source de ce paquet, à travers la frontière de deux dépôts.
          if(d.messages)d.messages.forEach(function(m){if(addMsg(m))notifyMsg(m);else updateMsg(m);});
          if(typeof d.locked!=='undefined')applyLock(d.locked);
        });
      },120);}

      // Le message reçu sert à savoir QU'IL SE PASSE quelque chose, et à notifier ; son CONTENU
      // vient de la relecture. Sans ça, une notification pourrait afficher un texte forgé.
      ch.on('broadcast',{event:'msg'},function(){relireChat();});
      ch.on('broadcast',{event:'msg-upd'},function(){relireChat();});
      ch.on('broadcast',{event:'lock'},function(){relireChat();});
      ch.on('broadcast',{event:'state'},function(){relireEtat();});
      ch.on('broadcast',{event:'typing'},function(p){onTyping(p&&p.payload);});
      ch.on('broadcast',{event:'map'},function(p){if(_onMap&&p&&p.payload)_onMap(p.payload);});
      ch.subscribe(function(st){if(st==='SUBSCRIBED'){ch.track({name:me.name,email:me.email,avatar:me.avatar,role:me.role,member:!!me.member,uid:attKey(me)});sendAttend();}});
      _tyIv=setInterval(renderTyping,1500);
      _atIv=setInterval(sendAttend,25000);
      // Filet de sécurité : au déchargement de la page/iframe (fermeture, reload, switch), on retire la présence
      // → évite les fantômes (« je me vois deux fois » au retour). Une seule fois.
      if(!_phWired){_phWired=true;window.addEventListener('pagehide',function(){try{if(ch){ch.untrack();ch.unsubscribe();ch=null;}}catch(e){}});}
    }catch(e){}}
  function disconnect(){try{clearInterval(_tyIv);}catch(e){}try{clearInterval(_atIv);}catch(e){}try{sendAttend();}catch(e){}try{if(ch){ch.untrack();ch.unsubscribe();ch=null;}}catch(e){}var pb=document.getElementById('presBtn');if(pb)pb.style.display='none';var cb=document.getElementById('chatBtn');if(cb)cb.style.display='none';var _fb=document.getElementById('chatFab');if(_fb)_fb.classList.remove('on');var pn=document.getElementById('chatPanel');if(pn)pn.classList.add('hidden');}
  // Membre de l'équipe reconnu via la session app (MÊME ORIGINE, localStorage) → avatar + nom auto.
  function detectMember(){try{var raw=localStorage.getItem('3dd-supabase-auth');if(!raw)return null;var s=JSON.parse(raw);var u=s&&(s.user||(s.currentSession&&s.currentSession.user)||(s.session&&s.session.user));if(u&&u.email){var m=u.user_metadata||{};return{name:m.name||u.email,email:u.email,avatar:m.avatarUrl||'',member:true,role:'viewer'};}}catch(e){}return null;}
  return {connect:connect,disconnect:disconnect,detectMember:detectMember,sendMap:sendMap,onMap:onMap,sendState:sendState,onState:onState};
})();`;

// Mode « Carte live » : overlay Leaflet/OpenStreetMap partagé entre le présentateur (interactif : recherche,
// pan, zoom, marqueur) et l'audience (suit en direct). Position « posée » persistée via present-content (pour
// les arrivées tardives) ; mouvements fins diffusés via Live.sendMap (broadcast Realtime). Chargé à la demande.
const MAP_CSS = `
  #mapWrap{position:absolute;inset:0;z-index:20;display:none;background:#e9e5df}
  #mapWrap.on{display:block}
  #map3dd{position:absolute;inset:0;isolation:isolate}
  #svPano{position:absolute;inset:0;display:none;isolation:isolate}
  #mapWrap.sv #svPano{display:block}
  #mapWrap.sv #map3dd,#mapWrap.sv .map-search,#mapWrap.sv #mapSV,#mapWrap.sv .map-type{display:none!important}
  .map-sv{position:absolute;bottom:12px;left:12px;z-index:30;border:0;background:#1a1a1a;color:#fff;border-radius:999px;padding:9px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  .map-tomap{position:absolute;top:12px;left:12px;z-index:30;border:0;background:#fff;color:#1a1a1a;border-radius:999px;padding:9px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2)}
  .map-type{position:absolute;bottom:54px;left:12px;z-index:30;border:0;background:#fff;color:#1a1a1a;border-radius:999px;padding:8px 14px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2)}
  .lmain{position:relative}
  .map-search{position:absolute;top:12px;left:12px;z-index:30;width:min(360px,72%);background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.2);overflow:hidden}
  .map-search input{width:100%;border:0;padding:11px 14px;font:inherit;font-size:14px;outline:none;box-sizing:border-box}
  .map-res{max-height:240px;overflow:auto}
  .map-res button{display:block;width:100%;text-align:left;border:0;background:none;padding:9px 14px;font:inherit;font-size:12.5px;line-height:1.35;cursor:pointer;border-top:1px solid #eee;color:#1c1c1c}
  .map-res button:hover{background:#f3f1ec}
  .map-back{position:absolute;top:12px;right:12px;z-index:30;border:0;background:#1a1a1a;color:#fff;border-radius:999px;padding:9px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  .map-hint{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(26,26,26,.82);color:#fff;font-size:12px;padding:6px 13px;border-radius:999px;pointer-events:none}
  .leaflet-container{font:inherit}
`;
const MAP_MARKUP = `<div id=mapWrap><div id=map3dd></div><div id=svPano></div><div class=map-search id=mapSearch style="display:none"><input id=mapQ placeholder="Rechercher un lieu, une adresse…" autocomplete=off><div class=map-res id=mapRes></div></div><button class=map-type id=mapType style="display:none">🛰 Satellite</button><button class=map-sv id=mapSV style="display:none">Passer en Street View</button><button class=map-tomap id=mapToMap style="display:none">← Revenir à la carte</button><button class=map-back id=mapBack style="display:none">← Revenir au document</button><div class=map-hint id=mapHint></div></div>`;
const MAP_JS = `
var Map3DD=(function(){
  var map=null,marker=null,leafletLoading=false,isPres=false,persist=null,_bcT=0,_psT=0,mapType='roadmap';
  var pano=null,gLoading=false,_svBcT=0;
  var useG=!!GMAPS_KEY; // carte de base = Google Maps si une clé est fournie, sinon repli OpenStreetMap (Leaflet)
  function loadLeaflet(cb){ if(window.L){cb();return;} var iv=setInterval(function(){if(window.L){clearInterval(iv);cb();}},80);
    if(leafletLoading)return; leafletLoading=true;
    var css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(css);
    var s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';document.body.appendChild(s); }
  // Google Maps JS chargé à la demande, seulement si une clé est fournie (GMAPS_KEY).
  function loadGoogle(cb){ if(window.google&&window.google.maps){cb();return;} if(!GMAPS_KEY)return; var iv=setInterval(function(){if(window.google&&window.google.maps){clearInterval(iv);cb();}},120);
    if(gLoading)return; gLoading=true;
    var s=document.createElement('script');s.async=true;s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(GMAPS_KEY)+'&v=weekly&loading=async';document.body.appendChild(s); }
  function loadBase(cb){ if(useG)loadGoogle(cb); else loadLeaflet(cb); }
  function ensureMap(center,zoom){ if(map)return;
    if(useG){ var el=document.getElementById('map3dd'); if(!el||!window.google)return;
      var o=isPres?{center:{lat:center[0],lng:center[1]},zoom:zoom,mapTypeId:mapType,mapTypeControl:false,streetViewControl:true,fullscreenControl:false,clickableIcons:false,gestureHandling:'greedy'}
                  :{center:{lat:center[0],lng:center[1]},zoom:zoom,mapTypeId:mapType,disableDefaultUI:true,gestureHandling:'none',keyboardShortcuts:false,clickableIcons:false,zoomControl:false};
      map=new google.maps.Map(el,o);
      if(isPres){ map.addListener('center_changed',broadcast); map.addListener('zoom_changed',broadcast); map.addListener('idle',schedPersist); map.addListener('maptypeid_changed',function(){ mapType=map.getMapTypeId(); updateTypeBtn(); broadcast(); schedPersist(); });
        // Pegman (bonhomme jaune) : quand on le dépose, on récupère le point et on entre dans NOTRE Street View synchronisé.
        try{ var svp=map.getStreetView(); svp.addListener('visible_changed',function(){ if(svp.getVisible()){ var p=svp.getPosition(); svp.setVisible(false); if(p)goSV([p.lat(),p.lng()]); } }); }catch(e){}
      }
    } else {
      map=L.map('map3dd',{zoomControl:isPres,attributionControl:true,dragging:isPres,scrollWheelZoom:isPres,doubleClickZoom:isPres,boxZoom:isPres,keyboard:isPres,touchZoom:isPres}).setView(center,zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
      if(isPres){ map.on('move',broadcast); map.on('moveend',schedPersist); }
    } }
  function setMarker(ll){ if(useG){ if(!ll){ if(marker){marker.setMap(null);marker=null;} return; } var g={lat:ll[0],lng:ll[1]}; if(marker){marker.setPosition(g);} else if(map){marker=new google.maps.Marker({position:g,map:map});} }
    else { if(!ll){ if(marker&&map){map.removeLayer(marker);} marker=null; return; } if(marker){marker.setLatLng(ll);} else if(map){marker=L.marker(ll).addTo(map);} } }
  function state(){ if(!map)return null; if(useG){ var c=map.getCenter(); return {kind:'map',center:[c.lat(),c.lng()],zoom:map.getZoom(),marker:marker?[marker.getPosition().lat(),marker.getPosition().lng()]:null,mapType:map.getMapTypeId()}; }
    var c2=map.getCenter(); return {kind:'map',center:[c2.lat,c2.lng],zoom:map.getZoom(),marker:marker?[marker.getLatLng().lat,marker.getLatLng().lng]:null}; }
  function setCenterZoom(ll,z){ if(useG){ map.setCenter({lat:ll[0],lng:ll[1]}); map.setZoom(z); } else { map.setView(ll,z); } }
  function broadcast(){ var n=Date.now(); if(n-_bcT<100||!map)return; _bcT=n; var s=state(); if(s){try{ if(window.Live) Live.sendMap(s); }catch(e){}} }
  function schedPersist(){ clearTimeout(_psT); _psT=setTimeout(function(){ if(map&&persist)persist(state()); },700); }
  function enter(content,presenter,persistFn){ isPres=!!presenter; if(persistFn)persist=persistFn;
    if(content&&content.mapType)mapType=content.mapType;
    var wrap=document.getElementById('mapWrap'); var on=wrap&&wrap.classList.contains('on');
    if(wrap){wrap.classList.add('on');wrap.classList.remove('sv');}
    var sb2=document.getElementById('mapSearch'); if(sb2)sb2.style.display=isPres?'block':'none';
    var tb=document.getElementById('mapType'); if(tb)tb.style.display=(isPres&&useG)?'block':'none';
    var svb=document.getElementById('mapSV'); if(svb)svb.style.display=(isPres&&GMAPS_KEY)?'block':'none';
    var tm=document.getElementById('mapToMap'); if(tm)tm.style.display='none';
    var bk=document.getElementById('mapBack'); if(bk)bk.style.display=isPres?'block':'none';
    var hint=document.getElementById('mapHint'); if(hint)hint.textContent=isPres?'':'Vue du présentateur — en direct';
    if(isPres)wireControls(); // TOUJOURS câbler (recherche/satellite/SV) — même si la carte existe déjà, sinon la recherche ne marche pas.
    var center=(content&&content.center)||[46.6,2.5],zoom=(content&&content.zoom)||6;
    if(map&&on){ mapApply(content); if(isPres)updateTypeBtn(); return; }
    loadBase(function(){ ensureMap(center,zoom); if(useG){ setTimeout(function(){ if(map&&window.google)google.maps.event.trigger(map,'resize'); },160); } else { [60,300,700,1400].forEach(function(d){setTimeout(function(){if(map)map.invalidateSize();},d);}); } mapApply(content); if(isPres)updateTypeBtn(); }); }
  function exit(){ var wrap=document.getElementById('mapWrap'); if(wrap){wrap.classList.remove('on');wrap.classList.remove('sv');} }
  function mapApply(p){ if(!map||!p)return; if(useG){ if(p.center)map.setCenter({lat:p.center[0],lng:p.center[1]}); if(typeof p.zoom!=='undefined')map.setZoom(p.zoom); if(p.mapType&&p.mapType!==map.getMapTypeId())map.setMapTypeId(p.mapType); if(typeof p.marker!=='undefined')setMarker(p.marker); }
    else { if(p.center)map.setView(p.center,p.zoom||map.getZoom(),{animate:false}); if(typeof p.marker!=='undefined')setMarker(p.marker); } }
  // Routeur des broadcasts live : carte OU street view selon le kind.
  function apply(p){ if(!p)return; if(p.kind==='streetview')svApply(p); else mapApply(p); }
  // Bascule plan / satellite / hybride (Google) : diffusée à l'audience.
  function cycleType(){ if(!map||!useG)return; var next=Player.presentation.cycleMapType(map.getMapTypeId()); map.setMapTypeId(next); mapType=next; updateTypeBtn(); broadcast(); schedPersist(); }
  function updateTypeBtn(){ var b=document.getElementById('mapType'); if(!b)return; var t=(map&&useG)?map.getMapTypeId():'roadmap'; b.textContent=Player.presentation.mapTypeLabel(t); }
  function wireControls(){ var q=document.getElementById('mapQ'),res=document.getElementById('mapRes');
    if(q&&!q._w){q._w=1; q.addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();clearTimeout(q._st);doSearch(q.value);} });
      // Suggestions pendant la frappe (debounce) — dès 3 caractères, sans attendre Entrée.
      q.addEventListener('input',function(){ clearTimeout(q._st); var v=q.value; if(v.trim().length<3){ if(res)res.innerHTML=''; return; } q._st=setTimeout(function(){ doSearch(v); },260); });
      if(res)res.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b||!map)return;var lat=+b.getAttribute('data-lat'),lng=+b.getAttribute('data-lng');setCenterZoom([lat,lng],16);setMarker([lat,lng]);res.innerHTML='';q.value=b.textContent;broadcast();schedPersist();}); }
    var tb=document.getElementById('mapType'); if(tb&&!tb._w){tb._w=1;tb.addEventListener('click',cycleType);}
    var svb=document.getElementById('mapSV'); if(svb&&!svb._w){svb._w=1;svb.addEventListener('click',function(){ if(!map)return; var c=useG?[map.getCenter().lat(),map.getCenter().lng()]:[map.getCenter().lat,map.getCenter().lng]; goSV(c); });}
    var tm=document.getElementById('mapToMap'); if(tm&&!tm._w){tm._w=1;tm.addEventListener('click',toMap);} }
  function doSearch(text){ text=(text||'').trim(); var res=document.getElementById('mapRes'); if(!text||!res)return; res.innerHTML='<div style="padding:9px 14px;color:#888;font-size:12px">Recherche…</div>';
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q='+encodeURIComponent(text),{headers:{Accept:'application/json'}}).then(function(r){return r.json();}).then(function(l){ if(!l||!l.length){res.innerHTML='<div style="padding:9px 14px;color:#888;font-size:12px">Aucun résultat.</div>';return;} res.innerHTML=l.map(function(o){return '<button data-lat="'+o.lat+'" data-lng="'+o.lon+'">'+String(o.display_name||'').replace(/</g,'&lt;')+'</button>';}).join(''); }).catch(function(){res.innerHTML='<div style="padding:9px 14px;color:#c0392b;font-size:12px">Recherche indisponible.</div>';}); }
  // ── Street View (Google) ─────────────────────────────────────────────────────────────────────────
  function tempHint(t){ var h=document.getElementById('mapHint'); if(h){h.textContent=t; setTimeout(function(){ if(h.textContent===t)h.textContent=(isPres?'':'Vue du présentateur — en direct'); },2600);} }
  // Le présentateur passe en Street View depuis le centre de la carte : on cherche le panorama le plus proche.
  function goSV(center){ if(!GMAPS_KEY){tempHint('Street View indisponible.');return;} tempHint('Recherche Street View…');
    loadGoogle(function(){ try{ new google.maps.StreetViewService().getPanorama({location:{lat:center[0],lng:center[1]},radius:80},function(data,status){ if(status==='OK'&&data&&data.location){ var ll=data.location.latLng; var content={kind:'streetview',position:[ll.lat(),ll.lng()],pov:{heading:0,pitch:0},zoom:1}; if(persist)persist(content); enterSV(content,true,persist); } else { tempHint('Pas de Street View à cet endroit.'); } }); }catch(e){ tempHint('Street View indisponible.'); } }); }
  function svState(){ if(!pano)return null; var p=pano.getPosition(),v=pano.getPov(); if(!p)return null; return {kind:'streetview',position:[p.lat(),p.lng()],pov:{heading:v.heading,pitch:v.pitch},zoom:pano.getZoom()}; }
  function svBcast(){ var n=Date.now(); if(n-_svBcT<120)return; _svBcT=n; var s=svState(); if(!s)return; try{ if(window.Live)Live.sendMap(s); }catch(e){} clearTimeout(_psT); _psT=setTimeout(function(){ if(persist&&pano)persist(svState()); },800); }
  function svApply(p){ if(!pano||!p)return; try{ if(p.position)pano.setPosition({lat:p.position[0],lng:p.position[1]}); if(p.pov)pano.setPov({heading:p.pov.heading||0,pitch:p.pov.pitch||0}); if(typeof p.zoom!=='undefined')pano.setZoom(p.zoom); }catch(e){} }
  function ensurePano(content){ var el=document.getElementById('svPano'); if(!el||!window.google||!window.google.maps)return;
    var pos=content&&content.position?{lat:content.position[0],lng:content.position[1]}:{lat:48.8584,lng:2.2945};
    var pov=content&&content.pov?content.pov:{heading:0,pitch:0}, zoom=(content&&content.zoom)||1;
    if(pano){ return; }
    var opts=isPres
      ?{position:pos,pov:pov,zoom:zoom,addressControl:false,fullscreenControl:false,motionTracking:false,motionTrackingControl:false,showRoadLabels:true}
      :{position:pos,pov:pov,zoom:zoom,disableDefaultUI:true,clickToGo:false,scrollwheel:false,linksControl:false,panControl:false,zoomControl:false,addressControl:false,fullscreenControl:false,motionTracking:false,motionTrackingControl:false,showRoadLabels:false};
    pano=new google.maps.StreetViewPanorama(el,opts);
    if(isPres){ pano.addListener('position_changed',svBcast); pano.addListener('pov_changed',svBcast); pano.addListener('zoom_changed',svBcast); } }
  function enterSV(content,presenter,persistFn){ isPres=!!presenter; if(persistFn)persist=persistFn;
    var wrap=document.getElementById('mapWrap'); if(wrap){wrap.classList.add('on');wrap.classList.add('sv');}
    var tm=document.getElementById('mapToMap'); if(tm)tm.style.display=isPres?'block':'none';
    var bk=document.getElementById('mapBack'); if(bk)bk.style.display=isPres?'block':'none';
    var hint=document.getElementById('mapHint'); if(hint)hint.textContent=isPres?'':'Vue du présentateur — Street View en direct';
    loadGoogle(function(){ ensurePano(content); svApply(content); if(isPres)wireControls(); }); }
  // Retour à la carte (présentateur) : on repasse en mode carte et on persiste l'état carte.
  function toMap(){ var wrap=document.getElementById('mapWrap'); if(wrap)wrap.classList.remove('sv'); var st=map?state():Player.presentation.initialMapContent(); enter(st,true,persist); if(persist)persist(st); }
  return {enter:enter,enterSV:enterSV,exit:exit,apply:apply,state:function(){return map?state():null;}};
})();`;

const BOT_CSS = `
  /* Doc + chat côte à côte (ces styles ne vivent sinon que dans LIVE_CSS, réservé au mode présentation). */
  .lrow{flex:1;display:flex;min-height:0;position:relative}
  .lmain{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
  .botc{flex:none;width:360px;max-width:40vw;display:flex;flex-direction:column;background:#faf8f4;color:#1a1a1a;border-left:1px solid #0002}
  .botc.min{display:none}
  .botc-h{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #0001;background:#fff}
  .botc-av{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:var(--bacc,#15130f);color:#fff;font-size:14px;flex:none;font-weight:800;overflow:hidden}
  .botc-av img,.botc-fab img{width:100%;height:100%;object-fit:cover;border-radius:50%}
  /* Rangée bot : mini-avatar du profil + bulle (pattern messagerie moderne). L'historique restauré est atténué. */
  .botc-brow{display:flex;gap:7px;align-items:flex-end}
  .botc-brow .botc-msg.bot{max-width:100%}
  .botc-mav{flex:none;width:22px;height:22px;border-radius:50%;background:var(--bacc,#15130f);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .botc-mav img{width:100%;height:100%;object-fit:cover}
  .botc-brow.old,.botc-msg.old{opacity:.55}
  .botc-div{display:flex;align-items:center;gap:10px;color:#a89f90;font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin:4px 0;white-space:nowrap}
  .botc-div::before,.botc-div::after{content:"";flex:1;height:1px;background:#e5dfd4}
  .botc-h b{font-size:13.5px;display:block;line-height:1.2}
  .botc-sub{font-size:11px;color:#8a857c}
  .botc-min{margin-left:auto;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:17px;line-height:0}
  .botc-min:hover{background:#e2e0da}
  .botc-voice{margin-left:auto;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;line-height:0;display:inline-flex;align-items:center;justify-content:center}
  .botc-voice svg{width:16px;height:16px}
  .botc-voice+.botc-min{margin-left:6px}
  .botc-voice:hover{background:#e2e0da}
  .botc-voice.on{background:var(--bacc,#15130f);color:#fff}
  .botc-voice.on.playing{animation:botcVoicePulse 1.4s ease-in-out infinite}
  @keyframes botcVoicePulse{0%,100%{box-shadow:0 0 0 0 rgba(0,0,0,.18)}50%{box-shadow:0 0 0 5px rgba(0,0,0,0)}}
  #botpVoice.on{background:var(--bacc,#15130f);color:#fff}
  .botc-msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:9px}
  /* CRITIQUE : dans une colonne flex qui défile, les enfants se COMPRESSENT (flex-shrink:1 par défaut) avant
     que le scroll ne joue → bulles écrasées/chevauchées, vignettes rognées en bandeau. Interdit. */
  .botc-msgs>*{flex:none}
  .botc-msg{max-width:88%;padding:9px 13px;border-radius:15px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;animation:botmsg .26s cubic-bezier(.22,1,.36,1)}
  .botc-msg.bot{align-self:flex-start;background:#fff;border:1px solid #ece8e1;border-bottom-left-radius:5px}
  .botc-msg.user{align-self:flex-end;background:#15130f;color:#fff;border-bottom-right-radius:5px}
  @keyframes botmsg{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
  .botc-cursor{display:inline-block;width:2px;height:1em;background:#15130f;margin-left:1px;vertical-align:-2px;animation:botcur .8s steps(1) infinite}
  @keyframes botcur{0%,50%{opacity:1}51%,100%{opacity:0}}
  .botc-typing{align-self:flex-start;display:flex;gap:5px;padding:11px 14px;background:#fff;border:1px solid #ece8e1;border-radius:15px;border-bottom-left-radius:5px}
  .botc-typing i{width:7px;height:7px;border-radius:50%;background:#c0b9ac;animation:botdot 1.15s infinite}
  .botc-typing i:nth-child(2){animation-delay:.16s}
  .botc-typing i:nth-child(3){animation-delay:.32s}
  @keyframes botdot{0%,62%,100%{transform:translateY(0);opacity:.45}31%{transform:translateY(-5px);opacity:1}}
  /* Mode « présentation guidée » : le prospect ne défile pas, le bot pilote (overflow programmatique OK). */
  body.botlock .scroll{overflow:hidden}
  body.botlock .scroll{scrollbar-width:none}
  body.botlock .scroll::-webkit-scrollbar{display:none}
  /* Mode « une seule page » : une page plein cadre, centrée, aucune page suivante ne dépasse. Le bot (ou les
     flèches) tournent les pages. On sort de ce mode dès que le prospect passe en découverte autonome. */
  body.onepage .scroll{overflow:hidden}
  body.onepage #pages{height:100%;display:flex;align-items:center;justify-content:center;padding:0}

  body.onepage #pages .page{display:none;margin:0}
  body.onepage #pages .page.cur{display:block;box-shadow:0 6px 34px rgba(0,0,0,.16)}
  /* Transition de page sobre en mode guidé/lecture (glissé directionnel ~0,28 s). Exclut le player mobile
     (rythme rapide). Activable/désactivable via .botanim (CFG.botAnim, défaut ON — param profil futur). */
  @keyframes pgInF{from{opacity:.25;transform:translateX(22px)}to{opacity:1;transform:none}}
  @keyframes pgInB{from{opacity:.25;transform:translateX(-22px)}to{opacity:1;transform:none}}
  body.botanim.onepage:not(.botplayer) #pages .page.cur{animation:pgInF .28s cubic-bezier(.22,1,.36,1)}
  body.botanim.onepage.pgback:not(.botplayer) #pages .page.cur{animation:pgInB .28s cubic-bezier(.22,1,.36,1)}
  @media(prefers-reduced-motion:reduce){ body.botanim.onepage #pages .page.cur{animation:none} }
  body.onepage .textLayer{display:none}
  .op-arrow{display:none;position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:0;background:#15130fcc;color:#fff;font-size:24px;line-height:0;cursor:pointer;z-index:12;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.28);transition:background .15s,opacity .15s}
  .op-arrow:hover{background:#15130f}
  .op-arrow:disabled{opacity:.28;cursor:default}
  .dkov{display:none;position:absolute;inset:0;z-index:14;background:rgba(10,9,7,.52);backdrop-filter:blur(3px);align-items:center;justify-content:center;cursor:pointer}
  body.deskpaused .dkov{display:flex}
  .dkov-card{display:flex;flex-direction:column;align-items:center;gap:16px;cursor:default;animation:dkovin .28s cubic-bezier(.22,1,.36,1)}
  @keyframes dkovin{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
  .dkov-big{width:78px;height:78px;border-radius:50%;border:0;background:#fff;color:#15130f;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 44px rgba(0,0,0,.5);transition:transform .15s}
  .dkov-big:hover{transform:scale(1.12);box-shadow:0 18px 54px rgba(0,0,0,.6),0 0 0 7px rgba(255,255,255,.28)}
  .dkov-big svg{width:30px;height:30px}
  .dkov-opts{display:flex;flex-direction:column;gap:9px;min-width:330px}
  .dkov-opts button{position:relative;overflow:hidden;display:flex;align-items:center;gap:13px;border:0;border-radius:12px;background:rgba(250,248,244,.94);color:#1a1a1a;font:inherit;font-size:14px;font-weight:600;padding:12px 18px;cursor:pointer;text-align:left;transition:background .18s,transform .28s cubic-bezier(.34,1.56,.64,1),box-shadow .28s}
  .dkov-opts button:hover{background:#fff;transform:translateY(-2px) scale(1.015);box-shadow:0 10px 26px rgba(0,0,0,.22)}
  .dkov-opts button:active{transform:translateY(0) scale(.985);transition-duration:.08s}
  /* Reflet balayé : une lame de lumière traverse le bouton au survol (désactivé si mouvement réduit). */
  .dkov-opts button::after{content:"";position:absolute;top:0;bottom:0;left:-70%;width:46%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.5),transparent);transform:skewX(-18deg);opacity:0;pointer-events:none}
  .dkov-opts button:hover::after{animation:dk-sheen .7s ease forwards}
  @keyframes dk-sheen{from{left:-70%;opacity:1}to{left:120%;opacity:0}}
  .dkov-opts button svg{width:19px;height:19px;flex:none;opacity:.85;transition:transform .28s cubic-bezier(.34,1.56,.64,1),opacity .18s}
  .dkov-opts button:hover svg{transform:translateX(3px) scale(1.12);opacity:1}
  .dkov-opts button.primary{background:#15130f;color:#fff}
  .dkov-opts button.primary:hover{background:#000;box-shadow:0 12px 30px rgba(0,0,0,.4)}
  .dkov-opts button.primary::after{background:linear-gradient(105deg,transparent,rgba(255,255,255,.22),transparent)}
  @media (prefers-reduced-motion: reduce){ .dkov-opts button,.dkov-opts button svg{transition:none} .dkov-opts button:hover{transform:none} .dkov-opts button:hover::after{animation:none} }
  .dkov-opts button.ghost{background:none;border:1.5px solid rgba(255,255,255,.38);color:#f1efe9;font-weight:600;font-size:13px;justify-content:center;padding:9px 18px;margin-top:2px}
  .dkov-opts button.ghost svg{width:16px;height:16px;opacity:.7}
  .dkov-opts button.ghost:hover{background:rgba(255,255,255,.12);transform:none}
  .kw{opacity:.45;display:inline-block;border-radius:5px;transition:opacity .18s,background-color .18s,color .18s,transform .18s}
  .kw.on{opacity:1}
  .kw.cur{opacity:1;background:color-mix(in srgb,currentColor 15%,transparent);box-shadow:0 1.8px 0 0 currentColor;padding:1px 3px;margin:-1px -3px}
  /* FOCUS (façon Captions) : le mot courant saute aux yeux — pilule accent pleine, texte inversé, léger zoom */
  .ks-focus .kw{opacity:.35}
  .ks-focus .kw.on{opacity:.92}
  .ks-focus .kw.cur{opacity:1;background:var(--bacc,#15130f);color:#fff;box-shadow:none;padding:1px 6px;margin:-1px -3px;border-radius:7px;transform:scale(1.07)}
  /* ENCRE : les mots lus se teintent à la couleur de l'agent (remplissage progressif) */
  .ks-fill .kw{opacity:.38}
  .ks-fill .kw.on{opacity:1;color:var(--bacc,#15130f)}
  .ks-fill .kw.cur{opacity:1;color:var(--bacc,#15130f);background:none;box-shadow:0 1.8px 0 0 currentColor;padding:0;margin:0}
  /* SOULIGNÉ : sobre — texte toujours lisible, seul un trait accent suit la voix */
  .ks-underline .kw{opacity:.86}
  .ks-underline .kw.on{opacity:1}
  .ks-underline .kw.cur{opacity:1;background:none;box-shadow:0 2px 0 0 var(--bacc,#15130f);padding:0;margin:0}
  .botc-kstyle{display:none;margin-left:6px;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:800;align-items:center;justify-content:center;line-height:0}
  body.deskpresent .botc-kstyle{display:inline-flex}
  .botc-kstyle:hover{background:#e2e0da}
  .botc-cc{display:none;margin-left:6px;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;line-height:0;align-items:center;justify-content:center}
  body.deskpresent .botc-cc{display:inline-flex}
  .botc-cc svg{width:15px;height:15px}
  .botc-cc:hover{background:#e2e0da}
  body.deskcap .botc-cc{background:var(--bacc,#15130f);color:#fff}
  /* Présentateur vidéo — WEBCAM flottante desktop (façon streamer/visio : le doc reste le héros). */
  .vpan{display:none;position:fixed;bottom:132px;width:min(300px,24vw);aspect-ratio:1/1;z-index:14;background:#0d0c0a;overflow:hidden;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.10);transition:opacity .3s}
  body.vside.deskpresent .vpan{display:block}
  body.vside-r .vpan{right:24px} body.vside-l .vpan{left:24px}
  .vpan img,.vpan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .vpan video{display:none} .vpan.playing video{display:block}
  body.vside .dcap-av{display:none} /* la webcam remplace la pastille du bandeau */
  body.vside.deskpaused .vpan{opacity:.25} /* le hub de pause reprend la scène */
  /* Mobile ÉCRAN PARTAGÉ v2 : doc en haut, l'agent en PLEIN CADRE en bas, sous-titres pleine largeur. */
  .vpanm{display:none;position:fixed;left:0;right:0;bottom:0;height:38vh;z-index:31;background:#0d0c0a;overflow:hidden}
  body.vsplit .vpanm{display:block}
  .vpanm img,.vpanm video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 22%}
  .vpanm video{display:none} .vpanm.playing video{display:block}
  .vpanm::after{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.66));pointer-events:none}
  body.vsplit .botp-cap{left:10px;right:10px;bottom:10px;margin:0;border-radius:0;background:none;backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none;padding:0;z-index:32}
  body.vsplit .pcap-k{font-size:28px}
  body.vsplit .botp-ctl{bottom:calc(38vh + 10px)}
  body.vsplit .botp-prog i{}
  body.vsplit .botp-cap:empty{display:none}
  .botw-note{font-size:11.5px;color:#8a867e;margin:2px 2px 0;text-align:center}
  .langov{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,9,7,.26);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);opacity:0;pointer-events:none;transition:opacity .25s}
  .langov.on{opacity:1;pointer-events:auto}
  .langov-card{display:flex;align-items:center;gap:12px;padding:14px 24px;border-radius:999px;background:rgba(30,27,22,.9);backdrop-filter:blur(16px) saturate(1.2);-webkit-backdrop-filter:blur(16px) saturate(1.2);color:#fff;font-weight:650;font-size:14.5px;letter-spacing:.01em;box-shadow:0 18px 50px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14)}
  .langov-spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:lo-rot .7s linear infinite;flex:none}
  @keyframes lo-rot{to{transform:rotate(360deg)}}
  body.light .langov{background:rgba(247,245,241,.32)}
  body.light .langov-card{background:rgba(247,245,241,.94);color:#15130f;border-color:rgba(0,0,0,.08);box-shadow:0 18px 50px rgba(0,0,0,.16)}
  body.light .langov-spin{border-color:rgba(0,0,0,.18);border-top-color:#15130f}
  .dcap{display:none;position:absolute;left:50%;bottom:26px;transform:translateX(-50%);width:min(1080px,calc(100% - 190px));z-index:13;align-items:center;gap:15px}
  body.deskcap.deskpresent .dcap{display:flex}
  .dcap-av{flex:none;width:58px;height:58px;border-radius:50%;overflow:hidden;background:#e6e2db;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;color:#555;box-shadow:0 0 0 3px rgba(255,255,255,.55),0 6px 18px rgba(0,0,0,.4);position:relative;transition:width .3s ease,height .3s ease}
  body.clipon .dcap-av{width:114px;height:114px}
  .dcap-av video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;background:#e6e2db}
  .dcap-av img{width:100%;height:100%;object-fit:cover}
  .dcap-body{--bacc:#fff;flex:1;min-width:0;background:rgba(12,10,8,.86);backdrop-filter:blur(8px);color:#fff;border-radius:20px;padding:16px 26px;box-shadow:0 18px 52px rgba(0,0,0,.45);font-size:clamp(20px,2vw,28px);line-height:1.45;font-weight:700}
  #dcapT{text-align:left;min-height:1.45em}
  #dcapT .kw{animation:dcapw .18s ease;transition:opacity .15s} /* pas de transition couleur/fond dans le bandeau (états fantômes) */
  @keyframes dcapw{from{opacity:0;transform:translateY(5px)}to{}}
  /* FOCUS dans le bandeau : pilule INVERSÉE lisible quel que soit le thème */
  .dcap-body .ks-focus .kw.cur{background:#fff;color:#15130f}
  body.light .dcap-body .ks-focus .kw.cur{background:#15130f;color:#fff}
  body.light .dcap-body{background:rgba(255,255,255,.95);color:#15130f;--bacc:#15130f;box-shadow:0 18px 52px rgba(0,0,0,.16)}
  body.botplayer .dcap,body.botplayer .dkov{display:none !important} /* le PLAYER mobile a ses propres surfaces ; une fenêtre desktop RÉTRÉCIE garde bandeau + hub */
  .rateov{display:none;position:absolute;inset:0;z-index:16;background:rgba(10,9,7,.48);backdrop-filter:blur(4px);align-items:center;justify-content:center}
  .rateov.on{display:flex}
  .rate-card{position:relative;background:#faf8f4;color:#1a1a1a;border-radius:20px;padding:28px 42px 24px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:dkovin .28s cubic-bezier(.22,1,.36,1)}
  .rate-card b{font-size:19px}
  .rate-card p{margin:6px 0 16px;font-size:13.5px;color:#6b665e}
  .rate-x{position:absolute;top:10px;right:10px;border:0;background:none;color:#a39d92;cursor:pointer;line-height:0;padding:6px}
  .rate-x svg{width:15px;height:15px}
  .rate-stars{display:flex;gap:9px;justify-content:center}
  .rate-stars button{border:0;background:none;cursor:pointer;padding:2px;line-height:0;transition:transform .12s}
  .rate-stars button:hover{transform:scale(1.18)}
  .rate-stars svg{width:42px;height:42px;fill:none;stroke:#cfc8ba;stroke-width:1.5;transition:fill .12s,stroke .12s}
  .rate-stars button.on svg{fill:#f6b301;stroke:#e3a300}
  .rate-thx{display:none;font-size:15.5px;font-weight:700;padding:10px 0 4px}
  .rateov.done .rate-stars,.rateov.done .rate-card p{display:none}
  .rateov.done .rate-thx{display:block}
  .rateov.rated .rate-card>p{display:none}
  .rate-cmt{display:none;flex-direction:column;gap:8px;margin-top:14px;width:min(340px,72vw);text-align:left}
  .rateov.rated .rate-cmt{display:flex}
  .rateov.done .rate-cmt{display:none}
  .rate-cmt .rc-t{margin:0;font-size:13.5px;font-weight:700}
  .rate-cmt .rc-t span{font-weight:500;color:#8a8478}
  .rate-cmt textarea{border:1.5px solid #ddd6c8;border-radius:12px;padding:9px 11px;font:inherit;font-size:13.5px;line-height:1.45;resize:none;background:#fff;color:#1a1a1a}
  .rate-cmt textarea:focus{outline:none;border-color:#b7ad99}
  .rc-btns{display:flex;gap:8px;justify-content:flex-end}
  .rc-btns button{border:0;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}
  .rc-skip{background:none;color:#8a8478}
  .rc-go{background:#15130f;color:#fff}
  /* Carte centrée (mode barre) : questions, coordonnées et créneaux restent SUR le document — sous le
     bandeau de Léa (z-index), le regard ne repart pas vers le panneau. */
  .qov{display:none;position:absolute;inset:0;z-index:12;background:rgba(10,9,7,.42);backdrop-filter:blur(3px);align-items:center;justify-content:center;padding-bottom:140px}
  .qov.on{display:flex}
  .qov-card{background:#faf8f4;color:#1a1a1a;border-radius:20px;padding:22px 24px;width:min(430px,86vw);box-shadow:0 24px 70px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:9px;animation:dkovin .28s cubic-bezier(.22,1,.36,1)}
  .qov-msg{font-size:14.5px;line-height:1.5;margin-bottom:3px}
  .qov-opt{display:block;width:100%;text-align:left;border:1.5px solid #ddd6c8;background:#fff;border-radius:12px;padding:11px 14px;font:inherit;font-size:14px;font-weight:600;color:#1a1a1a;cursor:pointer;transition:border-color .12s,background .12s}
  .qov-opt:hover{border-color:#b7ad99;background:#fbf9f4}
  .qov-opt.other{color:#6b665e;font-weight:500}
  .has-ic svg{width:15px;height:15px;vertical-align:-2.5px;margin-right:3px;opacity:.8}
  .qov-card .botc-form{box-shadow:none;border-color:#ddd6c8;padding:0;border:0;background:none}
  /* Page MERCI : le document se floute, l'avatar de l'assistant au centre, un merci — rien d'autre. */
  .byeov{display:none;position:absolute;inset:0;z-index:60;background:rgba(14,12,9,.42);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);align-items:center;justify-content:center}
  .byeov.on{display:flex}
  body.light .byeov{background:rgba(238,235,229,.55)}
  .bye-card{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;animation:dkovin .4s cubic-bezier(.22,1,.36,1)}
  .bye-av{width:92px;height:92px;border-radius:50%;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.35);border:4px solid rgba(255,255,255,.85)}
  .bye-av img{width:100%;height:100%;object-fit:cover}
  .bye-card b{font-size:30px;letter-spacing:-.02em;color:#fff;margin-top:6px}
  .bye-card p{margin:0;font-size:15px;color:rgba(255,255,255,.82);font-weight:600}
  body.light .bye-card b{color:#15130f}
  body.light .bye-card p{color:#5b564d}
  body.botplayer .qov{display:none !important}
  @media(max-width:820px){.rateov{display:none !important}}
  body.onepage .op-arrow{display:flex}
  .op-prev{left:16px}.op-next{right:16px}
  /* Choix = liste VERTICALE d'options avec puce radio (scannable, cliquable au pouce) ; la sélection se
     marque un instant avant de partir dans le fil. Les créneaux de RDV gardent une identité bleue (📅). */
  .botc-choices{display:flex;flex-direction:column;gap:7px;padding:4px 0 2px 29px}
  .botc-choices:empty{display:none}
  .botc-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1.5px solid #ddd6c9;background:#fff;color:#1a1a1a;border-radius:12px;padding:10px 13px;font:inherit;font-size:13px;line-height:1.35;cursor:pointer;transition:border-color .12s,background .12s,transform .12s;animation:botmsg .26s cubic-bezier(.22,1,.36,1);box-shadow:0 2px 10px rgba(0,0,0,.06)}
  .botc-opt::after{content:"›";margin-left:auto;color:#b9b0a0;font-size:17px;line-height:1;flex:none;transition:transform .12s,color .12s}
  .botc-opt:hover{border-color:var(--bacc,#15130f);background:#faf7f1;transform:translateX(2px)}
  .botc-opt:hover::after{color:var(--bacc,#15130f);transform:translateX(2px)}
  .botc-opt:active{transform:scale(.985)}
  .botc-opt.book::after{color:#7db4ee}
  .botc-opt .r{flex:none;width:16px;height:16px;border-radius:50%;border:2px solid #c9c1b2;position:relative;transition:border-color .12s}
  .botc-opt:hover .r{border-color:var(--bacc,#15130f)}
  .botc-opt.on{border-color:var(--bacc,#15130f);background:#f6f1e8}
  .botc-opt.on .r{border-color:var(--bacc,#15130f)}
  .botc-opt.on .r::after{content:"";position:absolute;inset:2.5px;border-radius:50%;background:var(--bacc,#15130f)}
  .botc-opt:disabled{opacity:.5;cursor:default;transform:none}
  .botc-opt.on:disabled{opacity:1}
  .botc-opt.book{border-color:#a9cdf3;background:#f4f9ff}
  .botc-opt.book:hover{border-color:#0a84ff}
  .botc-opt.book:hover .r,.botc-opt.book.on .r{border-color:#0a84ff}
  .botc-opt.book.on{border-color:#0a84ff;background:#e9f3ff}
  .botc-opt.book.on .r::after{background:#0a84ff}
  /* Mise en forme dans les bulles : gras, italique, souligné, puces. */
  .botc-msg b{font-weight:700}
  .botc-msg .li{display:block;position:relative;padding-left:15px;margin:2px 0}
  .botc-msg .li::before{content:"•";position:absolute;left:2px;color:var(--bacc,#15130f);font-weight:700}
  /* Badge non-lu sur la bulle flottante (chat réduit). */
  .botc-badge{position:absolute;top:-4px;right:-4px;min-width:19px;height:19px;border-radius:10px;background:#e5484d;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff;line-height:1}
  .botc-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #0001;background:#fff}
  /* Formulaire conversationnel : quand des choix sont proposés, la saisie s'efface — l'option « Autre »
     (pointillés) la révèle. L'écran ne montre que la question et les réponses possibles. */
  .botc-in.hid{display:none}
  .botc-opt.other{border-style:dashed;color:#6b6457;font-weight:500;box-shadow:none}
  .botc-opt.other .r{border-style:dashed}
  /* Formulaire de coordonnées NATIF : une saisie, zéro aller-retour IA, réponse immédiate. */
  .botc-form{display:flex;flex-direction:column;gap:8px;align-self:stretch;background:#fff;border:1.5px solid #ddd6c9;border-radius:14px;padding:12px;box-shadow:0 2px 10px rgba(0,0,0,.06);animation:botmsg .26s cubic-bezier(.22,1,.36,1)}
  .botc-form input{border:1px solid #e0dcd4;border-radius:10px;padding:10px 13px;font:inherit;font-size:16px;background:#fff;color:#1a1a1a;width:100%}
  .botc-form input.err{border-color:#e5484d}
  .botc-form button{border:0;border-radius:10px;padding:11px;background:var(--bacc,#15130f);color:#fff;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
  .botc-form button:disabled{opacity:.6}
  .botc-form .cf-priv{font-size:11px;line-height:1.45;color:#8a857d;margin:2px 2px 0}
  /* Attente longue : au-delà de ~2 s, les points de frappe se doublent d'un mot doux. */
  .botc-typing .ty-lbl{font-size:12px;color:#8a857c;margin-left:7px;align-self:center;white-space:nowrap}
  .botc-in input{flex:1;min-width:0;border:1px solid #e0dcd4;border-radius:999px;padding:9px 15px;font:inherit;font-size:16px;background:#fff;color:#1a1a1a}
  .botc-in button{flex:none;width:38px;height:38px;border:0;border-radius:50%;background:var(--bacc,#0a84ff);color:#fff;font-size:16px;cursor:pointer;line-height:0}
  .botc-in button:disabled{opacity:.5;cursor:default}
  /* FAB : anneau blanc qui détache l'avatar du fond + halo accent pulsant 2 fois à l'apparition (pattern
     Intercom : attire l'œil sans harceler — le display none→flex relance l'animation à chaque réapparition). */
  .botc-fab{display:none;position:fixed;right:16px;bottom:16px;width:60px;height:60px;border-radius:50%;border:3px solid #fff;background:var(--bacc,#15130f);color:#fff;font-size:23px;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.4);z-index:30;padding:0;align-items:center;justify-content:center;animation:fabhalo 1.7s ease-out 2}
  @keyframes fabhalo{0%{box-shadow:0 8px 26px rgba(0,0,0,.4),0 0 0 0 color-mix(in srgb,var(--bacc,#15130f) 55%,transparent)}100%{box-shadow:0 8px 26px rgba(0,0,0,.4),0 0 0 20px transparent}}
  /* Poignée de drag (mobile) : la sheet se manipule au doigt comme une app native. */
  .botc-grab{display:none;flex:none;align-items:center;justify-content:center;height:22px;padding-top:8px;cursor:grab;touch-action:none}
  .botc-grab i{width:42px;height:5px;border-radius:999px;background:#ded7ca}
  /* ── Mobile : bottom sheet à 3 états — réduite (bulle) / COMPAGNON 48dvh (défaut : la page reste visible
     au-dessus, re-fit automatique) / PLEINE 88dvh (lecture longue, clavier ; classe body.botsheet-c). ── */
  @media(max-width:820px){
    .botc{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;height:48vh;height:48dvh;border-left:0;border-radius:18px 18px 0 0;box-shadow:0 -12px 44px rgba(0,0,0,.4);z-index:40;transition:height .28s cubic-bezier(.22,1,.36,1);overscroll-behavior:contain}
    body.botsheet-c .botc{height:88vh;height:88dvh}
    .botc-grab{display:flex}
    .botc-h{padding:4px 14px 10px;touch-action:none}
    .botc-min{width:38px;height:38px;font-size:20px}
    .botc-voice{width:38px;height:38px}
    .botc-voice svg{width:19px;height:19px}
    .botc-choices{padding-left:0}
    .botc-opt{min-height:46px}
    .botc-in{padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
    .botc-fab{bottom:calc(16px + env(safe-area-inset-bottom))}
    /* État plein : léger scrim sur le document (focus conversation) — il réapparaît dès qu'on redescend. */
    body.botsheet-c .scroll::after{content:"";position:absolute;inset:0;background:rgba(20,17,12,.28);z-index:5;pointer-events:none}
    /* Navigation au doigt (tap bords de page + swipe horizontal) → les flèches rondes disparaissent,
       SAUF en lecture solo page-à-page (botread) où elles reviennent en version discrète. */
    .op-arrow{display:none !important}
    body.onepage.botread .op-arrow{display:flex !important;width:36px;height:36px;font-size:19px;background:rgba(20,17,12,.42)}
    .op-prev{left:8px}.op-next{right:8px}
    /* Une question prend le pas sur la présentation → le document se met en retrait (flou + assombri). */
    .scroll{transition:filter .32s}
    body.botq .scroll{filter:blur(7px) brightness(.55)}
  }
  /* ── Écran d'accueil « 3 portes » (mobile) : le prospect choisit COMMENT découvrir le document ── */
  .botw{display:none;position:fixed;inset:0;z-index:50;background:rgba(15,13,10,.55);backdrop-filter:blur(3px);align-items:flex-end}
  .botw.on{display:flex}
  .botw-card{width:100%;background:#faf8f4;color:#1a1a1a;border-radius:22px 22px 0 0;padding:20px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -18px 60px rgba(0,0,0,.5);animation:botwup .32s cubic-bezier(.22,1,.36,1)}
  @keyframes botwup{from{transform:translateY(46px);opacity:0}to{transform:none;opacity:1}}
  .botw-head{display:flex;align-items:center;gap:12px}
  .botw-av{width:44px;height:44px;border-radius:50%;background:var(--bacc,#15130f);color:#fff;font-weight:800;font-size:17px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
  .botw-av img{width:100%;height:100%;object-fit:cover}
  .botw-head b{font-size:15px;display:block;line-height:1.25}
  .botw-head span{font-size:12px;color:#8a857c}
  .botw-q{font-size:14px;margin:12px 0 13px;color:#3d382f}
  .botw-door{display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:1.5px solid #ddd6c9;background:#fff;border-radius:14px;padding:13px 14px;font:inherit;font-size:14px;font-weight:600;color:#1a1a1a;cursor:pointer;margin-bottom:9px}
  .botw-door:active{border-color:var(--bacc,#15130f);background:#f6f1e8}
  .botw-door i{font-style:normal;font-size:19px;flex:none;width:26px;text-align:center}
  .botw-door small{display:block;font-weight:400;font-size:12px;color:#8a857c;margin-top:2px}
  .botw-pitch{margin:10px 0 0;font-size:13px;line-height:1.5;color:#5a554d}
  .botw-door{position:relative}
  .botw-lang{display:flex;gap:6px;justify-content:flex-end;margin:2px 0 10px}
  .botw-lang button{border:1px solid #ddd6c9;background:#fff;color:#8a857c;border-radius:999px;padding:4px 11px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;transition:background .12s,color .12s}
  .botw-lang button.on{background:#15130f;color:#fff;border-color:#15130f}
  .botw-tag{position:absolute;top:-8px;right:12px;background:var(--bacc,#15130f);color:#fff;font-style:normal;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2.5px 9px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.18)}
  .botw-card.botw-s2{display:none}
  .botw.step2 .botw-card:not(.botw-s2){display:none}
  .botw.step2 .botw-card.botw-s2{display:block}
  .botw-back{display:block;margin:4px auto 0;border:0;background:none;color:#8a857c;font:inherit;font-size:13px;cursor:pointer;padding:6px 10px}
  .botw-back:hover{color:#3d382f}
  .botc-pause{display:none;margin-left:auto;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;line-height:0;align-items:center;justify-content:center}
  body.deskpresent .botc-pause{display:inline-flex}
  .botc-voice~.botc-pause{margin-left:6px}
  .botc-pause+.botc-min{margin-left:6px}
  .botc-pause svg{width:15px;height:15px}
  .botc-pause svg+svg{display:none}
  body.deskpaused .botc-pause svg{display:none}
  body.deskpaused .botc-pause svg+svg{display:block}
  body.deskpaused .botc-pause{background:var(--bacc,#15130f);color:#fff}
  .botc-gearbtn{margin-left:auto;border:0;background:#efece7;color:#5a554d;width:28px;height:28px;border-radius:8px;cursor:pointer;line-height:0;display:inline-flex;align-items:center;justify-content:center}
  .botc-voice~.botc-gearbtn{margin-left:6px}
  .botc-gearbtn svg{width:15px;height:15px}
  .botc-gearbtn:hover{background:#e2e0da}
  .botc-gearbtn+.botc-min{margin-left:6px}
  @media(max-width:820px){.botc-gearbtn{display:none}}
  .botc-gear{position:absolute;right:-3px;bottom:-3px;width:22px;height:22px;border-radius:50%;background:#15130f;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #faf8f4}
  .botc-gear svg{width:12px;height:12px}
  @media(max-width:820px){.botc-gear{display:none}}
  .fab-gear{display:none}
  @media(min-width:821px){
    .botc-fab>img,.botc-fab>svg{display:none}
    .botc-fab .botc-gear{display:none}
    /* Cluster COMPACT en verre (assorti au header) : 2 pastilles discrètes 42px — 💬 puis ⚙. */
    .botc-fab{width:42px;height:42px;border:0;background:rgba(24,22,18,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.28);animation:none}
    .botc-fab:hover{background:rgba(24,22,18,.85)}
    body.light .botc-fab{background:rgba(255,255,255,.78);color:#15130f;box-shadow:0 4px 16px rgba(0,0,0,.16)}
    body.light .botc-fab:hover{background:#fff}
    .fab-gear{display:flex;align-items:center;justify-content:center}
    .fab-gear svg{width:17px;height:17px}
  }
  .fabmenu{display:none;position:fixed;right:18px;bottom:170px;z-index:41;width:322px;background:#faf8f4;color:#1a1a1a;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.45);padding:12px;animation:dkovin .22s cubic-bezier(.22,1,.36,1)}
  .fabmenu.on{display:block}
  /* Menu à DEUX NIVEAUX façon réglages YouTube : niveau 0 = rangées avec la valeur courante, un tap
     ouvre le panneau de la section (fm-p) avec un « retour ». 3 rangées lisibles au lieu de 13 boutons. */
  .fm-row{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;border-radius:10px;padding:11px 10px;font:inherit;font-size:13.5px;font-weight:600;color:#1a1a1a;cursor:pointer;text-align:left}
  .fm-row:hover{background:#f1ede4}
  .fm-row .fm-rl{flex:1}
  .fm-row em{font-style:normal;font-size:12px;color:#8a857c;font-weight:600;white-space:nowrap}
  .fm-row svg{width:12px;height:12px;flex:none;color:#b3ac9f}
  .fm-p{display:none}
  .fm-back{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;border-radius:10px;padding:8px 10px 10px;font:inherit;font-size:13px;font-weight:700;color:#1a1a1a;cursor:pointer;text-align:left}
  .fm-back:hover{background:#f1ede4}
  .fm-back svg{width:13px;height:13px;color:#8a857c}
  .fabmenu.p-pDisp #fmL0,.fabmenu.p-pLang #fmL0,.fabmenu.p-pLook #fmL0{display:none}
  .fabmenu.p-pDisp #pDisp,.fabmenu.p-pLang #pLang,.fabmenu.p-pLook #pLook{display:block}
  .fm-sec{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8a857c;margin:11px 2px 6px}
  .fm-seg{display:flex;gap:5px;flex-wrap:wrap}
  .fm-seg button{flex:1 1 auto;min-width:0;white-space:nowrap;border:1.5px solid #ddd6c9;background:#fff;border-radius:9px;padding:7px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;color:#1a1a1a}
  .fm-seg button.on{border-color:var(--bacc,#15130f);background:var(--bacc,#15130f);color:#fff}
  @media(max-width:820px){.fabmenu{display:none !important}}
  /* Desktop : DEUX boutons empilés — 💬 avatar (parler à l'assistant) au-dessus du ⚙ (réglages purs).
     L'action de conversation sort du menu réglages : Léa retrouve un visage cliquable. */
  .botc-fab2{display:none;position:fixed;right:16px;bottom:66px;width:42px;height:42px;border-radius:50%;border:0;background:rgba(24,22,18,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.28);z-index:30;padding:0;align-items:center;justify-content:center;overflow:visible;transition:background .12s}
  .botc-fab2:hover{background:rgba(24,22,18,.85)}
  body.light .botc-fab2{background:rgba(255,255,255,.78);color:#15130f;box-shadow:0 4px 16px rgba(0,0,0,.16)}
  body.light .botc-fab2:hover{background:#fff}
  .botc-fab2 svg{width:17px;height:17px}
  .botc-fab3{bottom:116px}
  .botc-fab4{bottom:116px}
  @media(max-width:820px){.botc-fab2{display:none !important}}
  @media(min-width:821px){.botc-peek{bottom:172px}}
  body.light{--bg:#e8e5df;--bar:#f7f5f1;color:#1a1a1a}
  body.light .bar{border-bottom-color:#00000014}
  /* Thème clair : les contrôles de la barre étaient codés en BLANC → invisibles sur fond clair. */
  body.light .pg,body.light .zoom span{color:#6b665e}
  body.light .zoom button,body.light .dl,body.light .ic{color:#15130f;border-color:#00000024}
  body.light .zoom button:hover,body.light .dl:hover,body.light .ic:hover{background:#00000010}
  body.light .dl.primary{background:#15130f;color:#fff;border-color:#15130f}
  body.light .dl.primary:hover{filter:none;background:#2a261f}
  body.light .dkov{background:rgba(233,230,224,.62)}
  body.light .dkov-big{background:#15130f;color:#fff}
  body.light .dkov-opts button{background:rgba(21,19,15,.9);color:#fff}
  body.light .dkov-opts button:hover{background:#15130f}
  body.light .dkov-opts button.primary{background:#fff;color:#15130f}
  body.light .dkov-opts button.primary:hover{background:#f1ede4}
  body.light .dkov-opts button.ghost{background:none;border-color:rgba(0,0,0,.32);color:#3c3833}
  body.light .dkov-opts button.ghost:hover{background:rgba(0,0,0,.08)}
  .botw-x{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;font-size:17px;cursor:pointer}
  /* ── Desktop : les mêmes « 3 portes » mais en CARTE CENTRÉE (pas un bottom sheet) + états hover souris. ── */
  @media(min-width:821px){
    .botw{align-items:center;justify-content:center}
    .botw-card{width:440px;max-width:92vw;border-radius:20px;padding:26px 24px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
    .botw-x{top:16px;right:16px}
    .botw-q{font-size:15px;margin:14px 0 16px}
    .botw-door{padding:15px 16px;font-size:14.5px;transition:border-color .12s,background .12s}
    .botw-door:hover{border-color:var(--bacc,#15130f);background:#f6f1e8}
  }
  /* ── Mode PLAYER (mobile) : le document plein écran, sous-titres courts + contrôles façon stories ── */
  .botp{display:none;position:fixed;left:0;right:0;bottom:0;z-index:36;padding:0 12px calc(12px + env(safe-area-inset-bottom));flex-direction:column;gap:9px;pointer-events:none}
  body.botplayer .botp{display:flex}
  body.botplayer .botc,body.botplayer .botc-fab,body.botplayer .botc-peek{display:none !important}
  @media (orientation: landscape) and (max-height: 520px){
    body.botplayer .bar{display:none}
    body.botplayer .botp{padding:0 0 6px}
    body.botplayer .botp-cap{position:fixed;left:0;right:0;bottom:0;margin:0;padding:44px 26px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(10,9,7,.72) 55%);backdrop-filter:none;-webkit-backdrop-filter:none;color:#fff;border-radius:0;box-shadow:none}
    body.botplayer .pcap-k{font-size:30px;min-height:0}
    body.botplayer .botp-cap .ks-focus .kw.cur{background:#fff;color:#15130f}
    body.botplayer .botp-ctl{position:fixed;right:12px;bottom:calc(10px + env(safe-area-inset-bottom));gap:8px;transition:opacity .3s}
    body.botplayer .botp-ctl button{width:40px;height:40px}
    body.botplayer .botp-ctl button.pp{width:44px;height:44px}
    body.botplayer.ctlhide .botp-ctl{opacity:0;pointer-events:none}
    body.botplayer .botp-prog{position:fixed;top:0;left:0;right:0;margin:0}
  }
  .rot-hint{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(210px + env(safe-area-inset-bottom));z-index:44;background:rgba(16,14,11,.82);color:#fff;border-radius:16px;padding:12px 18px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 12px 40px rgba(0,0,0,.35);align-items:center;gap:12px}
  .rot-hint.on{display:flex;animation:botmsg .3s cubic-bezier(.22,1,.36,1)}
  .rh-ph{display:flex;color:#fff;animation:rotph 2.4s ease-in-out infinite}
  @keyframes rotph{0%,28%{transform:rotate(0)}55%,78%{transform:rotate(90deg)}100%{transform:rotate(0)}}
  .rh-t{display:flex;flex-direction:column;line-height:1.25}
  .rh-t b{font-size:13.5px;font-weight:800}
  .rh-t span{font-size:11.5px;color:#c9c3b8;font-weight:600}
  /* Barre TEMPO : une seule barre qui se remplit sur la durée de l'étape courante (le rythme), sans révéler
     « il reste 14 slides » (anxiogène). Se fige en pause (body.botpaused), se masque pendant une question. */
  .botp-prog{position:fixed;top:calc(56px + env(safe-area-inset-top));left:10px;right:10px;height:3px;border-radius:99px;background:rgba(255,255,255,.24);overflow:hidden;z-index:37;transition:opacity .3s}
  .botp-prog i{display:block;height:100%;width:0;border-radius:99px;background:#fff}
  @keyframes botfill{from{width:0}to{width:100%}}
  body.botpaused .botp-prog i{animation-play-state:paused}
  body.botq .botp-prog{opacity:0}
  .botp-cap{pointer-events:auto;margin:0;background:linear-gradient(180deg,rgba(30,27,22,.88),rgba(14,12,9,.94));backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15);color:#fff;padding:16px 18px 14px;font-size:16.5px;font-weight:600;line-height:1.4;text-align:center;display:flex;flex-direction:column;gap:7px;border-radius:24px;box-shadow:0 14px 44px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.09);animation:botmsg .3s cubic-bezier(.22,1,.36,1)} /* CARTE flottante en verre façon Captions — les deux thèmes */
  .pcap-k{font-size:38px;font-weight:800;line-height:1.16;letter-spacing:-.02em;min-height:96px;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:0 9px} /* TRÈS PEU de mots, ÉNORMES */
  .botp-cap .ks-focus .kw.cur{background:#fff;color:#15130f}
  .botp-cap:empty{display:none}
  .botp-chips{pointer-events:auto;display:flex;flex-direction:column;gap:7px}
  .botp-chips:empty{display:none}
  .botp-ctl{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:11px}
  .botp-ctl button{width:46px;height:46px;border-radius:50%;border:0;background:rgba(20,17,12,.72);color:#fff;font-size:18px;cursor:pointer;line-height:0;backdrop-filter:blur(4px)}
  .botp-ctl button.pp{width:56px;height:56px;background:#fff;color:#15130f;font-size:20px}
  .botp-ctl button.spd{width:auto;min-width:46px;padding:0 11px;border-radius:999px;font-size:13px;font-weight:800;letter-spacing:.02em}
  .botp-ctl button:disabled{opacity:.35}
  #botpFs svg{width:17px;height:17px}
  .botp-ctl #botpChat{padding:0;overflow:hidden;border:2px solid rgba(255,255,255,.35)}
  .botp-ctl #botpChat img{width:100%;height:100%;object-fit:cover;border-radius:50%}
  /* PAUSE visible : gros bouton lecture au centre (pattern lecteur vidéo). Pendant une question, les
     contrôles s'effacent — il ne reste que la question et les réponses. */
  .botp-big{display:none;position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);width:78px;height:78px;border-radius:50%;border:0;background:rgba(255,255,255,.96);color:#15130f;box-shadow:0 16px 48px rgba(0,0,0,.45);cursor:pointer;z-index:37;align-items:center;justify-content:center;pointer-events:auto;animation:bigin .22s cubic-bezier(.22,1,.36,1)}
  /* keyframe DÉDIÉE : botmsg écrasait le translate(-50%,-50%) pendant l'animation → le ▶ naissait décentré */
  @keyframes bigin{from{opacity:0;transform:translate(-50%,-50%) scale(.82)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
  .botp-big svg{width:30px;height:30px;display:block;margin:auto}
  body.botplayer.botpaused .botp-big{display:flex}
  body.botq .botp-big{display:none !important}
  body.botq .botp-ctl{display:none}
  /* Question = plein FOCUS : le bloc question+réponses monte au CENTRE de l'écran sur le doc flouté. */
  body.botq .botp{top:0;justify-content:center}
  /* Le document règne : page calée en HAUT (réserve basse pour sous-titre/contrôles, cf. targetWidth). */
  body.botplayer.onepage #pages{justify-content:center;align-items:center} /* centré dans l'espace AU-DESSUS du texte (padding-bottom dynamique, cf. build) */
  /* Menu « reprendre la main » (⋯) : les sorties du GOAL, accessibles à TOUT moment de la présentation. */
  .botp-menu{display:none;position:fixed;right:12px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:39;background:#fff;color:#1a1a1a;border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.45);padding:6px;min-width:250px;pointer-events:auto;animation:botmsg .2s cubic-bezier(.22,1,.36,1)}
  .botp-menu.on{display:block}
  .botp-menu button{display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:0;background:transparent;font:inherit;font-size:13.5px;font-weight:600;color:#1a1a1a;padding:12px;border-radius:9px;cursor:pointer}
  .botp-menu .bm-set{border-top:1px solid #e8e2d6;border-radius:0 0 9px 9px;margin-top:4px;padding-top:13px;color:#6b665e}
  .botp-set{display:none}
  .botp-set.on{display:block}
  .botp-set .fm-sec{margin:10px 4px 6px}
  .botp-set .fm-seg{display:flex;gap:6px;flex-wrap:wrap}
  .botp-set .fm-seg button{width:auto;flex:1 1 auto;min-width:0;padding:9px 10px;text-align:center;border-radius:10px}
  .bs-back{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;font:inherit;font-size:13.5px;font-weight:800;color:#1a1a1a;padding:6px 4px 8px;cursor:pointer}
  .bs-back svg{width:13px;height:13px;color:#8a857c}
  .botp-menu b{width:20px;font-size:12.5px;font-weight:800;flex:none;text-align:center}
  .botp-menu button:active{background:#f2efe9}
  .botp-menu button svg{flex:none;color:#8a857c}
  /* Les choix apparaissent EN CASCADE (le temps de lire) : délai posé en JS, invisibles avant leur tour. */
  .botc-opt{animation-fill-mode:both}
  /* Icônes SVG : centrées dans les boutons ; le bouton lecture/pause embarque les DEUX icônes, l'état
     body.botpaused choisit laquelle afficher (pas de innerHTML côté JS). */
  .botp-ctl button svg,.botc-in button svg,.botc-min svg,.botw-x svg,.op-arrow svg{display:block;margin:auto}
  .botc-in button svg{width:16px;height:16px}
  .botc-min svg{width:16px;height:16px}
  .botp-ctl .pp svg{width:21px;height:21px}
  .botp-ctl .pp svg+svg{display:none}
  body.botpaused .botp-ctl .pp svg:first-child{display:none}
  body.botpaused .botp-ctl .pp svg+svg{display:block}
  .botw-door i svg{width:21px;height:21px}
  /* Pill « reprendre la présentation » dans le chat quand un player est en pause */
  .botc-back{display:none;align-items:center;justify-content:center;gap:8px;margin:8px 12px 0;padding:9px;border-radius:11px;border:0;background:var(--bacc,#15130f);color:#fff;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
  .botc-back svg{width:13px;height:13px}
  .botc-back:hover{filter:brightness(1.25)}
  .botc-resume{display:none;margin:0 12px 8px;padding:11px;border-radius:12px;border:1.5px solid var(--bacc,#15130f);background:#fff;color:var(--bacc,#15130f);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  /* Vignette d'une page insérée dans le fil (le bot MONTRE ce dont il parle) — tap = voir la page en grand. */
  .botc-pgcard{align-self:flex-start;margin-left:29px;border:1px solid #d6cfc2;border-radius:12px;overflow:hidden;background:#fff;cursor:pointer;max-width:72%;box-shadow:0 6px 18px rgba(0,0,0,.13);animation:botmsg .26s cubic-bezier(.22,1,.36,1)}
  .botc-pgcard img{display:block;width:100%}
  .botc-pgcard span{display:block;font-size:11px;color:#8a857c;padding:6px 10px;font-weight:600}
  .botc-pgchip{display:inline-block;background:#efe9df;color:#6b6457;font-size:11px;font-weight:700;border-radius:6px;padding:2px 7px;margin-right:6px;cursor:pointer;vertical-align:1px}
  /* Teaser : un message arrivé chat réduit s'affiche en bulle 1-2 lignes au-dessus de la bulle flottante
     (tap = ouvrir la conversation). Auto-disparition — invitant, jamais bloquant. */
  .botc-peek{position:fixed;right:16px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:39;max-width:min(76vw,340px);background:#fff;color:#1c1c1c;border:0;border-radius:16px;border-bottom-right-radius:5px;padding:11px 14px;box-shadow:0 12px 34px rgba(0,0,0,.35);font:inherit;font-size:13px;line-height:1.45;text-align:left;cursor:pointer;visibility:hidden;opacity:0;transform:translateY(8px);transition:opacity .28s,transform .28s,visibility .28s;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden} /* la troncature fiable est faite en JS (~90 car. au mot) ; le clamp n'est qu'un filet */
  .botc-peek.on{visibility:visible;opacity:1;transform:none}
`;
// Icônes SVG fines (stroke currentColor, style feather) — remplacent les emoji des contrôles (moderne, cohérent).
const ICO = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  play: ICO('<path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" stroke="none"/>'),
  pause: ICO('<path d="M8.5 5v14M15.5 5v14" stroke-width="2.6"/>'),
  prev: ICO('<path d="M14.5 5 8 12l6.5 7"/>'),
  next: ICO('<path d="M9.5 5 16 12l-6.5 7"/>'),
  chat: ICO('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>'),
  close: ICO('<path d="M6 6l12 12M18 6 6 18"/>'),
  book: ICO('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  send: ICO('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),
  min: ICO('<path d="M6 9l6 6 6-6"/>'),
  more: ICO('<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
  dl: ICO('<path d="M12 4v11M6 10l6 6 6-6M4 20h16"/>'),
  sound: ICO('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  restart: ICO('<path d="M3 12a9 9 0 1 0 2.8-6.5"/><path d="M3 4v5h5"/>'),
  gear: ICO('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>'),
  cc: ICO('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M6.5 12h4M6.5 15.2h7M13 12h4.5"/>'),
  mute: ICO('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  phone: ICO('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/>'),
  cal: ICO('<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10.5h16"/>'),
  exit: ICO('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  fs: ICO('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
};
function botMarkup(share, pitch) {
  const name = esc(share.bot_name || (PLAYER.branding.name ? `Assistant ${PLAYER.branding.name}` : "Assistant"));
  const sub = esc(share.bot_tagline || "Présentation guidée");
  const acc = esc(share.bot_accent || "#15130f");
  const avatar = share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : (share.bot_name ? esc(String(share.bot_name).trim().charAt(0).toUpperCase()) : "◆");
  // Voix (ElevenLabs) : les boutons 🔊 ne sont proposés que si une clé est configurée côté serveur.
  const voiceBtn = process.env.ELEVENLABS_API_KEY ? `<button class=botc-voice id=botcVoice title="Écouter la présentation" aria-pressed=false>${ICONS.mute}</button>` : "";
  const pVoiceBtn = process.env.ELEVENLABS_API_KEY ? `<button id=botpVoice title="Écouter">${ICONS.mute}</button>` : "";
  // Étape 2 du sélecteur de départ (uniquement si la voix est disponible) : le CONSENTEMENT audio se donne
  // ICI, clairement, avant de lancer la présentation — audio interactif (voix + chat) ou par écrit.
  const hasVClips = !!share.bot_vclips;
  const videoDoor = hasVClips ? `<button class=botw-door id=doorVideo><i>${ICONS.play}</i><span>En vidéo avec ${name}<small>${name} vous présente face caméra — le format le plus vivant</small></span><em class=botw-tag>Populaire</em></button>` : "";
  const vNote = !hasVClips && share.video_layout ? `<p class=botw-note>🎬 La présentation vidéo arrive bientôt sur ce document.</p>` : "";
  const s2 = process.env.ELEVENLABS_API_KEY ? `<div class="botw-card botw-s2"><div class=botw-head><span class=botw-av>${avatar}</span><div><b>${name}</b><span>${sub}</span></div></div><p class=botw-q>Parfait ! Comment préférez-vous suivre la présentation ?</p>${videoDoor}<button class=botw-door id=doorVoice><i>${ICONS.sound}</i><span>${hasVClips ? "En audio" : `Avec la voix de ${name}`}<small>Audio interactif — écoutez la présentation et posez vos questions dans le chat à tout moment</small></span>${hasVClips ? "" : `<em class=botw-tag>Populaire</em>`}</button><button class=botw-door id=doorSilent><i>${ICONS.chat}</i><span>Par écrit, dans le chat<small>${name} écrit page après page, en silence — à votre rythme</small></span></button>${vNote}<button class=botw-back id=botwBack>← Revenir aux options</button></div>` : "";
  return `<div class="botc min" id=botc style="--bacc:${acc}"><div class=botc-grab id=botcGrab><i></i></div><div class=botc-h><span class=botc-av>${avatar}</span><div><b>${name}</b><span class=botc-sub>${sub}</span></div>${voiceBtn}<button class=botc-gearbtn id=botcGearBtn title="Réglages d'affichage">${ICONS.gear}</button><button class=botc-min id=botcMin title=Réduire>${ICONS.min}</button></div><button class=botc-back id=botcBack>${ICONS.prev}<span>Revenir à la présentation</span></button><div class=botc-msgs id=botcMsgs><div class=botc-choices id=botcChoices></div></div><button class=botc-resume id=botcResume>Reprendre la présentation</button><div class=botc-in><input id=botcText placeholder="Écrivez votre message…" autocomplete=off maxlength=1000><button id=botcSend title=Envoyer>${ICONS.send}</button></div></div><button class=botc-fab id=botcFab style="--bacc:${acc}" title="Assistant & réglages">${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : ICONS.chat}<span class=botc-badge id=botcBadge></span><span class=botc-gear>${ICONS.gear}</span><span class=fab-gear>${ICONS.gear}</span></button><button class=botc-fab2 id=botcFab2 title="Parler à ${esc(String(share.bot_name || "l'assistant"))}">${ICONS.chat}<span class=botc-badge id=botcBadge2></span></button>${process.env.ELEVENLABS_API_KEY ? `<button class="botc-fab2 botc-fab3" id=botcVoice2 title="Couper la voix"></button>` : ""}<button class="botc-fab2 botc-fab4" id=botcPlay2 title="Relancer une visite">${ICONS.play}</button><button class=botc-peek id=botcPeek></button><div class=fabmenu id=fabMenu style="--bacc:${acc}"><div class=fm-l0 id=fmL0><button class=fm-row data-p=pDisp><span class=fm-rl>Affichage</span><em id=fmVDisp></em>${ICONS.next}</button><button class=fm-row data-p=pLang><span class=fm-rl>Langue</span><em id=fmVLang></em>${ICONS.next}</button><button class=fm-row data-p=pLook><span class=fm-rl>Apparence</span><em id=fmVLook></em>${ICONS.next}</button></div><div class=fm-p id=pDisp><button class=fm-back>${ICONS.prev}<span class=fm-rl>Affichage</span></button><div class=fm-seg id=fmDisp><button data-v=panel>Panneau</button><button data-v=bubble>Bulle</button><button data-v=cap>Barre</button><button data-v=audio>Audio seul</button></div></div><div class=fm-p id=pLang><button class=fm-back>${ICONS.prev}<span class=fm-rl>Langue</span></button><div class=fm-seg id=fmLang><button data-v=fr>FR</button><button data-v=en>EN</button><button data-v=es>ES</button></div></div><div class=fm-p id=pLook><button class=fm-back>${ICONS.prev}<span class=fm-rl>Apparence</span></button><div class=fm-sec>Thème</div><div class=fm-seg id=fmTheme><button data-v=dark>Sombre</button><button data-v=light>Clair</button></div><div class=fm-sec>Style du texte</div><div class=fm-seg id=fmStyle><button data-v=classic>Classique</button><button data-v=focus>Focus</button><button data-v=fill>Encre</button><button data-v=underline>Souligné</button></div></div></div><div class=botw id=botw style="--bacc:${acc}"><button class=botw-x id=botwX aria-label=Fermer>${ICONS.close}</button><div class=botw-card><div class=botw-head><span class=botw-av>${avatar}</span><div><b>${name}</b><span>${sub}</span></div></div><div class=botw-lang id=botwLang><button data-v=fr>FR</button><button data-v=en>EN</button><button data-v=es>ES</button></div>${pitch ? `<p class=botw-pitch>${esc(pitch)}</p>` : ""}<p class=botw-q>Comment souhaitez-vous découvrir ce document ?</p><button class=botw-door id=doorPresent><i>${ICONS.play}</i><span>Je me laisse guider<small>${name} vous présente le document, à votre rythme</small></span><em class=botw-tag>Recommandé</em></button><button class=botw-door id=doorRead><i>${ICONS.book}</i><span>Je le parcours seul<small>Lecture libre — l'assistant reste disponible</small></span></button><button class=botw-door id=doorChat><i>${ICONS.chat}</i><span>J'ai des questions<small>Échangez directement avec ${name}</small></span></button></div>${s2}</div><div class=botp id=botp style="--bacc:${acc}"><div class=botp-prog id=botpProg><i id=botpFill></i></div><div class=botp-cap id=botpCap></div><div class=botp-chips id=botpChips></div><div class=botp-ctl><button class=pp id=botpPP aria-label="Lecture / pause">${ICONS.pause}${ICONS.play}</button>${pVoiceBtn}<button id=botpFs title="Plein écran">${ICONS.fs}</button><button id=botpChat title="Parler à ${esc(String(share.bot_name || "l'assistant"))}">${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : ICONS.chat}</button><button id=botpMore title=Options>${ICONS.more}</button></div><button class=botp-big id=botpBig aria-label=Reprendre>${ICONS.play}</button><div class=rot-hint id=rotHint><i class=rh-ph><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18.2h2"/></svg></i><div class=rh-t><b>Plein écran</b><span>Tournez votre téléphone</span></div></div><div class=botp-menu id=botpMenu><button id=bmChat>${ICONS.chat}<span>Poser une question</span></button><button id=bmCall>${ICONS.cal}<span>Être rappelé / prendre RDV</span></button><button id=bmDl>${ICONS.dl}<span>Télécharger le document</span></button><button id=bmRestart>${ICONS.restart}<span>Recommencer la présentation</span></button><button id=bmRead>${ICONS.book}<span>Consulter tranquillement</span></button><button id=bmSet class=bm-set>${ICONS.gear}<span>Réglages</span></button></div><div class="botp-menu botp-set" id=botpSet><button class=bs-back id=bsBack>${ICONS.prev}<span>Réglages</span></button><div class=fm-sec>Vitesse de lecture</div><div class=fm-seg id=msSpd><button data-v=1>1×</button><button data-v=1.5>1,5×</button><button data-v=2>2×</button></div><div class=fm-sec>Thème</div><div class=fm-seg id=msTheme><button data-v=dark>Sombre</button><button data-v=light>Clair</button></div><div class=fm-sec>Style du texte</div><div class=fm-seg id=msStyle><button data-v=classic>Classique</button><button data-v=focus>Focus</button><button data-v=fill>Encre</button><button data-v=underline>Souligné</button></div></div></div>`;
}

/**
 * Pied de mentions d'une page servie. `tracked` = cette page mesure la lecture de la personne qui
 * la regarde — la mention de mesure n'apparaît QUE dans ce cas, et elle est affichée par défaut.
 * Les autres liens n'apparaissent que si l'hôte les a configurés : neutre par défaut, comme la marque.
 */
/**
 * Relaie un fichier vers le lecteur. À n'utiliser QUE via cette fonction — les trois chemins de
 * streaming (lien tracé, aperçu interne, page audience) faisaient la même chose à trois endroits,
 * et la même erreur.
 *
 * ⚠️ LE PIÈGE, signalé par le second hôte en implémentant sa propre route : `fetch()`
 * **décompresse le corps pour nous, et garde les en-têtes reçus**. Relayer fidèlement le
 * `Content-Length` de l'amont annonce donc la taille du COMPRESSÉ alors qu'on sert du décompressé
 * — le lecteur reçoit un PDF **tronqué**. Ce n'est plus « le chargement progressif ne marche pas »,
 * c'est « le document est corrompu », et sans erreur nulle part.
 *
 * On ne relaie donc JAMAIS la taille annoncée : on envoie celle des octets qu'on envoie vraiment.
 *
 * ⚠️ Et un 206 compressé est irrécupérable : les bornes portent sur les octets compressés, un
 * fragment gzip ne se décompresse pas seul. On refuse bruyamment plutôt que de servir du faux.
 */

// ⚠️ CE QU'ON RELAIE S'OUVRE SUR NOTRE ORIGINE.
//
// Un fichier relayé sort du domaine qui sert les documents — donc avec ses cookies, son
// `localStorage` et ses jetons de présentation. Relayer un `Content-Type` exécutable revient à
// héberger le script de quelqu'un d'autre chez soi : un SVG déposé dans une source autorisée
// (bucket public, route de l'hôte) s'ouvre `image/svg+xml`, et son `<script>` s'exécute avec
// notre origine. La réponse de streaming ne porte aucune CSP — c'est un fichier, pas une page.
//
// Retirer `.svg` de la table des types locaux (côté `context/storage.js`) ne réglait que la
// moitié du sujet : l'amont distant annonce le type qu'il veut, et on le recopiait.
//
// On ne REFUSE pas pour autant : le fichier existe, quelqu'un a le droit de le récupérer, et un
// 502 sur une pièce jointe légitime serait une panne. On le rend simplement **inerte** — type
// générique et téléchargement forcé. Il n'était de toute façon pas affichable (la matrice des
// formats du README ne connaît que le PDF et les images bitmap).
const TYPES_EXECUTABLES = /^(image\/svg|text\/html|application\/xhtml|application\/xml|text\/xml)/i;

async function relayerFichier(res, r, disposition) {
  if (!r) { res.statusCode = 404; res.end("Fichier indisponible"); return; }
  if (!r.ok && r.status !== 206) { res.statusCode = 502; res.end("Fichier indisponible"); return; }

  const compresse = !!r.headers.get("content-encoding");
  if (compresse && r.status === 206) { res.statusCode = 502; res.end("Fichier indisponible"); return; }

  const buf = Buffer.from(await r.arrayBuffer());
  res.statusCode = r.status;
  const typeAmont = r.headers.get("content-type") || "application/pdf";
  const executable = TYPES_EXECUTABLES.test(typeAmont);
  res.setHeader("Content-Type", executable ? "application/octet-stream" : typeAmont);
  // ⚠️ On ÉCRASE la disposition, on ne la complète pas : les chemins de streaming passent
  // `inline; filename=…` pour que la visionneuse affiche le document. Sur un type exécutable,
  // `inline` est précisément ce qu'il ne faut pas — et un `|| "attachment"` n'aurait jamais servi.
  if (executable) disposition = "attachment";
  // `nosniff` : sans lui, un `text/plain` contenant du HTML peut être requalifié par le
  // navigateur — la garde ci-dessus porterait alors sur un type qui n'est pas celui qui s'ouvre.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");
  // Les bornes d'un `Content-Range` ne valent que si l'amont n'a pas compressé.
  const cr = !compresse && r.headers.get("content-range");
  if (cr) res.setHeader("Content-Range", cr);
  res.setHeader("Content-Length", String(buf.length)); // ce qu'on envoie, jamais ce qu'on a reçu
  if (disposition) res.setHeader("Content-Disposition", disposition);
  res.setHeader("Cache-Control", "private, max-age=600");
  res.end(buf);
}

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
    color:rgba(255,255,255,.42);background:rgba(0,0,0,.28);backdrop-filter:blur(3px);pointer-events:none}
  .lgl a{color:inherit;text-decoration:underline;text-underline-offset:2px;pointer-events:auto}
  .lgl a:hover{color:rgba(255,255,255,.8)}
  .lgl-sep{margin:0 6px;opacity:.5}
  .lgl-note{opacity:.9}
  @media (max-width:640px){ .lgl{font-size:10px;padding:4px 10px} }
`;

function sendHtml(res, status, html, scriptSrc, imgExtra, frameAncestors) {
  res.statusCode = status;
  // Origine Supabase Storage (voix ElevenLabs mise en cache dans le bucket public tts-cache) → autorisée en media-src.
  let supaOrigin; try { supaOrigin = new URL((PLAYER.config && PLAYER.config.supabaseUrl) || "").origin; } catch { supaOrigin = ""; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src ${scriptSrc || "'none'"} https://cdnjs.cloudflare.com`,
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
    `connect-src 'self' https://cdnjs.cloudflare.com${supaOrigin ? " " + supaOrigin : ""}`,
    `img-src 'self' data: blob:${imgExtra ? " " + imgExtra : ""}`,
    `media-src 'self'${supaOrigin ? " " + supaOrigin : ""}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    // Aperçu interne : framing MÊME ORIGINE autorisé (iframe DocViewer). Page publique : 'none' (anti-clickjacking).
    `frame-ancestors ${frameAncestors || "'none'"}`,
  ].join("; "));
  res.end(html);
}

// Page « soft wall » : CSP dédiée — autorise Google Identity Services (One-Tap) en plus du nonce.
function sendSoftWallHtml(res, html, nonce, imgExtra, frameAncestors) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-src https://accounts.google.com/gsi/",
    `img-src 'self' data: blob:${imgExtra ? " " + imgExtra : ""}`,
    "style-src 'unsafe-inline' https://accounts.google.com/gsi/style",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    `frame-ancestors ${frameAncestors || "'self'"}`,
  ].join("; "));
  res.end(html);
}

/**
 * Ancres de framing d'une page INTÉGRÉE (?embed=1). Extrait du chemin nominal : une page de refus
 * doit pouvoir être encadrée exactement comme la visionneuse qu'elle remplace — sinon le
 * navigateur bloque le rendu et le message de refus ci-dessous n'est jamais émis.
 */
// ⚠️ LA MÊME SOURCE QUE LA CARTE D'IDENTITÉ, ET C'EST TOUT LE SUJET. Cette fonction lisait
// `process.env.DOC_FRAME_ANCESTORS` pendant que `?contract=1` annonçait
// `PLAYER.config.extraFrameAncestors`. Les deux coïncident tant qu'un hôte remplit sa
// configuration depuis cette variable — c'est le cas des deux hôtes actuels, donc rien n'était
// cassé. Mais un hôte qui la calcule autrement (base, fichier, autre nom de variable) verrait la
// carte annoncer une liste et l'en-tête CSP en servir une autre : « configuré » et « servi »
// divergents à l'intérieur même du mécanisme construit pour détecter cette divergence.
function embedFrameAncestors() {
  return ["'self'", "https://*.vercel.app"]
    .concat((PLAYER.config && PLAYER.config.extraFrameAncestors) || [])
    .join(" ");
}

/**
 * REFUS D'AFFICHER, dit à voix haute.
 *
 * ⚠️ Signalé par le second hôte en câblant son application : `embed-ready` qui n'arrive pas peut
 * vouloir dire deux choses OPPOSÉES — le player n'est pas là (instance absente, en panne), ou le
 * player REFUSE (lien révoqué, mur d'accès, greffon manquant en fail-closed). Un hôte prudent
 * replie sur le lecteur du navigateur au bout de quelques secondes ; dans le second cas, ce repli
 * OUVRE un document que le player venait de fermer. Le silence était donc un trou de sécurité.
 *
 * On répond `embed-denied` : la décision reste la nôtre, l'hôte apprend seulement à ne pas replier.
 */
function sendRefusal(res, reason, embed) {
  if (!embed) return sendHtml(res, 404, notFoundHtml());
  const nonce = crypto.randomBytes(16).toString("base64");
  const html = notFoundHtml() + `<script nonce="${nonce}">try{parent.postMessage({type:"3dd-doc-embed-denied",reason:${JSON.stringify(String(reason))}},"*")}catch(e){}</script>`;
  return sendHtml(res, 404, html, `'nonce-${nonce}'`, "", embedFrameAncestors());
}

function notFoundHtml() {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Document indisponible</title><body style="font:15px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f3f1ed;color:#222"><div style="text-align:center"><div style="font-weight:800;font-size:18px;margin-bottom:6px">Document indisponible</div><div style="color:#777">Ce lien n'est plus valide ou a été révoqué.</div></div>`;
}

// Page « soft wall » : accès à un document réservé (require_auth). On ne demande PAS un compte,
// on propose de RECEVOIR le document — l'email est l'action pour débloquer, pas un péage.
// Email → code à 6 chiffres → cookie posé → reload → le lecteur s'ouvre. (Google = Lot B.)
function softWallHtml(share, nonce, logoUrl, googleClientId) {
  const title = esc(share.doc_title || share.file_name || "ce document");
  const brandLogo = esc(share.brand_logo || "");
  const dark = !!share.brand_dark;
  const logo = brandLogo || esc(logoUrl || "");
  const logoAlt = brandLogo ? esc(share.brand_name || "") : "";
  const poweredBy = !!brandLogo; // logo promoteur → mention 3DD dessous
  const gcid = esc(googleClientId || "");
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name=robots content="noindex,nofollow"><link rel=icon href="data:,">
<title>Accès — ${title}</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{font:15px/1.55 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1c1a17;
    background:${dark ? "#16181d" : "radial-gradient(120% 90% at 20% 0%,#efe9df 0%,#e7e0d4 55%,#ddd4c4 100%)"};
    display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:100%;max-width:420px;background:#fff;border-radius:20px;padding:34px 32px 26px;
    box-shadow:0 24px 70px rgba(30,22,12,.20);text-align:center}
  .logo{max-height:44px;max-width:190px;margin:0 auto 22px;display:block;object-fit:contain}
  h1{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:0 0 6px}
  .sub{font-size:13.5px;color:#7c7266;margin:0 0 22px}
  .doc{font-weight:700;color:#1c1a17}
  label{display:block;text-align:left;font-size:12px;font-weight:700;color:#3a352e;margin:0 0 6px}
  input{width:100%;padding:13px 14px;border:1px solid #ddd4c6;border-radius:12px;font:inherit;font-size:15px;background:#fbf9f6;outline:none;transition:border-color .15s,box-shadow .15s}
  input:focus{border-color:#c8996a;box-shadow:0 0 0 3px #c8996a22}
  .btn{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;font:inherit;font-size:15px;font-weight:700;color:#fff;background:#1c1a17;cursor:pointer;transition:transform .06s,opacity .15s}
  .btn:active{transform:scale(.985)}.btn:disabled{opacity:.5;cursor:default}
  .step2{display:none}.step2.on{display:block}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .err{color:#c0392b;font-size:12.5px;min-height:16px;margin:10px 0 0}
  .ok{color:#177245}
  .legal{font-size:11px;color:#a79c8d;margin:16px 0 0;line-height:1.5}
  .pb{margin-top:16px;font-size:11px;color:#b3ab9d}
  .field{margin-top:14px}
  .gbtn{display:flex;justify-content:center;margin:2px 0 4px}
  .orsep{display:flex;align-items:center;gap:10px;color:#a79c8d;font-size:11.5px;margin:6px 0 12px}
  .orsep::before,.orsep::after{content:"";flex:1;height:1px;background:#e8e0d3}
</style></head>
<body>
  <div class=card>
    ${logo ? `<img class=logo src="${logo}" alt="${logoAlt}">` : ""}
    <h1>Accédez à votre document</h1>
    <p class=sub><span class=doc>${title}</span><br>Débloquez-le en un instant.</p>

    ${gcid ? `<div id=gbtn class=gbtn></div><div class=orsep><span>ou par email</span></div>` : ""}
    <div id=s1>
      <div class=field><label>Votre email</label><input id=email type=email autocomplete=email inputmode=email placeholder="prenom@email.fr"></div>
      <button class=btn id=send>Recevoir mon accès</button>
    </div>

    <div id=s2 class=step2>
      <div class=row2>
        <div><label>Votre nom</label><input id=name type=text autocomplete=name placeholder="Prénom Nom"></div>
        <div><label>Code reçu</label><input id=code type=text inputmode=numeric autocomplete=one-time-code maxlength=6 placeholder="123456"></div>
      </div>
      <button class=btn id=verify>Débloquer le document</button>
    </div>

    <p class=err id=err></p>
    <p class=legal>Vos coordonnées permettent au conseiller de vous recontacter au sujet de ce projet. Désinscription possible à tout moment.</p>
    ${poweredBy && PLAYER.branding.poweredBy ? `<p class=pb>Powered by ${esc(PLAYER.branding.poweredBy)}</p>` : ""}
  </div>
${gcid ? `<script nonce="${nonce}" src="https://accounts.google.com/gsi/client" async></script>` : ""}
<script nonce="${nonce}">
  var SLUG=${JSON.stringify(share.slug || "")};
  var GCID=${JSON.stringify(gcid)};
  var $=function(id){return document.getElementById(id);};
  function err(m){$('err').className='err';$('err').textContent=m||'';}
  function post(o){return fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j};});});}
  $('send').onclick=function(){
    var em=($('email').value||'').trim();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)){err('Entrez un email valide.');return;}
    $('send').disabled=true;$('send').textContent='Envoi…';err('');
    post({action:'visitor-request',slug:SLUG,email:em}).then(function(r){
      $('send').disabled=false;$('send').textContent='Recevoir mon accès';
      if(r.j&&r.j.ok){$('s2').classList.add('on');$('err').className='err ok';$('err').textContent='Code envoyé à '+em+'. Vérifiez votre boîte mail.';$('code').focus();}
      else err(r.s===429?'Trop de demandes, réessayez plus tard.':'Envoi impossible, réessayez.');
    }).catch(function(){$('send').disabled=false;$('send').textContent='Recevoir mon accès';err('Erreur réseau.');});
  };
  $('verify').onclick=function(){
    var em=($('email').value||'').trim(),cd=($('code').value||'').trim(),nm=($('name').value||'').trim();
    if(!/^\\d{6}$/.test(cd)){err('Entrez le code à 6 chiffres.');return;}
    $('verify').disabled=true;$('verify').textContent='Vérification…';err('');
    post({action:'visitor-verify',slug:SLUG,email:em,code:cd,name:nm}).then(function(r){
      if(r.j&&r.j.ok){$('verify').textContent='Accès débloqué ✓';location.reload();}
      else{$('verify').disabled=false;$('verify').textContent='Débloquer le document';err(r.j&&r.j.error==='expiré'?'Code expiré, renvoyez-en un.':'Code incorrect.');}
    }).catch(function(){$('verify').disabled=false;$('verify').textContent='Débloquer le document';err('Erreur réseau.');});
  };
  $('code')&&$('code').addEventListener('keydown',function(e){if(e.key==='Enter')$('verify').click();});
  $('email')&&$('email').addEventListener('keydown',function(e){if(e.key==='Enter')$('send').click();});
  function onGoogle(resp){ if(!resp||!resp.credential){return;} err('');
    post({action:'visitor-google',slug:SLUG,credential:resp.credential}).then(function(r){
      if(r.j&&r.j.ok){location.reload();} else err('Connexion Google impossible, essayez par email.');
    }).catch(function(){err('Connexion Google impossible, essayez par email.');});
  }
  function initG(tries){ tries=tries||0;
    if(!window.google||!google.accounts||!google.accounts.id){ if(tries<40){return setTimeout(function(){initG(tries+1);},120);} return; }
    google.accounts.id.initialize({client_id:GCID,callback:onGoogle,auto_select:false});
    var w=Math.min(340,(document.querySelector('.card')||{}).clientWidth-64||320);
    google.accounts.id.renderButton($('gbtn'),{type:'standard',theme:'outline',size:'large',shape:'pill',text:'continue_with',logo_alignment:'center',width:w});
    try{google.accounts.id.prompt();}catch(e){}
  }
  if(GCID){initG(0);}
</script>
</body></html>`;
}

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
  const cfg = JSON.stringify({ brand: PLAYER.branding.name, slug: preview ? "" : share.slug, fileUrl, fileName: share.file_name || "", pdfjs: PDFJS, title, preview, embed, embedded, bot: botOn, botGuided: !preview && !!share.bot_enabled && share.bot_guided !== false, botAv: (!preview && share.bot_enabled && share.bot_avatar) || "", botName: (!preview && share.bot_enabled && share.bot_name) || "", botGreet: (!preview && share.bot_enabled && share.bot_greeting) || "", botGreetDoc: (!preview && share.bot_enabled && share.bot_greeting_doc) || "", dl: share.allow_download !== false, autoPresent: !!share.auto_present, botAnim: share.bot_page_anim !== false, botVoice: !preview && !!share.bot_enabled && !!process.env.ELEVENLABS_API_KEY, vIcOn: ICONS.sound, vIcOff: ICONS.mute, kStyle: (!preview && share.bot_enabled && share.bot_karaoke) || "classic", vLayout: (!preview && share.bot_enabled && share.video_layout) || "", vClips: !preview && !!share.bot_vclips, botVAv: (!preview && share.bot_enabled && share.bot_vphoto) || "", resumeSlug: preview ? (share.resume_slug || "") : "", supaUrl: preview ? (share.supa_url || "") : "", supaKey: preview ? (share.supa_key || "") : "", internal: preview && share.internal_email ? { email: share.internal_email, name: share.presenter_name || "", docId: share.doc_id || "" } : null, present: preview ? { url: share.raw_url || "", name: share.file_name || "", title: share.doc_title || "", docId: share.doc_id || "", by: share.presenter_name || "", email: share.internal_email || "", av: share.presenter_avatar || "" } : null });
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=3,viewport-fit=cover,interactive-widget=resizes-content">
<meta name=robots content="noindex,nofollow">
<link rel=icon href="data:,">
<link rel=preconnect href="https://cdnjs.cloudflare.com" crossorigin>
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
  .scroll{flex:1;overflow:auto;position:relative}
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
  .lpct{font-size:11px;color:#8a857c;letter-spacing:.04em;text-transform:uppercase;font-weight:600}
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
    .bar .zoom,#fs,#presentBtn,#shareBtn,#dlBtn{display:none}
    .barMore{display:inline-flex}
  }
  @media (max-width:520px){ .bar>b{display:none} }
  /* Structure doc+colonne : TOUJOURS émise — un lien sans bot ni live n'avait ni LIVE_CSS ni BOT_CSS
     → .lrow/.lmain sans flex, la fenêtre scrollait à la place du conteneur et le rendu paresseux mourait. */
  .lrow{flex:1;display:flex;min-height:0;position:relative}
  .lmain{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
  ${preview ? LIVE_CSS : ""}
  ${preview ? MAP_CSS : ""}
  ${botOn ? BOT_CSS : ""}
</style></head>
<body>
  <div class=bar>${embed ? '<button class="ic barx" id=embedCloseBtn title=Fermer aria-label=Fermer><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ""}<b>${title}</b>${share.is_test ? '<span class=testchip>\ud83c\udfad Répétition — session de test</span>' : ""}<span class=sp></span><span class=pg id=pg></span>
    ${preview ? LIVE_BAR : ""}
    <div class=zoom><button id=zout title="Dézoomer">−</button><span id=zlbl>100%</span><button id=zin title="Zoomer">+</button></div>
    <button class=ic id=fs title="Plein écran"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
    ${preview ? '<button class=dl id=presentBtn title="Présenter en direct (lien public, page synchronisée)">Présenter</button>' : ''}
    <button class="dl primary" id=shareBtn>Partager</button>
    ${share.allow_download === false ? "" : `<a class=dl id=dlBtn href="${fileUrl}" download>Télécharger</a>`}<button class="ic barMore" id=barMore title="Plus d'actions">⋯</button>${preview ? '<button class=ic id=closeBtn title="Fermer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ''}</div>
  <div class=barmenu id=barMenu>
    <button data-t=zin>Zoom avant</button>
    <button data-t=zout>Zoom arrière</button>
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
    <div class=lmain>
      <div class=scroll id=scroll>
        <div id=pages></div>
        <div id=load class="${brandDark ? "ldark" : ""}${brandLogo ? "" : " has-intro"}">${brandLogo || !PLAYER.branding.loaderName ? "" : `<div class=lintro id=lintro data-theme="${brandDark ? "dark" : "light"}"><div class=lword>${esc(PLAYER.branding.loaderName)}</div></div>`}<div class=lbox>${brandLogo ? `<img class=lbrand src="${brandLogo}" alt="${brandName}">${PLAYER.branding.poweredBy ? `<div class=lpowered>Powered by ${esc(PLAYER.branding.poweredBy)}</div>` : ""}` : ""}<div class="lbar idle" id=lbar><i id=lbarFill></i></div><div class=lpct id=lpct>Chargement…</div></div></div>
      </div>
      ${share.bot_enabled ? `<button class="op-arrow op-prev" id=opPrev title="Page précédente" aria-label="Page précédente">${ICONS.prev}</button><button class="op-arrow op-next" id=opNext title="Page suivante" aria-label="Page suivante">${ICONS.next}</button><div class=dcap id=dcap><span class=dcap-av>${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : esc(String(share.bot_name || "◆").trim().charAt(0).toUpperCase())}</span><div class=dcap-body><div id=dcapT></div></div></div><div class=dkov id=dkov><div class=dkov-card><button class=dkov-big id=dkovBig aria-label="Reprendre la présentation">${ICONS.play}</button><div class=dkov-opts id=dkovOpts></div></div></div><div class=rateov id=rateov><div class=rate-card><button class=rate-x id=rateX aria-label=Fermer>${ICONS.close}</button><b>Votre avis compte</b><p>Comment avez-vous trouvé cette présentation ?</p><div class=rate-stars id=rateStars></div><span class=rate-thx>Merci pour votre retour \ud83d\ude4f</span></div></div><div class=qov id=qov><div class=qov-card id=qovCard></div></div><div class=byeov id=byeov><div class=bye-card><span class=bye-av>${share.bot_avatar ? `<img src="${esc(share.bot_avatar)}" alt="">` : esc(String(share.bot_name || "◆").trim().charAt(0).toUpperCase())}</span><b id=byeT>Merci !</b><p id=byeS>Et à très bientôt</p></div></div><div class=pgline id=pgline><i id=pglineF></i></div>` : ""}
      ${preview ? MAP_MARKUP : ""}
    </div>
    ${preview ? LIVE_PANEL : ""}
    ${botOn ? botMarkup(share, pitch) : ""}
  </div>
  ${PLAYER.branding.poweredBy ? `<div class=brand>Propulsé par ${esc(PLAYER.branding.poweredBy)}</div>` : ""}
  ${legalFooter({ tracked: !preview && !!share.slug, sansExpediteur: !share.recipient_email && !share.created_by })}
  ${brandLogo || !brandIntroRuntime ? "" : `<script nonce="${nonce}">(${brandIntroRuntime.toString()})();</script>`}
  <script nonce="${nonce}">${PLAYER_BROWSER_JS}</script>
  <script nonce="${nonce}" src="${PDFJS}/pdf.min.js"></script>
  ${preview ? `<script nonce="${nonce}" src="${SUPAJS}"></script>
  <script nonce="${nonce}">var LIVECFG={supaUrl:${JSON.stringify(share.supa_url || "")},supaKey:${JSON.stringify(share.supa_key || "")}};var GMAPS_KEY=${JSON.stringify((PLAYER.config && PLAYER.config.mapsKey) || "" || "")};${LIVE_JS}
  ${MAP_JS}</script>` : ""}
  <script nonce="${nonce}">
  (function(){
    var CFG=${cfg.replace(/</g, "\\u003c")};
    var cur=0, numPages=0;
    // Nature du document : le nom de fichier fait foi (le type MIME n'est pas toujours
    // renvoyé par le stockage). Une image = une page, sans pdf.js.
    var IS_IMG=Player.viewer.isImageDocument(CFG.fileName,CFG.fileUrl);
    var imgSrc='';
    var scrollEl=document.getElementById('scroll'), pagesEl=document.getElementById('pages');
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
    var pdfDoc=null, zoom=1, firstAspect=1.35, rendered={}, io=null, ioCur=null;
    var onePage=false, soloOffered=false; // mode « une seule page » (présentation guidée) + offre de découverte solo
    function setCur(p){ if(!p||p===cur)return; cur=p; T.setPage(p); try{ if(window.__soloEnd)window.__soloEnd(p); }catch(e){} var pg=document.getElementById('pg'); if(pg&&numPages)pg.textContent='Page '+p+' / '+numPages; if(PRES) pushPage(); }
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
    var PRES=null, _pushT=null, _hbIv=0;
    // JWT de la session app (MÊME ORIGINE, localStorage) → autorise le rattachement de la présentation au membre
    // (reprise / liste / transfert) et les actions authentifiées (reclaim).
    function appToken(){ try{ var raw=localStorage.getItem('3dd-supabase-auth'); if(!raw)return''; var s=JSON.parse(raw); var t=(s&&(s.access_token||(s.currentSession&&s.currentSession.access_token)||(s.session&&s.session.access_token)))||''; return t; }catch(e){ return ''; } }
    function ctlKey(slug){ return '3dd-pres-ctl-'+slug; }
    function saveCtl(slug,control){ try{ localStorage.setItem(ctlKey(slug),control); }catch(e){} }
    function clearCtl(slug){ try{ localStorage.removeItem(ctlKey(slug)); }catch(e){} }
    // Heartbeat : signale que la présentation est vivante (sinon marquée « orpheline » côté serveur au bout de 3 min).
    function startHb(){ clearInterval(_hbIv); _hbIv=setInterval(function(){ if(!PRES){ clearInterval(_hbIv); return; } fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-touch',slug:PRES.slug,control:PRES.control})}).catch(function(){}); },30000); }
    function showBar(slug){ var lk=document.getElementById('pbarLink'); if(lk) lk.value=location.origin+'/present/'+slug; var pb=document.getElementById('pbar'); if(pb) pb.style.display='flex'; }
    // Le présentateur DIFFUSE l'état qu'il vient de persister. La base reste la vérité (les
    // arrivants tardifs la relisent) ; la diffusion évite à l'audience de lire la table.
    function diffuserEtat(extra){ if(!PRES||!window.Live)return; try{ Live.sendState(Object.assign({active:true,current_page:cur||1,file_url:CFG.present&&CFG.present.url||null,updated_at:new Date().toISOString()},extra||{})); }catch(e){} }
    function pushPage(){ if(!PRES)return; clearTimeout(_pushT); _pushT=setTimeout(function(){ if(!PRES)return; diffuserEtat({current_page:cur||1}); fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-page',slug:PRES.slug,control:PRES.control,page:cur||1})}).catch(function(){}); },250); }
    function endPresent(){ if(!PRES)return; diffuserEtat({active:false}); var p=PRES; PRES=null; clearInterval(_hbIv); clearCtl(p.slug); var pb=document.getElementById('pbar'); if(pb)pb.style.display='none'; try{ if(window.Live) Live.disconnect(); }catch(e){} try{ var b=JSON.stringify({action:'present-end',slug:p.slug,control:p.control}); if(navigator.sendBeacon){navigator.sendBeacon('/api/doc',new Blob([b],{type:'application/json'}));} else {fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});} }catch(e){} }
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
          PRES={slug:d.slug,control:d.control}; saveCtl(d.slug,d.control);
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
          PRES={slug:slug,control:d.control}; saveCtl(slug,d.control);
          showBar(slug); liveConnect(slug,d.control); startHb();
          var target=Math.max(1,d.page||1);
          var tries=0; (function jump(){ var el=(document.getElementById('pages')||document).querySelector('.page[data-p="'+target+'"]'); if(el){ el.scrollIntoView({block:'start'}); } else if(tries++<40){ setTimeout(jump,150); } })();
        }).catch(function(){});
    }
    // Carte live : persiste le contenu (present-content, JWT) → l'audience bascule/suit via Realtime.
    function presentContent(content){ if(!PRES)return; diffuserEtat({content:content||null}); var h={'Content-Type':'application/json'}; var tk=appToken(); if(tk) h['Authorization']='Bearer '+tk; fetch('/api/doc',{method:'POST',headers:h,body:JSON.stringify({action:'present-content',slug:PRES.slug,content:content})}).catch(function(){}); }
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
    if(!window.pdfjsLib){ loadError("Impossible de charger la visionneuse."); return; }
    function start(){
      // Ouverture journalisée, chrono lancé, écouteurs de visibilité / focus / inactivité posés.
      T.start();
      document.getElementById('zin').addEventListener('click',function(){ setZoom(zoom+0.2); });
      document.getElementById('zout').addEventListener('click',function(){ setZoom(zoom-0.2); });
      render();
    }
    function setZoom(z){ zoom=Player.viewer.clampZoom(z); document.getElementById('zlbl').textContent=Math.round(zoom*100)+'%'; if(pdfDoc) build(); }
    // Vrai worker SAME-ORIGIN via blob (un Worker cross-origin est bloqué par le navigateur → "fake worker").
    var wsrc=CFG.pdfjs+'/pdf.worker.min.js';
    try{
      fetch(wsrc).then(function(r){return r.ok?r.text():null;}).then(function(t){
        try{ pdfjsLib.GlobalWorkerOptions.workerSrc = t ? URL.createObjectURL(new Blob([t],{type:'application/javascript'})) : wsrc; }catch(e){ pdfjsLib.GlobalWorkerOptions.workerSrc=wsrc; }
        start();
      }).catch(function(){ pdfjsLib.GlobalWorkerOptions.workerSrc=wsrc; start(); });
    }catch(e){ pdfjsLib.GlobalWorkerOptions.workerSrc=wsrc; start(); }
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
    function targetWidth(){ return Player.viewer.fitWidth({containerWidth:baseWidth(),containerHeight:scrollEl.clientHeight,zoom:zoom,onePage:onePage,aspect:firstAspect,overlap:botOverlap(),reserve:onePageReserve()}); }
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
        document.getElementById('pg').textContent='Page 1 / '+pdf.numPages;
        pdf.getPage(1).then(function(p){ var vp=p.getViewport({scale:1}); firstAspect=vp.height/vp.width; build(); try{if(window.PlayerBot)window.PlayerBot.init(VIEWER);}catch(e){} })
          .catch(function(){ build(); try{if(window.PlayerBot)window.PlayerBot.init(VIEWER);}catch(e){} });
      }).catch(function(){ loadError("Impossible d'afficher ce document."); });
    }
    function build(){
      rendered={};
      if(io) io.disconnect();
      if(ioCur) ioCur.disconnect();
      // PRÉ-RENDU : marge de 500px → on rend les pages un peu avant qu'elles arrivent (fluide).
      io=new IntersectionObserver(function(es){es.forEach(function(e){var n=+e.target.dataset.p; if(e.isIntersecting){renderPage(n,e.target);}});},{root:scrollEl,rootMargin:Player.viewer.PRERENDER_MARGIN,threshold:0.01});
      // PAGE COURANTE : bande FINE au centre du viewport (marge négative) → cur = la page réellement centrée,
      // pas polluée par la marge de pré-rendu. Corrige le décalage d'une page présentateur ↔ audience.
      ioCur=new IntersectionObserver(function(es){es.forEach(function(e){ if(e.isIntersecting){ setCur(+e.target.dataset.p); } });},{root:scrollEl,rootMargin:Player.viewer.CURRENT_PAGE_MARGIN,threshold:0});
      pagesEl.innerHTML='';
      var w=Math.round(targetWidth());
      for(var i=1;i<=numPages;i++){ var d=document.createElement('div'); d.className='page ph'; d.dataset.p=i; d.style.width=w+'px'; d.style.height=Math.round(w*firstAspect)+'px'; d.textContent='Page '+i; pagesEl.appendChild(d); io.observe(d); ioCur.observe(d); }
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
    function renderPage(n,el){ if(rendered[n])return; rendered[n]=1;
      if(IS_IMG){
        var w=Math.round(targetWidth());
        var im=document.createElement('img');
        im.src=imgSrc; im.alt=''; im.style.width=w+'px'; im.style.display='block';
        el.style.height=''; el.classList.remove('ph'); el.textContent=''; el.style.width=w+'px';
        el.appendChild(im);
        im.onload=function(){ hideLoader(); };
        if(im.complete) hideLoader();
        return;
      }
      pdfDoc.getPage(n).then(function(page){
      var dpr=window.devicePixelRatio||1;
      var scale=Math.min(5,targetWidth()/page.getViewport({scale:1}).width);
      var v=page.getViewport({scale:scale});
      var c=document.createElement('canvas');
      c.width=Math.floor(v.width*dpr); c.height=Math.floor(v.height*dpr);   // backing store HD → net comme du natif
      c.style.width=v.width+'px'; c.style.height=v.height+'px';
      el.style.height=''; el.classList.remove('ph'); el.textContent=''; el.style.width=v.width+'px'; el.appendChild(c); // classList.remove (PAS className=) : ne pas écraser .cur — en mode une-page la page disparaissait une fois rendue (refit après réduction/réouverture du chat)
      page.render({canvasContext:c.getContext('2d'),viewport:v,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise.then(function(){ hideLoader(); if(n===cur)setTimeout(vsplitTint,60); });
      // Couche texte (sélection). En pdf.js v3, les spans utilisent font-size:calc(var(--scale-factor)*Npx)
      // → SANS --scale-factor, taille nulle = pas de sélection. On le pose sur le conteneur.
      try{ page.getTextContent().then(function(tc){
        var tl=document.createElement('div'); tl.className='textLayer';
        tl.style.width=v.width+'px'; tl.style.height=v.height+'px'; tl.style.setProperty('--scale-factor', scale);
        el.appendChild(tl);
        try{ pdfjsLib.renderTextLayer({textContentSource:tc,container:tl,viewport:v}); }
        catch(e){ try{ pdfjsLib.renderTextLayer({textContent:tc,container:tl,viewport:v}); }catch(e2){} }
      }); }catch(e){}
    }); }
    // ── Assistant IA « présentateur » : chat requête/réponse (bot-start/bot-say) + saut de page piloté ──
${botOn && botBrowser ? botBrowser.botViewerJs(ICONS) : ""}
  })();
  </script>
</body></html>`;
}

// CSP de la page audience (Présenter) : autorise pdf.js (cdnjs), supabase-js (jsdelivr) et la connexion
// Realtime (https + wss vers le projet Supabase). Plus permissive que la visionneuse, limitée à cette page.
function sendPresentHtml(res, html, nonce, supaUrl, imgExtra, frameAncestors) {
  const wss = String(supaUrl || "").replace(/^https:/, "wss:");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com`,
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
    `connect-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://nominatim.openstreetmap.org https://*.googleapis.com https://*.gstatic.com ${supaUrl} ${wss}`,
    `img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.googleusercontent.com ${supaUrl}${imgExtra ? " " + imgExtra : ""}`,
    "style-src 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    `frame-ancestors ${frameAncestors || "'none'"}`,
  ].join("; "));
  res.end(html);
}

// Page AUDIENCE d'une présentation live : affiche UNE page (celle du présentateur), suivie en temps réel
// via Supabase Realtime. Navigation verrouillée (page à page). « Terminée » quand le présentateur ferme.
function presentHtml(pres, nonce, logoUrl, supaUrl, supaKey) {
  const title = esc(pres.doc_title || pres.file_name || "Document");
  const presenter = esc(pres.presenter_name || "");
  const logo = esc(logoUrl || "");
  const fileUrl = `/api/doc?present=${encodeURIComponent(pres.slug)}&file=1`;
  const cfg = JSON.stringify({ fileUrl, docUrl: pres.file_url, pdfjs: PDFJS, slug: pres.slug, page: pres.current_page || 1, active: pres.active !== false, content: pres.content || null, supaUrl, supaKey, title: pres.doc_title || pres.file_name || "Document" });
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=3">
<meta name=robots content="noindex,nofollow">
<link rel=preconnect href="https://cdnjs.cloudflare.com" crossorigin>
<title>${esc(PLAYER.branding.title(pres.doc_title || pres.file_name || "Document", "Présentation"))}</title>
<style>
  :root{--bg:#23211e;--bar:#1a1916}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{background:var(--bg);font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#eee;display:flex;flex-direction:column;overflow:hidden}
  .bar{display:flex;align-items:center;gap:14px;padding:10px 16px;background:var(--bar);border-bottom:1px solid #0004;flex:none}
  .bar b.t{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw}
  .live{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.06em;color:#ff5d5d;text-transform:uppercase}
  .live i{width:8px;height:8px;border-radius:50%;background:#ff3b3b;animation:blink 1.4s ease-in-out infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
  .sp{flex:1}
  .pg{font-size:12.5px;color:#cfcbc4;white-space:nowrap}
  .pg b{color:#fff}
  .by{font-size:12px;color:#a6a199;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:24vw}
  .stage{flex:1;position:relative;display:flex;align-items:center;justify-content:center;padding:20px;overflow:hidden}
  #page{background:#fff;box-shadow:0 10px 40px #0008;border-radius:3px;max-width:100%;max-height:100%}
  #page canvas{display:block;border-radius:3px;max-width:100%;max-height:100%}
  #load{position:absolute;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:4;transition:opacity .4s}
  #load.hide{opacity:0;pointer-events:none}
  .lbox{display:flex;flex-direction:column;align-items:center;gap:18px}
  .lbox img{height:34px;opacity:.92;animation:lp 1.6s ease-in-out infinite}
  .lword{font-weight:800;font-size:20px;color:#fff;animation:lp 1.6s ease-in-out infinite}
  @keyframes lp{0%,100%{opacity:.5}50%{opacity:1}}
  .lsub{font-size:11.5px;color:#8a857c;letter-spacing:.03em}
  .ended{position:absolute;inset:0;background:rgba(20,18,15,.93);display:none;align-items:center;justify-content:center;z-index:6;text-align:center;padding:24px}
  .ended .ettl{font-size:20px;font-weight:800;margin-bottom:8px}
  .ended .esub{font-size:13.5px;color:#bbb}
  .ended .elogo{height:30px;margin-bottom:22px;opacity:.9}
  .takeover{position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:70;display:none;align-items:center;gap:8px;border:0;background:#e5384d;color:#fff;font:inherit;font-size:13.5px;font-weight:700;padding:11px 20px;border-radius:999px;cursor:pointer;box-shadow:0 10px 34px rgba(0,0,0,.35);animation:tkPulse 2s infinite}
  @keyframes tkPulse{0%,100%{box-shadow:0 10px 34px rgba(229,56,77,.35)}50%{box-shadow:0 10px 34px rgba(229,56,77,.7)}}
  .takeover:hover{background:#cf2d40}
  .brand{position:fixed;right:13px;bottom:9px;font-size:10px;color:#fff;opacity:.4;pointer-events:none;z-index:3}
  .ic{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #fff3;background:transparent;color:#fff;border-radius:8px;cursor:pointer;padding:0}
  .ic svg{width:16px;height:16px}.ic:hover{background:#fff2}
  @media (max-width:700px){ .bar{gap:9px;padding:9px 12px} .by{display:none} .live{font-size:0;gap:0} .live i{width:9px;height:9px} .bar b.t{max-width:34vw} }
  @media (max-width:430px){ .bar b.t{max-width:40vw} .pg{font-size:11.5px} }
  ${LEGAL_CSS}
  ${LIVE_CSS}
  ${MAP_CSS}
</style></head>
<body>
  <div class=bar>
    <b class=t id=ptitle>${title}</b>
    <span class=live><i></i> En direct</span>
    <span class=sp></span>
    <span class=pg>Page <b id=cur>${pres.current_page || 1}</b> / <span id=tot>—</span></span>
    ${presenter ? `<span class=by>par ${presenter}</span>` : ""}
    ${LIVE_BAR}
  </div>
  <button class=takeover id=takeOver style="display:none">🎤 Vous êtes le présentateur — Reprendre la main</button>
  <div class=lrow>
    <div class=lmain>
      <div class=stage id=stage>
        <div id=page></div>
        ${MAP_MARKUP}
        <div id=load><div class=lbox>${logo ? `<img src="${logo}" alt="${esc(PLAYER.branding.loaderName || "Chargement")}">` : (PLAYER.branding.loaderName ? `<div class=lword>${esc(PLAYER.branding.loaderName)}</div>` : "")}<div class=lsub>Connexion à la présentation…</div></div></div>
        <div class=ended id=ended><div>${logo ? `<img class=elogo src="${logo}" alt="">` : ""}<div class=ettl>Présentation terminée</div><div class=esub>Le présentateur a mis fin à la session.</div></div></div>
      </div>
    </div>
    ${LIVE_PANEL}
  </div>
  ${PLAYER.branding.poweredBy ? `<div class=brand>Propulsé par ${esc(PLAYER.branding.poweredBy)}</div>` : ""}
  ${legalFooter({ tracked: true })}
  <script nonce="${nonce}">${PLAYER_BROWSER_JS}</script>
  <script nonce="${nonce}" src="${PDFJS}/pdf.min.js"></script>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script nonce="${nonce}">
  (function(){
    var CFG=${cfg.replace(/</g, "\\u003c")};
    var PDF=null, total=0, cur=CFG.page||1, ready=false;
    var stage=document.getElementById('stage'), pageEl=document.getElementById('page');
    function hideLoader(){ var l=document.getElementById('load'); if(l){ l.classList.add('hide'); setTimeout(function(){ if(l.parentNode)l.parentNode.removeChild(l); },450);} }
    function ended(){ document.getElementById('ended').style.display='flex'; }
    function show(n){
      if(!PDF) return;
      n=Math.max(1,Math.min(total||1, n||1)); cur=n;
      var c=document.getElementById('cur'); if(c)c.textContent=n;
      PDF.getPage(n).then(function(page){
        var availW=Math.max(120, stage.clientWidth-40), availH=Math.max(120, stage.clientHeight-40);
        var v1=page.getViewport({scale:1});
        var scale=Math.min(availW/v1.width, availH/v1.height); // fit entier → une page à l'écran
        var dpr=window.devicePixelRatio||1, vp=page.getViewport({scale:scale});
        var cv=document.createElement('canvas'); cv.width=Math.floor(vp.width*dpr); cv.height=Math.floor(vp.height*dpr);
        cv.style.width=vp.width+'px'; cv.style.height=vp.height+'px';
        page.render({canvasContext:cv.getContext('2d'),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
        pageEl.innerHTML=''; pageEl.appendChild(cv);
      });
    }
    var wsrc=CFG.pdfjs+'/pdf.worker.min.js';
    function boot(){
      fetch(wsrc).then(function(r){return r.ok?r.text():null;}).then(function(t){
        try{ pdfjsLib.GlobalWorkerOptions.workerSrc=t?URL.createObjectURL(new Blob([t],{type:'application/javascript'})):wsrc; }catch(e){ pdfjsLib.GlobalWorkerOptions.workerSrc=wsrc; }
        load();
      }).catch(function(){ pdfjsLib.GlobalWorkerOptions.workerSrc=wsrc; load(); });
    }
    function load(){
      pdfjsLib.getDocument({url:CFG.fileUrl,isEvalSupported:false}).promise.then(function(pdf){
        PDF=pdf; total=pdf.numPages; ready=true;
        var tot=document.getElementById('tot'); if(tot)tot.textContent=total;
        show(cur); hideLoader();
        if(!CFG.active) ended();
      }).catch(function(){ var l=document.getElementById('load'); if(l)l.querySelector('.lsub').textContent="Document indisponible."; });
    }
    // Le présentateur a changé de document (même session) → recharger le PDF servi par le proxy (URL identique →
    // cache-buster obligatoire), remettre à la page 1, mettre à jour le titre.
    function switchDoc(row){
      var t=document.getElementById('ptitle'); if(t) t.textContent=row.doc_title||row.file_name||'Document';
      var pg=document.getElementById('page'); if(pg) pg.innerHTML='';
      cur=1; total=0; ready=false;
      var tot=document.getElementById('tot'); if(tot)tot.textContent='—';
      var cu=document.getElementById('cur'); if(cu)cu.textContent='1';
      CFG.fileUrl='/api/doc?present='+encodeURIComponent(CFG.slug)+'&file=1&v='+encodeURIComponent(row.updated_at||String(row.current_page||1));
      load();
    }
    if(window.pdfjsLib) boot(); else { var s=document.querySelector('script[src*="pdf.min.js"]'); if(s)s.addEventListener('load',boot); }
    window.__refit=function(){ if(ready) show(cur); };
    var _rzA; window.addEventListener('resize',function(){ clearTimeout(_rzA); _rzA=setTimeout(function(){ if(ready) show(cur); },140); });
    // Ce que l'audience fait d'un état reçu — player/src/presentation-state.ts, testé.
    // TROIS sources l'alimentent : la table (ci-dessous), une relecture d'état, et bientôt une
    // diffusion temps réel. La règle d'ordre (terminée > carte > changement de doc > page) et la
    // re-validation du contenu vivent dans le module, pas ici.
    var _etatVu='';
    // ⚠️ EXPOSÉ HORS DE CETTE FERMETURE, ET C'EST INDISPENSABLE. La couche Live est définie dans
    // le bloc de script SUIVANT : y appeler onState avec ce nom-ci référence une fonction qui
    // n'existe pas dans cette portée-là. L'exception partait dans un try/catch muet, donc
    // l'audience n'avait aucun écouteur de diffusion — invisible tant que la lecture de table
    // portait encore la page, puis « les pages ne tournent plus » le jour où on l'a retirée.
    window.__presAppliquerEtat = appliquerEtat;
    function appliquerEtat(row){
      if(!row) return;
      // La table et la diffusion portent la même vérité : sans cette garde, chaque changement de
      // page serait rendu deux fois (scintillement), et chaque carte ré-ouverte inutilement.
      var sig=''; try{ sig=JSON.stringify([row.active,row.current_page,row.file_url,row.content]); }catch(e){ sig=String(Math.random()); }
      if(sig===_etatVu) return;
      _etatVu=sig;
      var actions=Player.presentationState.presentationTransition(row,{docUrl:CFG.docUrl});
      for(var i=0;i<actions.length;i++){ var a=actions[i];
        if(a.kind==='ended'){ ended(); return; }
        if(a.kind==='show-map'){ if(window.Map3DD){ if(a.content.kind==='streetview') Map3DD.enterSV(a.content,false); else Map3DD.enter(a.content,false); } return; }
        if(a.kind==='leave-map'){ if(window.Map3DD) Map3DD.exit(); }
        if(a.kind==='switch-doc'){ CFG.docUrl=a.url; switchDoc(row); return; }
        if(a.kind==='show-page'){ show(a.page); }
      }
    }
    // RELECTURE D'ÉTAT — la porte qui permettra de se passer de la lecture anonyme des tables.
    // Au retour d'un onglet caché ou d'une coupure réseau, on redemande l'état au serveur plutôt
    // que d'espérer avoir reçu tous les événements pendant l'absence.
    function relireEtat(){
      try{ fetch('/api/doc?present='+encodeURIComponent(CFG.slug)+'&state=1',{cache:'no-store'})
        .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok) appliquerEtat(d.state); }).catch(function(){}); }catch(e){}
    }
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') relireEtat(); });
    window.addEventListener('online', relireEtat);

    // ⚠️ PLUS D'ABONNEMENT À LA TABLE ICI. Il exigeait une lecture publique de
    // de la table des présentations — donc, avec la clé publiable, TOUTES les présentations de
    // l'instance. L'état arrive par diffusion du présentateur, et la relecture d'état ci-dessus
    // rattrape les arrivées tardives et les retours d'onglet en interrogeant le serveur.
    //
    // Le laisser en place n'était pas neutre : il ouvrait un abonnement qui ne recevra jamais
    // rien, ce qui donne l'impression que le suivi est branché alors qu'il ne l'est pas.
    // Si on rejoint alors que le présentateur est DÉJÀ sur une carte / Street View → l'afficher dès que Map3DD est prêt.
    if(CFG.content && (CFG.content.kind==='map'||CFG.content.kind==='streetview')){ var _mi=setInterval(function(){ if(window.Map3DD){ clearInterval(_mi); if(CFG.content.kind==='streetview')Map3DD.enterSV(CFG.content,false); else Map3DD.enter(CFG.content,false); } },100); setTimeout(function(){ clearInterval(_mi); },8000); }
  })();
  </script>
  <script nonce="${nonce}">
  var LIVECFG={supaUrl:${JSON.stringify(supaUrl || "")},supaKey:${JSON.stringify(supaKey || "")}};var GMAPS_KEY=${JSON.stringify((PLAYER.config && PLAYER.config.mapsKey) || "" || "")};
  ${LIVE_JS}
  ${MAP_JS}
  (function(){
    var slug=${JSON.stringify(pres.slug)};
    // Carte live : suivre en direct les mouvements du présentateur (broadcast).
    try{ if(window.Live&&window.Map3DD) Live.onMap(function(p){ Map3DD.apply(p); }); }catch(e){}
    // L'état arrive maintenant par DEUX voies : la table (historique) et la diffusion du
    // présentateur (nouvelle). Les deux passent par le même filtre, qui ignore un état déjà
    // appliqué — recevoir deux fois la même chose ne doit pas re-rendre la page.
    // Par la référence exposée plus haut : le nom local n'existe pas dans cette portée-ci.
    try{
      if(!window.Live || !window.__presAppliquerEtat) throw new Error('couche live absente');
      Live.onState(window.__presAppliquerEtat);
    }catch(e){
      // PLUS DE SILENCE ICI. Ce try/catch a avalé une ReferenceError : l'audience n'avait aucun
      // ecouteur d'etat, ce qui ne se voyait pas tant qu'une seconde voie portait la page. Un
      // cablage rate doit se dire, meme si la page continue de vivre.
      console.error('[present] suivi de l etat non branche :', e && e.message);
    }
    // « Reprendre la main » : si le membre connecté (même origine) devient propriétaire de CETTE présentation
    // (après un transfert), on affiche un bouton pour ouvrir la visionneuse en pilotage — sinon on ne peut pas
    // piloter depuis la page audience.
    function appTok(){ try{ var raw=localStorage.getItem('3dd-supabase-auth'); if(!raw)return''; var s=JSON.parse(raw); return (s&&(s.access_token||(s.currentSession&&s.currentSession.access_token)||(s.session&&s.session.access_token)))||''; }catch(e){return'';} }
    function checkOwner(){ var tk=appTok(); if(!tk)return; fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tk},body:JSON.stringify({action:'present-list'})}).then(function(r){return r.json();}).then(function(d){ var mine=false; if(d&&d.presentations){ for(var i=0;i<d.presentations.length;i++){ if(d.presentations[i].slug===slug&&d.presentations[i].mine){mine=true;break;} } } var b=document.getElementById('takeOver'); if(b)b.style.display=mine?'inline-flex':'none'; }).catch(function(){}); }
    function startOwnerWatch(){ var b=document.getElementById('takeOver'); if(b&&!b._w){b._w=1;b.addEventListener('click',function(){ location.href='/app/documents?resume='+encodeURIComponent(slug); });} checkOwner(); setInterval(checkOwner,12000); }
    var me=Live.detectMember();
    if(me){ Live.connect(slug, me); startOwnerWatch(); return; }
    var saved=null; try{ saved=JSON.parse(localStorage.getItem('3dd-present-me')||'null'); }catch(e){}
    if(saved&&saved.name){ Live.connect(slug, saved); return; }
    // Externe : on demande le nom pour participer.
    var o=document.createElement('div'); o.className='join';
    o.innerHTML='<div class=join-card><h4>Rejoindre la présentation</h4><p>Votre nom pour participer à la discussion.</p><input id=jName placeholder="Votre nom" maxlength=60 autocomplete=name><input id=jMail placeholder="Email (facultatif)" maxlength=120 autocomplete=email><button id=jGo>Rejoindre</button></div>';
    document.body.appendChild(o);
    var n=o.querySelector('#jName'); try{ n.focus(); }catch(e){}
    function go(){ var name=(n.value||'').trim()||'Invité'; var email=(o.querySelector('#jMail').value||'').trim(); var me2={name:name,email:email,avatar:'',member:false,role:'viewer'}; try{ localStorage.setItem('3dd-present-me',JSON.stringify(me2)); }catch(e){} o.parentNode&&o.parentNode.removeChild(o); Live.connect(slug, me2); }
    o.querySelector('#jGo').addEventListener('click',go);
    n.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
  })();
  </script>
</body></html>`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let data = ""; req.on("data", (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

/**
 * Paramètres de la requête, quelle que soit la plateforme.
 *
 * Le gestionnaire lit `req.query` — la convention des plateformes serverless (Vercel, Next.js) et
 * d'Express. Un serveur HTTP nu ne la remplit pas : `req.query` est alors `undefined`, et TOUT
 * paramètre disparaît.
 *
 * ⚠️ CE QUE ÇA DONNAIT, ET POURQUOI C'ÉTAIT LE PIRE DES SYMPTÔMES. Sans paramètres, la requête
 * partait chercher un partage nommé « rien », n'en trouvait pas, et affichait « Ce lien n'est plus
 * valide ou a été révoqué ». Un intégrateur voyait donc un REFUS là où il n'avait simplement pas
 * branché la plateforme. C'est exactement l'inversion qu'on passe notre temps à corriger : une
 * erreur de câblage ne doit jamais ressembler à une décision.
 *
 * Signalé par un hôte qui montait le player sur `http.createServer` : chez lui ça aurait marché en
 * production (Vercel remplit `req.query`) — par chance, pas par construction.
 */
function parametres(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req.url || "/", "http://interne").searchParams);
  } catch {
    return {};
  }
}

async function handler(req, res) {
  try {
    const q = parametres(req);
    const slug = String(q.slug || "").trim();

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      // ── Connexion VISITEUR (soft wall) : demande d'un code par email, puis vérification. ──
      // Émet un jeton signé posé en cookie qui débloque les contenus gatés (require_auth).
      if (body.action === "visitor-request" || body.action === "visitor-verify" || body.action === "visitor-google") {
        const jv = (status, obj, cookie) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); if (cookie) res.setHeader("Set-Cookie", cookie); res.end(JSON.stringify(obj)); };
        const V = PLAYER.plugins.visitors;
        if (!V) return jv(404, { ok: false, error: "disabled" });
        const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "ip";
        if (body.action === "visitor-request") {
          if (!(await PLAYER.limits.allow(`vcode:${ip}`, 20, 3600))) return jv(429, { ok: false, error: "rate" });
          const sh = await getShareBySlug(String(body.slug || ""));
          return jv(200, await V.requestCode(body.email, { title: sh && sh.doc_title }));
        }
        const recordUnlock = async (visitor, method) => {
          try {
            if (!body.slug || !visitor || !visitor.email) return;
            await PLAYER.db.request("xp_visitor_unlocks", { method: "POST", headers: { Prefer: "return=minimal" }, body: [{ doc_slug: String(body.slug), email: visitor.email, name: visitor.name || null, method }] });
          } catch { /* best-effort */ }
        };
        if (body.action === "visitor-google") {
          const r = await V.verifyGoogle(body.credential);
          if (r.ok) await recordUnlock(r.visitor, "google");
          return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
        }
        const r = await V.verifyCode(body.email, body.code, body.name);
        if (r.ok) await recordUnlock(r.visitor, "email");
        return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
      }
      // Mode « Présenter » : démarrage / changement de page / fin. start = public (URL Storage validée) ;
      // page & end exigent le control_token (secret présentateur). L'audience (slug seul) ne peut pas piloter.
      if (body.action === "present-start" || body.action === "present-page" || body.action === "present-end" || body.action === "present-touch") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          if (body.action === "present-start") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
            const allowed = await PLAYER.limits.allow(`pstart:${ip}`, 60, 3600);
            if (!allowed) return jp(429, { ok: false, error: "rate" });
            // On rattache la présentation au membre (JWT) → reprise / liste / transfert. Best-effort : sans
            // session valide la présentation démarre quand même mais ne sera pas reprenable.
            let owner = null;
            const u = await PLAYER.identity.verifyToken(req.headers.authorization);
            if (u && u.email) { const m = u.user_metadata || {}; owner = { id: u.id, email: u.email, name: body.presenterName || m.name || u.email || "", avatar: body.presenterAvatar || m.avatarUrl || "" }; }
            const out = await createPresentation({ docId: body.docId, fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, presenterName: body.presenterName, owner });
            return jp(200, { ok: true, slug: out.slug, control: out.control });
          }
          const r = body.action === "present-page"
            ? await setPage(String(body.slug || ""), String(body.control || ""), body.page)
            : body.action === "present-touch"
            ? await touchPresentation(String(body.slug || ""), String(body.control || ""))
            : await endPresentation(String(body.slug || ""), String(body.control || ""));
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Assistant IA « présentateur » (bot) sur un lien tracé bot_enabled. PUBLIC (prospect anonyme) → rate-limit IP.
      // Synthèse vocale (ElevenLabs) : Léa lit ses messages. PUBLIC (audience anonyme), mais gated : la clé
      // reste côté serveur, le slug doit être un lien-bot valide, et l'audio est mis en CACHE dans le bucket
      // « tts-cache » (nom = hash voix+modèle+texte) → un message identique n'est synthétisé qu'une fois.
      if (body.action === "bot-tts") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) return jp(200, { ok: false, disabled: true });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
          if (!text) return jp(400, { ok: false, error: "empty" });
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          if (!(await PLAYER.limits.allow(`doctts:${ip}`, 400, 3600))) return jp(429, { ok: false, error: "rate" });
          const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
          let voiceId = defaultVoiceId;
          // Voix PAR AGENT : le profil du lien peut porter sa propre voix ElevenLabs (behavior.voice.id).
          // Le cache est déjà haché par voix → changer la voix d'un agent régénère proprement ses extraits.
          let voiceOwner = "", voiceName = "", pron = null;
          try { const bp = await docbot.getProfile(share.bot_profile_id); const bv = bp && bp.behavior && bp.behavior.voice; if (bv && bv.id) { voiceId = String(bv.id); voiceOwner = String(bv.owner || ""); voiceName = String(bv.name || ""); } pron = docbot.pronFix(bp); } catch { /* voix par défaut, sans prononciation */ }
          // DIRE ≠ MONTRER : la prononciation (behavior.voice.pron) s'applique ICI, côté serveur — le client
          // envoie et affiche l'ORTHOGRAPHE, la synthèse (et son cache) travaille sur la version phonétique.
          // `spoken` est renvoyé quand il diffère → le viewer aligne le karaoké dessus (mapping mot à mot).
          const spoken = (() => { if (!pron) return text; try { const s = pron(text).replace(/\s+/g, " ").trim().slice(0, 700); return s || text; } catch { return text; } })();
          const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
          const base = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
          // « v2 » = version du format de cache : les extraits v1 (sans alignement timestamps) sont ignorés
          // d'office et tout se régénère AVEC l'horodatage par caractère (karaoké exact). Anciens fichiers = poids mort minime.
          const keyFor = (vid) => crypto.createHash("sha256").update(vid + "|" + modelId + "|v2|" + spoken).digest("hex");
          let hash = keyFor(voiceId);
          let objPath = hash + ".mp3";
          let pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
          let pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          // Cache hit ? On sert directement l'URL CDN (coût ElevenLabs = 0). align : les anciens extraits
          // n'ont pas de JSON (404) → le client retombe sur la synchro estimée, rien ne casse.
          try { const head = await fetch(pub, { method: "HEAD" }); if (head.ok) return jp(200, { ok: true, url: pub, align: pubAlign, cached: true, spoken: spoken !== text ? spoken : undefined }); } catch { /* miss */ }
          // WITH-TIMESTAMPS : audio + horodatage PAR CARACTÈRE → surlignage karaoké EXACT côté client.
          const synth = (vid) => fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vid) + "/with-timestamps", {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
            body: JSON.stringify({ text: spoken, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
          });
          let gen = await synth(voiceId);
          // Voix de la BIBLIOTHÈQUE pas encore dans le compte → ajout automatique puis nouvel essai ;
          // si l'ajout échoue (quota de slots), on REPLIE sur la voix par défaut : jamais de présentation muette.
          if (!gen.ok && voiceOwner && /^[A-Za-z0-9_-]{8,80}$/.test(voiceOwner)) {
            try {
              await fetch("https://api.elevenlabs.io/v1/voices/add/" + encodeURIComponent(voiceOwner) + "/" + encodeURIComponent(voiceId), {
                method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ new_name: (voiceName || `Voix ${PLAYER.branding.name || "player"}`).slice(0, 80) }),
              });
            } catch { /* repli défaut ci-dessous */ }
            gen = await synth(voiceId);
          }
          if (!gen.ok && voiceId !== defaultVoiceId) {
            voiceId = defaultVoiceId; gen = await synth(voiceId);
            // Le repli se met en cache SOUS SA PROPRE clé (voix par défaut) — souvent déjà présente.
            hash = keyFor(voiceId); objPath = hash + ".mp3";
            pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
            pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          }
          if (!gen.ok) { try { await PLAYER.errors.capture(new Error("elevenlabs " + gen.status), { where: "bot-tts" }); } catch { /* noop */ } return jp(200, { ok: false }); }
          const data = await gen.json().catch(() => null);
          const buf = data && data.audio_base64 ? Buffer.from(data.audio_base64, "base64") : Buffer.alloc(0);
          if (!buf.length) return jp(200, { ok: false });
          const up = await PLAYER.storage.put("tts-cache", objPath, buf, "audio/mpeg");
          // Surveillance du réservoir ElevenLabs (throttlée 1×/h) — cf. _provider-quotas.js.
          try { await PLAYER.plugins.providerQuotas?.tick("elevenlabs"); } catch { /* jamais bloquant */ }
          if (!up) return jp(200, { ok: false });
          // Alignement compact : instants de DÉBUT par caractère (ms) — mêmes index que le texte envoyé.
          let hasAlign = false;
          try {
            const al = data.alignment || data.normalized_alignment;
            if (al && Array.isArray(al.character_start_times_seconds)) {
              const tms = al.character_start_times_seconds.map((x) => Math.round(Number(x) * 1000));
              hasAlign = await PLAYER.storage.put("tts-cache", hash + ".json", Buffer.from(JSON.stringify({ t: tms })), "application/json");
            }
          } catch { /* sans alignement → synchro estimée côté client */ }
          return jp(200, { ok: true, url: pub, align: hasAlign ? pubAlign : null, spoken: spoken !== text ? spoken : undefined });
        } catch { return jp(500, { ok: false }); }
      }
      if (body.action === "bot-start" || body.action === "bot-say" || body.action === "bot-history" || body.action === "bot-nudge" || body.action === "bot-book" || body.action === "bot-contact" || body.action === "bot-rate" || body.action === "bot-script") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          const allowed = await PLAYER.limits.allow(`docbot:${ip}`, 120, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const pages = Math.max(0, Math.min(500, Number(body.pages) || 0));
          const mobile = body.mobile === 1 || body.mobile === true; // téléphone → messages courts + autoplay steps
          if (body.action === "bot-rate") { // satisfaction (1-5 étoiles) posée depuis le bloc central du viewer
            const sess = await docbot.getSession(String(body.sessionId || ""));
            if (!sess || sess.share_slug !== share.slug) return jp(400, { ok: false, error: "session" });
            const note = Math.max(1, Math.min(5, Number(body.rating) || 0));
            if (!note) return jp(400, { ok: false, error: "rating" });
            const cmt = String(body.comment || "").trim().slice(0, 500); // mot facultatif (2e temps du bloc)
            await PLAYER.db.request("doc_bot_sessions?id=eq." + encodeURIComponent(String(body.sessionId)), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: cmt ? { rating: note, rating_comment: cmt } : { rating: note } });
            return jp(200, { ok: true });
          }
          if (body.action === "bot-history") return jp(200, { ok: true, messages: await docbot.listMessages(String(body.sessionId || "")) });
          // ⚠️ Même piège : un objet littéral répond à `constructor`. Sans `Object.hasOwn`, une
          // langue « constructor » passait la garde et finissait interpolée dans le prompt du
          // modèle sous la forme « function Object() { [native code] } ».
          const langueDemandee = String(body.lang || "").toLowerCase();
          const blang = Object.hasOwn(docbot.I18N_LANGS, langueDemandee) ? langueDemandee : null; // fr/inconnu → null (langue source)
          if (body.action === "bot-start") return jp(200, { ok: true, ...(await docbot.botStart(share, pages, mobile, String(body.intent || ""), blang)) });
          // Bascule de langue EN COURS de présentation : renvoie le script (traduit ou FR) — le client
          // remplace sa liste d'étapes et rejoue le message courant dans la nouvelle langue.
          if (body.action === "bot-script") {
            const sess = await docbot.getSession(String(body.sessionId || ""));
            if (!sess || sess.share_slug !== share.slug) return jp(400, { ok: false, error: "session" });
            const sp = docbot.applyPron(await docbot.scriptedPayload(share.doc_id, blang, String(body.sessionId)), await docbot.getProfile(share.bot_profile_id));
            if (!sp) return jp(400, { ok: false, error: "script" });
            return jp(200, { ok: true, steps: sp.steps, voiceScript: sp.voice, message: sp.hook, closing: sp.closing, messageSay: sp.hookSay, closingSay: sp.closingSay });
          }
          if (body.action === "bot-nudge") { const rn = await docbot.botNudge(String(body.sessionId || ""), share, pages, mobile); if (rn.error) return jp(400, { ok: false, error: rn.error }); return jp(200, { ok: true, ...rn }); }
          if (body.action === "bot-book") { const rb = await docbot.bookSlot(String(body.sessionId || ""), share, String(body.book || "")); if (rb.error) return jp(400, { ok: false, error: rb.error }); return jp(200, { ok: true, ...rb }); }
          // Formulaire de coordonnées : parcours DÉTERMINISTE (zéro appel IA → réponse immédiate).
          if (body.action === "bot-contact") { const rc = await docbot.contactLead(String(body.sessionId || ""), share, { name: body.name, email: body.email, phone: body.phone }); if (rc.error) return jp(400, { ok: false, error: rc.error }); return jp(200, { ok: true, ...rc }); }
          const text = String(body.text || "").slice(0, 1000).trim();
          if (!text) return jp(400, { ok: false, error: "empty" });
          const r = await docbot.botSay(String(body.sessionId || ""), share, text, pages, mobile, blang);
          if (r.error) return jp(400, { ok: false, error: r.error });
          return jp(200, { ok: true, ...r });
        } catch { return jp(500, { ok: false }); }
      }
      // Assistance (heartbeat) : PUBLIC (l'audience est anonyme). Journalise qui suit / combien de temps / pages vues.
      // Rate-limit généreux par IP (heartbeat ≈ 145/h/participant) : bloque le spam d'assistants factices sans
      // gêner un usage normal ; fail-open, et un 429 ici ne dégrade que les stats (pas la présentation).
      if (body.action === "present-attend") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          const allowed = await PLAYER.limits.allow(`patt:${ip}`, 1000, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const r = await recordAttendance(String(body.slug || ""), { key: body.key, name: body.name, email: body.email, avatar: body.avatar, isMember: !!body.isMember, isPresenter: !!body.isPresenter });
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Gestion des présentations (membre AUTHENTIFIÉ requis) : liste / reprise / transfert / stats / historique doc.
      if (body.action === "present-list" || body.action === "present-reclaim" || body.action === "present-handover" || body.action === "present-owner-end" || body.action === "present-stats" || body.action === "present-doc-list" || body.action === "present-switch" || body.action === "present-content") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          if (!u || !u.email) return jp(401, { ok: false, error: "auth" });
          const isAdmin = PLAYER.identity.isAdmin(u);
          let r;
          if (body.action === "present-list") r = { ok: true, presentations: await listActivePresentations(u.email) };
          else if (body.action === "present-reclaim") r = await reclaimPresentation(String(body.slug || ""), u.email);
          else if (body.action === "present-owner-end") r = await endPresentationByOwner(String(body.slug || ""), u.email, isAdmin);
          else if (body.action === "present-stats") r = await presentationStats(String(body.slug || ""));
          else if (body.action === "present-doc-list") r = { ok: true, presentations: await listPresentationsForDoc(String(body.docId || "")) };
          else if (body.action === "present-switch") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            r = await switchPresentationDoc(String(body.slug || ""), u.email, isAdmin, { fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, docId: body.docId });
          }
          else if (body.action === "present-content") r = await setPresentationContent(String(body.slug || ""), u.email, isAdmin, body.content);
          else r = await handoverPresentation(String(body.slug || ""), u.email, body.newOwner);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Chat de présentation (historisé) : n'importe quel participant (présentateur ou audience) poste un
      // message. Écriture via service role ; anti-spam par IP (60/h). La présentation doit exister.
      if (body.action === "present-chat") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          const allowed = await PLAYER.limits.allow(`pchat:${ip}`, 60, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // Le badge « présentateur » n'est accordé QUE si le control_token est valide (sinon n'importe quel
          // participant pourrait poster un message usurpant le présentateur). Sert aussi au chat verrouillé.
          const validControl = !!(body.control && require("crypto").createHash("sha256").update(String(body.control)).digest("hex") === pres.control_hash);
          if (pres.chat_locked && !validControl) return jp(423, { ok: false, error: "locked" });
          const r = await addMessage(String(body.slug || ""), { name: body.name, email: body.email, avatar: body.avatar, isPresenter: validControl, isMember: !!body.isMember, body: body.body, replyTo: body.replyTo, replyName: body.replyName, replyText: body.replyText, authorToken: body.authorToken, attachment: body.attachment });
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Pièce jointe : URL d'upload signée (la présentation doit exister ; rate-limit).
      if (body.action === "present-upload-url") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          const allowed = await PLAYER.limits.allow(`pup:${ip}`, 30, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const r = await createUploadUrl(String(body.slug || ""), body.name, body.type);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Chat : éditer / supprimer un message, verrouiller le chat.
      if (body.action === "present-msg-edit" || body.action === "present-msg-delete" || body.action === "present-chatlock") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          let r;
          if (body.action === "present-msg-edit") r = await editMessage(String(body.slug || ""), body.msgId, String(body.authorToken || ""), body.body);
          else if (body.action === "present-msg-delete") r = await deleteMessage(String(body.slug || ""), body.msgId, { authorToken: body.authorToken, control: body.control });
          else r = await setChatLock(String(body.slug || ""), String(body.control || ""), !!body.locked);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Réaction emoji (toggle) sur un message du chat de présentation.
      if (body.action === "present-react") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
          const allowed = await PLAYER.limits.allow(`preact:${ip}`, 200, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const r = await toggleReaction(String(body.slug || ""), body.msgId, body.emoji, body.reactor);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // ── LIENS DE PARTAGE TRACÉS (un par destinataire) ────────────────────────────────────────
      // Ces actions vivaient dans la route de synchronisation du studio, derrière son modèle de
      // droits maison — inappelables par un autre hôte. Elles appartiennent au player : c'est lui
      // qui fabrique les liens, les sert et les trace.
      //
      // ⚠️ QUI a le droit de diffuser un document est en revanche une règle de l'HÔTE, pas du
      // player : elle passe par le contexte (`identity.canManageShares`). Le player se contente de
      // vérifier le jeton. Sans réponse de l'hôte : refus.
      if (String(body.action || "").startsWith("docshare.")) {
        const jd = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          // ── L'HÔTE PARLE EN SON NOM PROPRE ────────────────────────────────────────────────
          //
          // Un lien ANONYME — la plaquette publique d'un programme, lue par un prospect sans
          // compte — n'a pas de membre derrière lui. Exiger un JWT forcerait l'hôte à inventer
          // une identité qui n'existe pas : un compte de service dont le mot de passe ouvre bien
          // plus que la création d'un lien, ou pire, l'aperçu interne détourné — ce qui rangerait
          // un prospect dans la population INTERNE et ferait mentir la seule phrase qui compte
          // ici : « ce client a lu pendant douze minutes ».
          //
          // C'est la même nature que `/authz` et `/branding`, que l'hôte sert déjà en serveur à
          // serveur. Demandé par le second hôte, qui avait écarté les trois contournements
          // lui-même avant d'écrire.
          //
          // ⚠️ TROIS VERROUS, et chacun ferme une porte différente :
          //   1. `create` UNIQUEMENT — révoquer, lister, lire des statistiques restent des actes
          //      de membre. Un secret de serveur ne doit pas donner à voir qui a lu quoi.
          //   2. AUCUN destinataire — le nominatif a un membre. L'admettre ici rouvrirait par la
          //      bande ce que le JWT protège.
          //   3. IDEMPOTENT par `docId` — sans ça, un redéploiement, une reprise sur erreur ou un
          //      double clic donnent trois liens pour la même plaquette, donc des statistiques
          //      fragmentées en trois, découvertes en les lisant six mois plus tard.
          if (typeof PLAYER.identity.isTrustedHostCall === "function"
              && PLAYER.identity.isTrustedHostCall(req.headers)) {
            if (body.action !== "docshare.create") {
              return jd(403, { ok: false, error: "L'appel serveur à serveur ne crée que des liens sans destinataire." });
            }
            if (body.recipientEmail) {
              return jd(400, { ok: false, error: "Un lien avec destinataire appartient à un membre : il exige son jeton." });
            }
            const docId = String(body.docId || "").trim();
            if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });

            const ipH = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "hote";
            if (!(await PLAYER.limits.allow(`hshare:${ipH}`, 120, 3600))) return jd(429, { ok: false, error: "rate" });

            // ⚠️ La clé d'idempotence n'a PAS demandé de colonne : « le lien de l'hôte pour ce
            // document » est exactement la ligne sans créateur ET sans destinataire. Seul ce
            // chemin en produit, donc elle est sans ambiguïté — et une instance déjà en service
            // n'a aucune migration à passer.
            const dejaLa = await PLAYER.db.request(
              `commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&created_by=is.null&recipient_email=is.null&select=slug&limit=1`,
            );
            if (Array.isArray(dejaLa) && dejaLa[0]) {
              await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(dejaLa[0].slug)}`, {
                method: "PATCH", headers: { Prefer: "return=minimal" },
                body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, revoked: false },
              });
              return jd(200, { ok: true, slug: dejaLa[0].slug, reused: true });
            }
            // `createdBy` reste NUL : personne ne l'a créé. Le filtre « mes liens » compare
            // `created_by=eq.<email>`, qui exclut les NUL — ce lien n'apparaît donc dans la liste
            // de personne, et reste visible en administration (`list.all`, qui ne filtre pas).
            const neuf = await createShare({
              brandKey: body.brandKey, docId, docTitle: body.docTitle, fileUrl: body.fileUrl,
              fileName: body.fileName, createdBy: null, bot: body.bot, botScript: body.botScript,
              guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload,
              videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark,
            });
            return jd(200, { ok: true, slug: neuf.slug, reused: false });
          }

          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          if (!u || !u.email) return jd(401, { ok: false, error: "auth" });
          // L'action est transmise telle quelle (`create`, `revoke`…) : l'hôte peut séparer
          // l'envoi d'un document — acte commercial ordinaire — de l'administration des liens.
          const acte = String(body.action || "").slice("docshare.".length);
          if (!(await PLAYER.identity.canManageShares(u, acte))) return jd(403, { ok: false, error: "Action non autorisée pour ce rôle." });
        if (body.action === "docshare.setauth") {
          return jd(200, await setShareAuth(String(body.slug || ""), !!body.requireAuth));
        }
        if (body.action === "docshare.overview") {
          return jd(200, { ok: true, byDoc: await docOverview() });
        }
        if (body.action === "docshare.sessions") {
          return jd(200, { ok: true, sessions: await listSessionsForDoc(String(body.docId || "")) });
        }
        if (body.action === "docshare.list") {
          const docId = String(body.docId || "");
          // DEUX portées, et c'est l'hôte qui tranche : « tous les liens » est un acte
          // d'administration, « mes liens » un acte commercial ordinaire. Sans cette distinction,
          // un commercial verrait à qui d'autre le document a été envoyé — les prospects de ses
          // collègues. Un hôte qui ne distingue pas répond oui aux deux et retrouve la liste
          // complète, comme avant.
          const tout = await PLAYER.identity.canManageShares(u, "list.all");
          const [data, internal] = await Promise.all([
            listSharesForDoc(docId, tout ? null : u.email),
            internalStatsForDoc(docId).catch(() => null),
          ]);
          return jd(200, { ok: true, ...data, internal, scope: tout ? "all" : "mine" });
        }
        // « Répétition générale » : UN lien de test par document (réutilisé, re-patché avec le fichier et
        // l'agent ACTUELS à chaque ouverture). Sessions/leads flaggés is_test → exclus stats/notifications.
        if (body.action === "docshare.test") {
          const docId = String(body.docId || "");
          if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });
          const ex = await PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&is_test=eq.true&select=slug&limit=1`);
          if (Array.isArray(ex) && ex[0]) {
            await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(ex[0].slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, bot_enabled: true, bot_guided: true, bot_profile_id: (body.profileId || "").trim() || null, revoked: false } });
            return jd(200, { ok: true, slug: ex[0].slug });
          }
          const t = await createShare({ docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientName: "Répétition (test)", createdBy: u.email, bot: true, guided: true, profileId: body.profileId, isTest: true });
          return jd(200, { ok: true, slug: t.slug });
        }
        if (body.action === "docshare.revoke") {
          await revokeShare(String(body.slug || ""));
          return jd(200, { ok: true });
        }
        const { slug } = await createShare({ brandKey: body.brandKey, docId: body.docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientEmail: body.recipientEmail, recipientName: body.recipientName, createdBy: u.email, bot: body.bot, botScript: body.botScript, guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload, videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark });
        return jd(200, { ok: true, slug });
        } catch { return jd(500, { ok: false }); }
      }

      // Re-partage (forward depuis la visionneuse) : crée un lien enfant tracé, et envoie l'email via 3D
      // Discovery si demandé (body.send). Anti-spam : contenu templé + RATE LIMIT par IP (8/h).
      if (body.action === "reshare") {
        const mail = String(body.email || "").trim().toLowerCase();
        const j = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        if (!/.+@.+\..+/.test(mail)) return j(400, { ok: false, error: "email" });
        const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
        const allowed = await PLAYER.limits.allow(`reshare:${ip}`, 8, 3600);
        if (!allowed) return j(429, { ok: false, error: "rate", message: "Trop de partages, réessayez plus tard." });
        let out = null;
        try { out = await createReshare(body.slug || slug, { email: mail, name: body.name }); } catch { /* parent introuvable */ }
        if (!out) return j(404, { ok: false });
        let sent = false;
        let refusEnvoi = null;
        if (body.send) {
          try {
            const parent = await getShareBySlug(body.slug || slug);
            // ⚠️ ON N'ENVOIE DE COURRIER QUE POUR UN LIEN QUI A UN DESTINATAIRE.
            //
            // Le lecteur d'un lien ANONYME est un visiteur quelconque : lui laisser demander un
            // envoi ferait des serveurs de l'hôte un relais de courrier non sollicité, avec SON
            // domaine dans l'en-tête. Ce qui coûte cher n'est pas le message parti, c'est la
            // réputation d'expéditeur : elle met des semaines à revenir, et pendant ce temps
            // AUCUN de ses emails n'arrive — factures, relances, notifications d'équipe
            // comprises. Une commodité sur une page publique mettrait en jeu tout son courrier
            // transactionnel.
            //
            // Un lien nominatif, lui, a été créé par quelqu'un qui s'est authentifié et qui
            // engage sa responsabilité. `recipient_email` est nul sur exactement les liens sans
            // membre derrière — c'est déjà la clé d'idempotence du chemin serveur à serveur.
            //
            // ⚠️ La garde est ICI, sur le chemin qui agit, et pas chez l'hôte à l'arrivée. Un
            // filtre à l'arrivée dépend d'une liste à jour ; un chemin qui ne sait pas formuler
            // la demande ne la formulera jamais par accident. Même raison que les trois verrous
            // de `docshare.create`. Demandé par le second hôte, qui l'a réclamée CHEZ NOUS alors
            // qu'il aurait pu la poser chez lui.
            if (!parent || !parent.recipient_email) {
              refusEnvoi = "no-recipient";
              throw new Error("envoi réservé aux liens nominatifs");
            }
            // ⚠️ `Host` EST CHOISI PAR LE CLIENT. Le lien inséré dans un email signé par l'hôte
            // était construit avec cet en-tête : sur le serveur autonome, ou derrière un proxy qui
            // ne le réécrit pas strictement, un lecteur pouvait demander un envoi parfaitement
            // légitime dont le bouton pointe vers SON domaine. L'email part de l'hôte, avec sa
            // marque et sa réputation, vers le destinataire choisi par l'attaquant.
            //
            // `PLAYER_PUBLIC_URL` d'abord — une valeur que l'exploitant a écrite. Le repli sur
            // `Host` reste pour ne casser aucune instance existante, mais il est SIGNALÉ : une
            // instance qui envoie des emails sans URL publique configurée doit le savoir avant de
            // le découvrir dans un rapport d'hameçonnage.
            const publique = String(PLAYER.legal.publicUrl || "").trim();
            if (!publique) {
              try { PLAYER.errors.capture(new Error("PLAYER_PUBLIC_URL non configurée : le lien de l'email est construit depuis l'en-tête Host, que le client choisit"), { route: "reshare" }); } catch { /* jamais bloquant */ }
            }
            const origin = publique || `https://${req.headers.host}`;
            const r = await sendReshareEmail({ parent, childSlug: out.slug, origin, toEmail: mail, toName: body.name });
            sent = !!(r && r.sent);
          } catch { /* best-effort : le lien existe quand même */ }
        }
        // Le refus se DIT : « rien n'est parti » et « l'envoi n'était pas permis » ne se
        // ressemblent pas, et une interface qui les confond propose un bouton qui ne marchera
        // jamais.
        return j(200, { ok: true, slug: out.slug, sent, ...(refusEnvoi ? { sendRefused: refusEnvoi } : {}) });
      }
      const ua0 = req.headers["user-agent"];
      const ip0 = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
      // ⚠️ CONSULTATION INTERNE : L'IDENTITÉ EST AFFIRMÉE PAR LE NAVIGATEUR, PAS PROUVÉE.
      //
      // La population interne est celle que le produit promet de ne jamais mélanger aux prospects.
      // Or cette route acceptait n'importe quel e-mail, n'importe quel document, sans jeton ni
      // limite : on pouvait fabriquer « tel collègue a lu ce document trois heures ».
      //
      // Le suivi part par `sendBeacon`, qui ne sait pas porter d'en-tête — exiger un JWT casserait
      // le seul transport qui survive à la fermeture d'un onglet, c'est-à-dire le moment où la
      // mesure compte le plus. La preuve doit donc voyager dans le CORPS, et venir de l'hôte :
      // lui seul sait qui est son membre.
      //
      // `PLAYER_INTERNAL_STRICT` laisse chaque hôte fermer la porte à son rythme :
      //   • absent  → on accepte, borné et limité, et on le SIGNALE une fois de temps en temps ;
      //   • posé    → sans jeton valide, rien n'est écrit.
      // Une fermeture par défaut casserait les instances en service, dont la nôtre. Une porte
      // qu'on laisse ouverte sans le dire est un défaut ; une porte qu'on laisse ouverte en le
      // disant, avec le verrou fourni, est une transition.
      if (body.internal && body.event === "session") {
        const ipInt = ip0 || "anon";
        if (!(await PLAYER.limits.allow(`intsess:${ipInt}`, 120, 3600))) {
          res.statusCode = 429; res.setHeader("Content-Type", "application/json"); res.end('{"ok":false,"error":"rate"}');
          return;
        }
        const jeton = typeof PLAYER.identity.verifyInternalToken === "function"
          ? PLAYER.identity.verifyInternalToken(String(body.it || ""))
          : null;
        const strict = !!(PLAYER.config && PLAYER.config.internalStrict);
        if (strict && !jeton) {
          res.statusCode = 403; res.setHeader("Content-Type", "application/json"); res.end('{"ok":false,"error":"internal-token"}');
          return;
        }
        if (!strict && !jeton) {
          // Une fois par heure et par instance : assez pour être vu dans les journaux, pas assez
          // pour les noyer — un avertissement répété à chaque battement ne se lit plus.
          if (await PLAYER.limits.allow("intsess:avert", 1, 3600)) {
            try { PLAYER.errors.capture(new Error("session interne écrite sans jeton : l'identité vient du navigateur. Poser PLAYER_INTERNAL_STRICT=1 une fois l'hôte à jour"), { route: "internal-session" }); } catch { /* ignore */ }
          }
        }
        // Le jeton fait foi quand il est là : c'est l'hôte qui se porte garant, pas l'appelant.
        try {
          await upsertInternalSession({
            sessionId: body.sessionId,
            docId: jeton ? jeton.docId : body.docId,
            userEmail: jeton ? jeton.email : body.email,
            userName: jeton ? (jeton.name || body.name) : body.name,
            numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime,
          }, { ip: ip0, ua: ua0 });
        } catch { /* best-effort */ }
        res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}');
        return;
      }
      const share = await getShareBySlug(body.slug || slug);
      if (share && !share.is_test) { // répétition générale : la lecture de test ne compte pas dans les stats
        try {
          // 'session' = résumé riche (temps par page, appareil) → upsert ; open/page/heartbeat → journal léger (funnel/overview).
          if (body.event === "session") await upsertSession(share, { sessionId: body.sessionId, numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime }, { ip: ip0, ua: ua0 });
          else await logView(share, { event: body.event, page: body.page, maxPage: body.maxPage, seconds: body.seconds, sessionId: body.sessionId, ua: ua0 });
        } catch { /* best-effort */ }
      }
      res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}');
      return;
    }

    // AUCUN DOCUMENT DEMANDÉ. Ni slug, ni présentation, ni aperçu, ni carte d'identité — il n'y a
    // rien à afficher, et ce n'est pas un refus. Le dire franchement évite qu'un intégrateur
    // cherche un lien révoqué là où il lui manque un paramètre.
    if (req.method === "GET" && !slug && !q.present && !q.preview && !q.contract) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Aucun document demandé. Attendu : ?slug=… , ?present=… , ?preview=1 ou ?contract=1.\n" +
              "Si vous intégrez le player, vérifiez que la plateforme fournit les paramètres de requête.");
      return;
    }

    // ── CARTE D'IDENTITÉ (`?contract=1`) ─────────────────────────────────────────────────────
    // La règle 4 du contrat demande à l'hôte d'épingler la version qu'il vise et de le VÉRIFIER.
    // Sans point d'interrogation, cette règle était une intention : un hôte ne pouvait pas écrire
    // le test. Placé en tête à dessein — c'est un outil de diagnostic, il doit répondre même
    // quand le reste ne va pas, et ne demande donc ni session ni base.
    //
    // Ce qu'il contient : de quoi DÉCIDER (le numéro de contrat, les capacités présentes), rien
    // qui aide à attaquer — aucune URL, aucun secret, aucun nom d'hôte. Les greffons sont donnés
    // en booléens parce qu'un hôte doit pouvoir refuser de démarrer si le mur d'accès manque
    // alors qu'il compte dessus.
    if (String(q.contract || "") === "1") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      const p = PLAYER.plugins || {};
      res.end(JSON.stringify({
        product: "discovery-media-player",
        // ⚠️ LE champ à épingler. Il ne bouge QUE sur une rupture (règle 2) : ajouter une action,
        // un paramètre ou un motif de refus ne le change pas.
        contract: 1,
        version: PLAYER_VERSION,
        // Ce que cette instance sait faire. Un hôte teste la présence, jamais l'ordre.
        // `host-auth` : cette instance sait vérifier les jetons auprès d'un émetteur DISTINCT de
        // sa base (PLAYER_AUTH_URL). Un hôte tiers en a besoin pour savoir si ses membres
        // peuvent seulement s'authentifier — sans ça, sa seule voie était d'essayer et de lire
        // un refus qui ressemble à un droit manquant. Le nom, jamais l'émetteur : la carte reste
        // muette sur les URL.
        capabilities: [
          "docshare", "presentations", "embed-denied", "host-fetch", "brand-reference", "host-auth",
          "host-share", "host-mail",
        ],
        // ⚠️ POUR QUELLES ORIGINES cette instance accepte d'être encadrée. Un booléen ne
        // suffisait pas : un hôte a besoin de voir que SON domaine manque, pas seulement que
        // l'intégration est possible. C'est la seule panne qu'il ne peut pas diagnostiquer
        // autrement — le navigateur bloque avant tout script, et rien ne peut lui être émis.
        // Ce n'est pas un secret : ces mêmes valeurs partent dans chaque en-tête CSP servi.
        frameAncestors: ["'self'", "https://*.vercel.app"].concat(PLAYER.config.extraFrameAncestors || []),
        // Même besoin que `frameAncestors`, l'inverse de la réponse : là on nomme les origines
        // parce qu'un hôte doit voir que LA SIENNE manque ; ici un booléen suffit, parce que
        // l'hôte connaît déjà son émetteur — il veut seulement savoir si l'instance le regarde.
        // Dire lequel n'aiderait personne et renseignerait qui sonde.
        separateIssuer: !!(PLAYER.config && PLAYER.config.separateIssuer),
        // « L'hôte peut-il créer un lien en son nom propre ? » — configuré, pas seulement
        // possible. Un hôte qui oublie le secret reçoit un 401 qui ressemble à un droit
        // manquant ; ce booléen le lui dit sans qu'il ait à essayer.
        hostShare: !!(PLAYER.config && PLAYER.config.hostShare),
        hostMail: !!(PLAYER.config && PLAYER.config.hostMail),
        // Greffons de l'hôte : présents ou coupés (PLAYER_PLUGINS_OFF). Booléens uniquement.
        plugins: {
          bot: !!p.bot, visitors: !!p.visitors, brandIntro: !!p.brandIntro,
          botBrowser: !!p.botBrowser, providerQuotas: !!p.providerQuotas,
        },
      }));
      return;
    }

    // ⚠️ Lu ICI, une seule fois, et AVANT toute branche capable de refuser. Il était calculé plus
    // bas, dans le seul chemin du lien tracé : l'aperçu interne et la page d'audience refusaient
    // donc en silence. Signalé par un hôte dont la visionneuse interne utilise
    // précisément `?preview=1&embed=1` — le premier mode qu'un nouvel hôte exerce, et celui où un
    // refus de configuration ressemble le plus à une instance injoignable.
    const embed = String(q.embed || "") === "1";

    // Mode « Présenter » côté AUDIENCE : `?present=<slug>` → page live (suit le présentateur via Realtime) ;
    // `&file=1` → stream le PDF de la présentation (Range, même origine pour pdf.js).
    if (q.present) {
      const pres = await getPresentation(String(q.present));
      if (!pres) return sendRefusal(res, "ended", embed);
      // Historique du chat (chargé au join par présentateur ET audience).
      // ÉTAT de la présentation, relu par l'audience à la reconnexion ou au retour d'onglet.
      // C'est la porte qui permettra de retirer la lecture anonyme des tables : l'audience n'a
      // plus besoin de lire `doc_presentations` pour connaître la page courante. On ne renvoie
      // QUE ce que l'audience doit savoir — ni propriétaire, ni jeton, ni horodatages internes.
      if (String(q.state || "") === "1") {
        res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ ok: true, state: {
          active: pres.active !== false,
          current_page: pres.current_page || 1,
          content: pres.content || null,
          file_url: pres.file_url || null,
          file_name: pres.file_name || null,
          doc_title: pres.doc_title || null,
          updated_at: pres.updated_at || null,
        } }));
        return;
      }
      if (String(q.chat || "") === "1") {
        res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ ok: true, messages: await listMessages(String(q.present)), locked: !!pres.chat_locked }));
        return;
      }
      if (String(q.file || "") === "1") {
        if (!isAllowedStorageUrl(pres.file_url)) { res.statusCode = 404; res.end("Fichier indisponible"); return; }
        const range = req.headers["range"];
        const r = await PLAYER.storage.fetchFile(pres.file_url, { range });
        await relayerFichier(res, r, null);
        return;
      }
      const supaUrl = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
      const supaKey = (PLAYER.config && PLAYER.config.supabasePublishableKey) || "";
      let alogo = ""; try { alogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const anonce = crypto.randomBytes(16).toString("base64");
      // Même sujet, trouvé en vérifiant le précédent : cette page ne passait AUCUN paramètre,
      // donc `frame-ancestors 'none'` — encadrable par personne, pas même par sa propre origine.
      // `'none'` reste le défaut hors intégration (anti-clickjacking) ; en `?embed=1`, un hôte
      // qui affiche l'audience dans son application doit pouvoir le faire.
      return sendPresentHtml(res, presentHtml(pres, anonce, alogo, supaUrl, supaKey), anonce, supaUrl,
        originOf(alogo), embed ? embedFrameAncestors() : "'none'");
    }

    // Aperçu interne (depuis la bibliothèque) : même visionneuse pdf.js, SANS lien tracé ni suivi.
    // `?preview=1&url=<storage public>&name=&title=` → HTML ; `&stream=1` → stream le fichier (Range).
    if (String(q.preview || "") === "1") {
      const url = String(q.url || "");
      if (!isAllowedStorageUrl(url)) return sendRefusal(res, "url-not-allowed", embed);
      if (String(q.stream || "") === "1") {
        const range = req.headers["range"];
        const r = await PLAYER.storage.fetchFile(url, { range });
        await relayerFichier(res, r, dispositionInline(q.name));
        return;
      }
      const supaUrl = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
      const supaKey = (PLAYER.config && PLAYER.config.supabasePublishableKey) || "";
      const pseudo = { preview: true, embed, slug: "", file_name: String(q.name || "document.pdf"), doc_title: String(q.title || q.name || "Document"), raw_url: url, doc_id: String(q.docId || ""), presenter_name: String(q.by || ""), presenter_avatar: String(q.av || ""), internal_email: String(q.uemail || ""), supa_url: supaUrl, supa_key: supaKey, auto_present: String(q.autopresent || "") === "1", resume_slug: String(q.resume || ""), stream_url: `/api/doc?preview=1&stream=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(String(q.name || ""))}` };
      let plogo = ""; try { plogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const pnonce = crypto.randomBytes(16).toString("base64");
      // Aperçu interne : CSP relâchée (supabase-js jsdelivr + Realtime wss) pour la présence + le chat live,
      // framing MÊME ORIGINE (iframe DocViewer). La visionneuse PUBLIQUE /doc/:slug garde sa CSP stricte.
      // ⚠️ `'self'` ÉTAIT ÉCRIT EN DUR ICI, et l'hypothèse était juste jusqu'au jour où elle a
      // cessé de l'être. Chez l'hôte d'origine, l'application et le player sont le MÊME
      // déploiement : même origine, `'self'` suffit, et c'est même le bon réglage. Pour une
      // instance séparée — c'est toute la raison d'être d'une seconde instance — l'aperçu est sur
      // un domaine et l'application sur un autre. Le navigateur bloquait alors l'iframe avant
      // tout script : aucun `embed-denied` ne pouvait partir, et l'hôte voyait un silence.
      //
      // Conséquence absurde relevée par cet hôte : la page de REFUS, corrigée la veille, était
      // encadrable chez lui — pas la page de SUCCÈS. Le chemin d'erreur était plus portable que
      // le chemin nominal.
      return sendPresentHtml(res, viewerHtml(pseudo, pnonce, plogo), pnonce, supaUrl, originOf(plogo),
        embed ? embedFrameAncestors() : "'self'");
    }

    const share = slug ? await getShareBySlug(slug) : null;
    if (!share) return sendRefusal(res, "revoked", embed);

    // Soft wall : un document require_auth n'est servi qu'à un visiteur au jeton valide.
    // Mur d'accès visiteur — greffon. SANS lui, un document « compte requis » ne doit surtout PAS
    // devenir librement lisible : on FERME (404) au lieu de dégrader en accès ouvert. Fail-closed.
    const visitors = PLAYER.plugins.visitors;
    const visitor = visitors ? visitors.currentVisitor(req) : null;
    if (share.require_auth === true && !visitors) return sendRefusal(res, "auth-unavailable", embed);
    const gated = share.require_auth === true && !visitor;

    if (String(q.file || "") === "1") {
      if (gated) { res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: false, error: "auth" })); return; }
      // Stream depuis le Storage en RELAYANT les requêtes Range → pdf.js charge progressivement (les 1res
      // pages s'affichent sans télécharger tout le PDF) → affichage bien plus rapide.
      const range = req.headers["range"];
      const r = await PLAYER.storage.fetchFile(share.file_url, { range });
      await relayerFichier(res, r, dispositionInline(share.file_name));
      return;
    }

    // Soft wall : contenu réservé → on sert la page de connexion visiteur (email + code)
    // AVANT de charger le lecteur. À la vérification, le cookie est posé → un reload lève le mur.
    if (gated) {
      let wlogo = ""; try { wlogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const wnonce = crypto.randomBytes(16).toString("base64");
      const gcid = visitors.googleClientId();
      // Intégré : le mur reste affiché (le visiteur peut s'y connecter sur place) mais il DIT à
      // l'hôte que le document est retenu — sinon l'hôte croit à une panne et replie sur son
      // lecteur, qui lui ouvrirait le document que ce mur protège.
      const wall = softWallHtml(share, wnonce, wlogo, gcid)
        + (embed ? `<script nonce="${wnonce}">try{parent.postMessage({type:"3dd-doc-embed-denied",reason:"auth-required"},"*")}catch(e){}</script>` : "");
      return sendSoftWallHtml(res, wall, wnonce, [originOf(wlogo), originOf(share.brand_logo)].filter(Boolean).join(" "), embed ? embedFrameAncestors() : null);
    }

    // Identité du profil d'assistant (nom, avatar, tagline, couleur) → header du chat, bulle flottante,
    // mini-avatars des messages. Best-effort : sans profil, identité par défaut.
    if (share.bot_enabled && docbot) {
      try {
        const bp = await docbot.getProfile(share.bot_profile_id);
        share.bot_name = bp.name; share.bot_avatar = bp.avatar_url; share.bot_tagline = bp.tagline; share.bot_accent = bp.accent_color;
        share.bot_greeting = (bp.behavior && bp.behavior.greeting) || ""; // accueil pré-chargé → affiché INSTANTANÉMENT côté client
        share.bot_greeting_doc = (bp.behavior && bp.behavior.greeting_doc) || ""; // accueil DÉDIÉ à la présentation d'un document (plus court que l'accueil chat)
        share.bot_vphoto = (bp.behavior && bp.behavior.video && bp.behavior.video.photo) || ""; // photo PRÉSENTATEUR (webcam / split mobile) — plan large, environnement réel
        // Les PORTES proposent « En vidéo » seulement si des clips existent réellement (manifeste FR).
        try { const av = PLAYER.plugins.avatarClips; const cl = av && await av.clipsFor(share.doc_id, null, bp); share.bot_vclips = !!(cl && Object.keys(cl.clips || {}).length); } catch { share.bot_vclips = false; }
        share.bot_karaoke = (bp.behavior && bp.behavior.karaoke) || ""; // style des sous-titres voix choisi PAR AGENT
      } catch { /* identité par défaut */ }
    }
    // Marque du loader : celle du client (registre, résolue MAINTENANT donc toujours à jour),
    // sinon le logo recopié dans le lien, sinon celle de l'instance.
    try {
      const marque = await brands.brandForShare(share);
      if (marque) { share.brand_logo = marque.logo; share.brand_name = marque.name; share.brand_dark = marque.dark; }
    } catch { /* le loader dégrade, il n'empêche pas de lire */ }
    let logoUrl = ""; try { logoUrl = await PLAYER.branding.logo(); } catch { /* sans logo */ }
    // Pitch du document (résumé de l'analyse IA) : personnalise l'écran d'accueil — le prospect comprend
    // tout de suite CE QU'EST ce document avant de choisir comment le découvrir.
    let pitch = "";
    if (share.bot_enabled && share.doc_id && docbot) {
      try {
        const fiche = await docbot.getDocFiche(share.doc_id);
        pitch = String((fiche && fiche.brief && fiche.brief.summary) || "").replace(/\s+/g, " ").trim();
        if (pitch.length > 190) { const cut = pitch.slice(0, 190).lastIndexOf(". "); pitch = cut > 90 ? pitch.slice(0, cut + 1) : pitch.slice(0, 187) + "…"; }
      } catch { /* pas de fiche → accueil générique */ }
    }
    // ?embed=1 : la visionneuse est en surimpression dans une page hôte (le plan d'un
    // lot dans une expérience 3D) → sa barre porte la croix de sortie.
    share.embed = embed;
    const nonce = crypto.randomBytes(16).toString("base64");
    // FRAMING. Page publique : 'self' seulement (anti-clickjacking). Mode INTÉGRÉ
    // (?embed=1) : les expériences ne vivent pas toutes derrière le proxy
    // /experience — certaines expériences, les préversions et les liens de diffusion sont servis
    // sur leurs propres domaines Vercel, où 'self' bloquait l'overlay des plans
    // (page blanche constatée le 10/08). On y autorise donc les domaines Vercel
    // (+ extras via DOC_FRAME_ANCESTORS, séparés par des espaces — futurs domaines
    // custom d'XP). La CSP frame-ancestors PRIME sur le X-Frame-Options SAMEORIGIN
    // global du vercel.json (spec : XFO ignoré quand frame-ancestors est présent).
    // ⚠️ EMBARQUEMENT DEMANDÉ SANS HÔTE AUTORISÉ : le seul cas où le player ne peut pas se
    // défendre lui-même. C'est le NAVIGATEUR qui bloque, avant que la page ne soit chargée —
    // donc aucun `embed-denied` ne peut partir, et l'hôte voit un silence indiscernable d'une
    // instance injoignable. Le signaler ici est la seule occasion : c'est le moment exact où l'on
    // sait qu'on est destiné à être encadré. Sans DOC_FRAME_ANCESTORS, personne ne peut AFFICHER,
    // exactement comme sans PLAYER_HOST_AUTHZ_URL personne ne peut DIFFUSER.
    if (share.embed && !(PLAYER.config.extraFrameAncestors || []).length) {
      try {
        PLAYER.errors.capture(
          new Error("?embed=1 demandé mais DOC_FRAME_ANCESTORS est vide : seuls une page de même origine et *.vercel.app peuvent encadrer cette instance"),
          { route: "doc", indice: "le navigateur bloquera l'iframe avant le chargement — aucun embed-denied ne partira" },
        );
      } catch { /* jamais bloquant */ }
    }
    const frameAncestors = share.embed
      ? embedFrameAncestors()
      : "'self'";
    return sendHtml(res, 200, viewerHtml(share, nonce, logoUrl, pitch), `'nonce-${nonce}'`, [originOf(logoUrl), originOf(share.bot_avatar), originOf(share.brand_logo)].filter(Boolean).join(" "), frameAncestors);
  } catch (error) {
    try { await PLAYER.errors.capture(error, { route: "doc", method: req.method }); } catch { /* ignore */ }
    res.statusCode = 500; res.end("Erreur");
  }
}

module.exports = { handler, init };

// redeploy: forcer le build production (Vercel a sauté la prod du merge #463 — wording re-partage).