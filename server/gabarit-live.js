// EXTRAIT DE handler.js (refactor 19/08/2026) — texte déplacé À L'IDENTIQUE, aucun changement
// de comportement. Reste à PLAT dans server/ : plusieurs gardes de forge ciblent server/*.js,
// un sous-dossier les viderait en silence (la garde qui énumère maigrit quand on range).

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
  .pres-by{font-size:12px;opacity:.72;margin:0 0 8px;padding:0 2px}
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
  .join-card p{margin:0 0 15px;font-size:12.5px;color:#666}
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
  .lmodal-ok{background:#d13b40;color:#fff}
  .lmodal-ok:hover{background:#c1343a}
`;

// Contrôles de la barre (pastille présence + bouton chat).
const LIVE_BAR = `<button class=pres id=presBtn><span class=dot></span><span id=presCount>1</span><span class=pres-avs id=presAvs></span></button><button class="ic chatBtn" id=chatBtn title="Discussion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg><span class=chat-badge id=chatBadge></span></button>`;

// Panneau chat (à droite) + popover présence.
const LIVE_PANEL = `<div class="chat hidden" id=chatPanel><div class=chat-grip id=chatGrip></div><div class=chat-h><span class=chat-h-t>Discussion</span><button class=cd id=chatMute title="Couper les notifications du chat"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button><button class=cd id=chatLockBtn title="Verrouiller le chat (lecture seule)" style="display:none"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect x=5 y=11 width=14 height=10 rx=2 /><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></button><button class=cd id=chatDock title="Ancrer / détacher le chat"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect x=3 y=4 width=18 height=16 rx=2 /><line x1=15 y1=4 x2=15 y2=20 /></svg></button><button class=cx id=chatClose title=Fermer>×</button></div><div class=chat-msgs id=chatMsgs role=log aria-label="Messages de la discussion"></div><div class=chat-typing id=chatTyping></div><div class=chat-locked id=chatLocked style="display:none">Chat en lecture seule</div><div class=chat-reply id=chatReply style="display:none"></div><div class=mentionpop id=mentionPop></div><div class=chat-in><button class=chat-attach id=chatAttach title="Joindre une image ou un PDF"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2.2 stroke-linecap=round><line x1=12 y1=6 x2=12 y2=18 /><line x1=6 y1=12 x2=18 y2=12 /></svg></button><input type=file id=chatFile accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" style="display:none"><div class=chat-field><input id=chatText placeholder="Écrire un message…" aria-label="Écrire un message" maxlength=2000 autocomplete=off><button id=chatSend title=Envoyer aria-label="Envoyer le message"><svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2.4 stroke-linecap=round stroke-linejoin=round><line x1=12 y1=20 x2=12 y2=6 /><polyline points="6 12 12 6 18 12" /></svg></button></div></div></div><div class=pres-pop id=presList></div><div class=emojipick id=emojiPick></div><button class=chatfab id=chatFab title="Discussion" aria-label="Ouvrir la discussion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg><span class=chatfab-badge id=chatFabBadge></span></button><div class=chatpeek id=chatPeek></div><div class=lmodal id=lModal><div class=lmodal-box role=dialog aria-modal=true aria-labelledby=lModalT><div class=lmodal-t id=lModalT>Confirmer ?</div><div class=lmodal-d id=lModalD></div><div class=lmodal-a><button class=lmodal-cancel id=lModalNo>Annuler</button><button class=lmodal-ok id=lModalYes>Confirmer</button></div></div></div>`;

// JS partagé : présence + chat via Supabase Realtime. Live.connect(slug, me) / Live.disconnect().
const LIVE_JS = `
var Live=(function(){
  // ⚠️ LES DICTIONNAIRES SONT SANS PROTOTYPE, Y COMPRIS ICI. Leurs clés viennent de messages, de
  // participants, d'URL — donc du dehors. typers est le cas vif : il est alimenté par 'typing',
  // le SEUL événement qui croie encore son émetteur (cf. 0.1.30). Un objet nu retire la question
  // entière au lieu de la traiter cas par cas. (audit P1-2)
  // ⚠️ _ordEtat, _ordChat et _filet VIVAIENT DANS connect() : disconnect(), défini ici, ne pouvait
  // pas les atteindre. Après connect → disconnect → connect, les relectures de l'ancienne session
  // continuaient — un spectateur qui rouvre la page doublait le trafic, et le filet de sécurité
  // battait deux fois. On les déclare au niveau du CYCLE DE VIE : ce qui doit être arrêté doit
  // être visible depuis l'endroit qui arrête.
  var _ordEtat=null,_ordChat=null,_filet=null;
  var sb=null,ch=null,ME=null,SLUG=null,CONTROL=null,LOCKED=false,AUTHTOK=null,PRESENT=[],PRESNAME='',seen=Object.create(null),msgEls=Object.create(null),msgData=Object.create(null),replyCtx=null,typers=Object.create(null),pdfCache=Object.create(null),_tyT=0,_tyIv=0,_atIv=0,unread=0,autoOpened=false,_histDone=false,_phWired=false,_onMap=null,_onState=null,_peekT=0,MUTED=false;
  try{ MUTED=localStorage.getItem('3dd-present-mute')==='1'; }catch(e){}
  // Couper/rétablir les notifications du chat (cloche) : coupé = plus de ticker ni de pulse (badge silencieux gardé).
  function applyMute(){ var b=document.getElementById('chatMute'); if(b){b.classList.toggle('muted',MUTED);b.title=MUTED?'Réactiver les notifications du chat':'Couper les notifications du chat';} setBadge(); }
  function toggleMute(){ MUTED=!MUTED; try{ localStorage.setItem('3dd-present-mute',MUTED?'1':'0'); }catch(e){} if(MUTED)hidePeek(); applyMute(); }
  // Flèche « envoyer » : visible seulement si le champ contient du texte et qu'on peut poster.
  function toggleSend(){ var s=document.getElementById('chatSend'),t=document.getElementById('chatText'); if(!s||!t)return; var can=!(LOCKED&&!canMod()); s.classList.toggle('on', can && (t.value||'').trim().length>0); }
  // Un SIGNAL, plus une position : la charge utile était crue par l'audience sur un canal public.
  function sendMap(){try{if(ch)ch.send({type:'broadcast',event:'map',payload:{}});}catch(e){}}
  function onMap(fn){_onMap=fn;}
  // État de la présentation diffusé par le présentateur — même canal que la carte. Sert à se
  // passer de la lecture anonyme des tables : l'audience n'a plus besoin de lire la ligne.
  // Un SIGNAL, pas un état. L'audience relit depuis 0.1.19 et ignore déjà cette charge ; la laisser
  // partir donnait l'illusion qu'elle sert, et invitait le prochain à s'en resservir.
  function sendState(){try{if(ch)ch.send({type:'broadcast',event:'state',payload:{}});}catch(e){}}
  // CHAT EN DIFFUSION. Les messages arrivaient jusqu'ici par la lecture de TABLE en temps réel,
  // qui exige que cette table soit lisible publiquement — donc, avec la clé publiable, les
  // conversations de TOUTES les présentations, pas seulement la sienne. C'était le dernier
  // obstacle avant de pouvoir fermer cette lecture.
  // L'émetteur SIGNALE qu'un message existe ; chacun — émetteur compris — tient son affichage de
  // la RÉPONSE du serveur ou de la relecture HTTP, jamais du canal.
  // ⚠️ La diffusion ne revient pas à son émetteur : il ajoute donc SA copie lui-même — depuis la
  // RÉPONSE du serveur.
  //
  // ⚠️ LA CHARGE EST VIDE, ET C'EST CE QUI REND LA PROPRIÉTÉ STRUCTURELLE. Elle transportait la
  // ligne projetée — que le récepteur IGNORAIT (il relit par HTTP, cf. le commentaire du
  // récepteur : sans relecture, une notification pourrait afficher un texte forgé). Un contenu
  // que personne ne consomme n'est pas neutre : la description « un signal, jamais un contenu »
  // était plus forte que le code, et tenait lieu de garde sans en être une — le jour où un
  // récepteur nouveau aurait lu la charge « puisqu'elle est là », la projection serait devenue
  // optionnelle sans que rien ne le dise. Le second hôte a levé l'écart ; sendState et
  // sendMap avaient déjà la bonne forme. Le commentaire d'en tête de ce bloc a affirmé l'ancien
  // monde (« les autres l'ajoutent chez eux ») pendant des versions : il a fait dériver la
  // lecture du second hôte — puis a SURVÉCU à sa propre citation : le correctif qui le désignait
  // comme menteur l'a cité au lieu de le réécrire, et documenter un défaut l'avait rendu
  // intouchable. Réécrit à la relecture suivante, par le même hôte. Un commentaire n'est pas du
  // code : il vieillit sans essai pour le contredire — et un essai fige désormais la charge vide.
  function sendMsg(m){if(!m)return;try{if(ch)ch.send({type:'broadcast',event:'msg',payload:{}});}catch(e){}}
  function sendMsgUpd(m){if(!m)return;try{if(ch)ch.send({type:'broadcast',event:'msg-upd',payload:{}});}catch(e){}}
  // Édition, suppression, réaction : le serveur renvoie la ligne à jour, on l'applique chez soi
  // puis on SIGNALE — la charge part vide, les autres relisent. Même chemin pour les trois — une
  // seule façon de se tromper. (« Puis on la diffuse » a survécu ici une version de trop : second
  // exemplaire du commentaire d'en tête, trouvé par le second hôte dans le tarball publié.)
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
  function attKey(){ return Player.live.attendeeKey(_store(),MYID); }
  // ⚠️ CE QUI PART DANS LA PRÉSENCE N'EST PAS CE QUI IDENTIFIE UNE LIGNE DE MESURE. La présence est
  // diffusée à toute l'audience ; y mettre la clé de participation revenait à donner à chacun de
  // quoi écraser la ligne de son voisin. Deux besoins, deux valeurs.
  // Mémorisé pour la durée de la page : sans stockage, la fonction rend une valeur neuve à chaque
  // appel — c'est ce qui garantit qu'elle ne partage aucune graine avec la clé de mesure.
  var _presId=null;
  function presId(){ if(!_presId)_presId=Player.live.presenceId(_store()); return _presId; }
  // Heartbeat d'assistance → le serveur journalise qui suit, combien de temps, et les pages vues (via la page
  // courante de la présentation). Envoyé à la connexion puis toutes les 25 s. Best-effort (silencieux).
  // Le serveur ne croit plus 'isMember' ni 'isPresenter' sur parole : l'appartenance se prouve par
  // le jeton d'acces de la session, le titre de presentateur par le control_token. Ce qui part d'ici
  // n'est plus qu'une AFFIRMATION, et le serveur la remplace par ce qu'il a verifie.
  function sendAttend(){ if(!SLUG||!ME)return; try{ var h={'Content-Type':'application/json'};var jw=accessToken();if(jw)h.Authorization='Bearer '+jw;
    fetch('/api/doc',{method:'POST',headers:h,body:JSON.stringify({action:'present-attend',slug:SLUG,control:CONTROL,key:attKey(),name:ME.name||'',email:ME.email||'',avatar:ME.avatar||''})}); }catch(e){} }
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
    var p=document.getElementById('presList');if(p)p.innerHTML='<h5>'+c+' en ligne</h5>'+(PRESNAME?'<div class=pres-by>Présenté par '+esc(PRESNAME)+'</div>':'')+l.map(function(m){return '<div class=pres-item><span class=a>'+av(m.avatar,m.name)+'</span><span class=b><div class=n>'+esc(m.name||'Invité')+'</div>'+(m.email?'<div class=e>'+esc(m.email)+'</div>':'')+'</span></div>';}).join('');}
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
    // ⚠️ UN role=dialog SANS PIÈGE DE FOCUS EST UNE DÉCLARATION SANS EFFET (septième audit) :
    // Tab sortait vers la page derrière, et à la fermeture le focus tombait sur <body> — un
    // utilisateur clavier repartait de zéro. Le piège boucle entre les DEUX boutons, Échap et
    // Entrée existaient déjà, et l'élément qui avait le focus à l'ouverture le RETROUVE.
    var avant=document.activeElement;
    function close(){m.classList.remove('open');if(y)y.onclick=null;if(n)n.onclick=null;m.onclick=null;document.removeEventListener('keydown',key);
      if(avant&&avant.focus)try{avant.focus();}catch(e){}}
    function key(e){if(e.key==='Escape'){close();}else if(e.key==='Enter'){close();if(onOk)onOk();}
      else if(e.key==='Tab'){var f=[n,y].filter(function(x){return x;});if(!f.length)return;e.preventDefault();
        var i=f.indexOf(document.activeElement);var j=e.shiftKey?(i<=0?f.length-1:i-1):(i>=f.length-1?0:i+1);try{f[j].focus();}catch(err){}}}
    if(y)y.onclick=function(){close();if(onOk)onOk();};if(n)n.onclick=close;m.onclick=function(e){if(e.target===m)close();};
    document.addEventListener('keydown',key);m.classList.add('open');if(y)try{y.focus();}catch(e){}}
  // Crochet interne (même famille que __presRelireEtat) : le piège de focus ne se PROUVE que
  // piloté clavier dans un vrai navigateur, et la seule voie UI passe par un message à soi.
  try{window.__confirmDialog=confirmDialog;}catch(e){}
  function history(){fetch('/api/doc?present='+encodeURIComponent(SLUG)+'&chat=1').then(function(r){return r.json();}).then(function(d){var box=document.getElementById('chatMsgs');if(d&&d.messages&&d.messages.length){d.messages.forEach(function(m){addMsg(m);});}else if(box&&!box.children.length){box.innerHTML='<div class=chat-empty>Aucun message. Lancez la discussion.</div>';}if(d&&typeof d.locked!=='undefined')applyLock(d.locked);_histDone=true;}).catch(function(){_histDone=true;});}
  function react(id,e){if(!ME||!id||!e)return;
    // ⚠️ ON ENVOIE L'ÉTAT VOULU, PAS « INVERSE ». Basculer n'a de sens qu'une fois : un renvoi
    // réseau, un double-clic, une reprise de requête, et la réaction que le participant vient
    // d'ajouter disparaît — sans aucune erreur affichée. Il voit son émoji s'allumer puis
    // s'éteindre, recommence, et rebascule encore. Rejouer la même intention deux fois donne le
    // même résultat qu'une fois ; c'est ce que le réseau exige.
    var _m=msgData[id]||{},_rs=(_m.reactions&&_m.reactions[e])||[],veut=_rs.indexOf(MOIREF)<0;
    fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-react',slug:SLUG,msgId:+id,emoji:e,authorToken:authToken(),etat:veut})}).then(majDiffusee).catch(function(){});}
  function setReply(id){var m=msgData[id];if(!m||m.deleted)return;var nm=m.author_name||'Invité';replyCtx={id:+id,name:nm,text:(m.body||'').slice(0,120)};var el=document.getElementById('chatReply');if(el){el.style.display='flex';el.innerHTML='<span class=cq><b>'+esc(nm)+'</b> '+esc((m.body||'').slice(0,80))+'</span><button id=chatReplyX title=Annuler>×</button>';var x=document.getElementById('chatReplyX');if(x)x.addEventListener('click',clearReply);}var t=document.getElementById('chatText');if(t)t.focus();}
  function clearReply(){replyCtx=null;var el=document.getElementById('chatReply');if(el){el.style.display='none';el.innerHTML='';}}
  function send(){var i=document.getElementById('chatText');var t=(i.value||'').trim();if(!t||!ME)return;if(LOCKED&&!canMod())return;i.value='';toggleSend();

    // ⚠️ LA CLÉ EST FABRIQUÉE ICI, UNE FOIS, AVANT LE PREMIER ENVOI. Une clé tirée à chaque
    // tentative ne servirait à rien : deux envois porteraient deux clés et passeraient tous les
    // deux. C'est sa RÉUTILISATION au renvoi qui rend l'opération idempotente.
    var _cle=(function(){ try{ var r=crypto.getRandomValues(new Uint8Array(12)); return Array.from(r,function(x){return x.toString(16).padStart(2,'0');}).join(''); }catch(e){ return ''; } })();
    var o={action:'present-chat',clientKey:_cle,slug:SLUG,name:ME.name,email:ME.email,avatar:ME.avatar,body:t,authorToken:authToken()};
    if(CONTROL)o.control=CONTROL;
    if(replyCtx){o.replyTo=replyCtx.id;o.replyName=replyCtx.name;o.replyText=replyCtx.text;clearReply();}
    var h1={'Content-Type':'application/json'};var j1=accessToken();if(j1)h1.Authorization='Bearer '+j1;
    fetch('/api/doc',{method:'POST',headers:h1,body:JSON.stringify(o)})
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
        var o={action:'present-chat',slug:SLUG,name:ME.name,email:ME.email,avatar:ME.avatar,body:cap,authorToken:authToken(),attachment:{url:d.publicUrl,name:file.name,type:file.type,kind:d.kind}};
        if(CONTROL)o.control=CONTROL;
        var h2={'Content-Type':'application/json'};var j2=accessToken();if(j2)h2.Authorization='Bearer '+j2;
        return fetch('/api/doc',{method:'POST',headers:h2,body:JSON.stringify(o)});
      });
    }).then(done).catch(function(){done();});}
  function applyLock(v){LOCKED=!!v;var t=document.getElementById('chatText'),s=document.getElementById('chatSend');var can=!LOCKED||canMod();if(t){t.disabled=!can;t.placeholder=can?'Écrire un message…':'Chat en lecture seule';}if(s)s.disabled=!can;var lk=document.getElementById('chatLockBtn');if(lk)lk.classList.toggle('on',LOCKED);var no=document.getElementById('chatLocked');if(no)no.style.display=(LOCKED&&!canMod())?'block':'none';toggleSend();}
  function toggleLock(){if(!canMod())return;var nv=!LOCKED;fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'present-chatlock',slug:SLUG,control:CONTROL,locked:nv})}).then(function(){applyLock(nv);try{if(ch)ch.send({type:'broadcast',event:'lock',payload:{locked:nv}});}catch(e){}}).catch(function(){});}
  function pingTyping(){var n=Date.now();if(n-_tyT<1600)return;_tyT=n;try{if(ch)ch.send({type:'broadcast',event:'typing',payload:{id:MYID,name:ME&&ME.name}});}catch(e){}}
  function onTyping(p){if(!p||p.id===MYID)return;typers[p.id]={name:p.name,t:Date.now()};renderTyping();}
  function renderTyping(){var el=document.getElementById('chatTyping');if(!el)return;var n=Date.now(),names=[];for(var k in typers){if(n-typers[k].t<4200)names.push(typers[k].name||'Quelqu\\'un');else delete typers[k];}el.textContent=names.length?(names.slice(0,2).join(', ')+(names.length>1?' écrivent…':' écrit…')):'';}
  function openPicker(btn,id){var p=document.getElementById('emojiPick');if(!p)return;p.__id=id;var r=btn.getBoundingClientRect();p.style.left=Math.max(8,Math.min(r.left-120,window.innerWidth-200))+'px';p.style.top=Math.max(8,r.top-44)+'px';p.classList.add('open');}
  function mentionCheck(){var t=document.getElementById('chatText'),pop=document.getElementById('mentionPop');if(!t||!pop)return;var pos=t.selectionStart||0,pre=t.value.slice(0,pos),mm=pre.match(/@([\\p{L}0-9_'.-]*)$/u);if(!mm){pop.classList.remove('open');return;}var q=(mm[1]||'').toLowerCase();var seenN=Object.create(null),uniq=[];(PRESENT||[]).forEach(function(p){if(!p.name)return;var k=p.name.toLowerCase();if(seenN[k]||(ME&&p.name===ME.name))return;if(q&&k.indexOf(q)<0)return;seenN[k]=1;uniq.push(p);});uniq=uniq.slice(0,6);if(!uniq.length){pop.classList.remove('open');return;}pop.__len=(mm[1]||'').length;pop.innerHTML=uniq.map(function(p,i){return '<button class="'+(i===0?'sel':'')+'" data-n="'+esc(p.name)+'"><span class=a>'+av(p.avatar,p.name)+'</span>'+esc(p.name)+'</button>';}).join('');pop.classList.add('open');}
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
  // ⚠️ NOTRE IDENTITÉ PUBLIQUE, ET LA SEULE. Elle remplace l'adresse partout où une identité
  // devait sortir : clé du canal de présence, charge de présence, identité d'un réacteur,
  // appartenance d'un message. Dérivée du jeton d'auteur — celui qui autorise déjà à modifier et
  // supprimer — donc « c'est moi » dit enfin la même chose que « j'ai le droit ».
  //
  // ⚠️ PRÉPARÉE AU CHARGEMENT, PAS DANS LA CONNEXION. Premier jet : la connexion attendait le
  // hachage avant de faire quoi que ce soit — tout retardé pour un calcul local, et deux essais
  // tombés qui pilotent la page de façon synchrone. Le hachage ne dépend que du jeton d'auteur :
  // il n'a aucune raison d'attendre un appel, et la souscription réseau lui laisse tout le temps.
  //
  // La CLÉ de présence, elle, n'en a jamais eu besoin : MYID est déjà tiré au sort par navigateur.
  // Y mettre l'adresse ne servait qu'au confort de lecture, au prix d'une identité publiée à tous.
  //
  // ⚠️ ET PAS D'ACCENT GRAVE DANS CE COMMENTAIRE : il vit DANS le gabarit de la page, donc un
  // accent grave y ferme la chaîne. Ce bloc l'a appris à ses dépens il y a trois minutes.
  //
  // Vide dans un contexte non sécurisé (pas de crypto.subtle) : on s'annonce alors sans identité
  // plutôt qu'avec une fausse, et les boutons qui supposent la propriété disparaissent.
  var MOIREF='';
  var REFPRETE=(function(){ try{ return Player.live.referenceAuteur(authToken()).then(function(r){ MOIREF=r||''; }).catch(function(){ MOIREF=''; }); }catch(e){ return Promise.resolve(); } })();
  function connect(slug,me,control){if(!window.supabase||!LIVECFG.supaUrl||!LIVECFG.supaKey||!slug)return;SLUG=slug;ME=me;CONTROL=control||null;try{ME.ref=MOIREF;}catch(e){}
    var pb=document.getElementById('presBtn');if(pb)pb.style.display='inline-flex';
    var cb=document.getElementById('chatBtn');if(cb)cb.style.display='inline-flex';var _fb=document.getElementById('chatFab');if(_fb)_fb.classList.add('on');
    wire();history();
    try{sb=window.supabase.createClient(LIVECFG.supaUrl,LIVECFG.supaKey,{realtime:{params:{eventsPerSecond:10}},
      // ⚠️ UNE CLÉ DÉCLARÉE, PAS CELLE PAR DÉFAUT. Ce client vivra un jour une session anonyme
      // (canal Realtime prive). S'il ecrit sous la cle par defaut et que l'application de l'hote
      // l'utilise aussi sur la meme origine, la session anonyme ECRASE celle du membre connecte.
      // Chez nous les deux cles different deja, mais par heureux hasard : le declarer rend
      // intentionnel ce qui n'etait qu'une consequence, et une topologie peut changer.
      auth:{storageKey:LIVECFG.liveAuthKey||'dmp-live-auth',persistSession:true,autoRefreshToken:true}});
      ch=sb.channel('plive-'+slug,{config:{presence:{key:MYID}}});
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
      // ⚠️ ORDONNANCEUR BORNÉ, PAS UN DEBOUNCE. Ce qui était écrit ici repoussait l'échéance à
      // chaque signal : un participant diffusant toutes les 100 ms empêchait la relecture
      // INDÉFINIMENT. Toute la défense de 0.1.19 repose sur cette relecture — l'affamer ne
      // falsifie rien, ça fige simplement l'audience, sans qu'aucune erreur ne le dise.
      // Et à l'inverse, des signaux un peu plus espacés produisaient une requête chacun, POUR
      // CHAQUE SPECTATEUR : le canal public devenait un amplificateur vers l'API.
      // Détail et propriétés : src/live.ts + src/__tests__/ordonnanceur.test.ts. (audit P0-2)
      // ⚠️ LE BUDGET GATE LE SIGNAL, JAMAIS LE FILET — ET C'EST TOUTE LA DIFFÉRENCE.
      //
      // « signaler() » est déclenché par le canal, donc par n'importe quel participant : c'est la
      // porte par laquelle un diffuseur hostile faisait relire toute une salle jusqu'au quota, et
      // au-delà. On la rationne.
      //
      // « maintenant() » est le filet périodique, déclenché par NOUS toutes les 25 s. Le rationner
      // rendrait une audience à budget épuisé définitivement muette — on aurait remplacé un déni de
      // service venu du dehors par un déni de service maison. C'est le plancher : quoi qu'il arrive,
      // l'audience finit toujours par se resynchroniser.
      //
      // Refuser un signal ne perd donc rien : la relecture suivante lira l'état le plus récent. On
      // arrive en retard, jamais à côté.
      function relireAvec(url,applique){
        var ord=Player.live.createScheduler(function(fini){
          Player.live.fetchBorne('/api/doc?present='+encodeURIComponent(SLUG)+url)
            .then(function(r){return r.json();})
            .then(function(d){if(d&&d.ok)applique(d);})
            .catch(function(){})
            .then(fini,fini);
        // ⚠️ La fenêtre vient de la constante partagée, pas d'un nombre écrit ici : le cache serveur
        // se déduit d'elle, et deux nombres séparés finiraient par diverger — un cache plus long que
        // le regroupement ajouterait une attente que le spectateur n'a pas consentie.
        },{minMs:(window.Player&&Player.cadence&&Player.cadence.PRESENT_READ_COALESCE_MS)||400});
        var budget=Player.live.createBudget({
          parHeure:Player.cadence.PRESENT_SIGNAL_BUDGET_PER_HOUR,
          rafale:Player.cadence.PRESENT_READ_BURST,
        });
        return {
          signaler:function(){ if(budget.prendre()) ord.signaler(); },
          maintenant:function(){ ord.maintenant(); },
          arreter:function(){ ord.arreter(); },
        };
      }
      _ordEtat=relireAvec('&state=1',function(d){if(d.state)etatDuServeur(d.state);});
      // ⚠️ Exposé hors de cette fermeture : la carte vit dans un AUTRE bloc de script et doit
      // pouvoir déclencher la relecture. Même raison que window.__presAppliquerEtat — un nom
      // référencé depuis la mauvaise portée part dans un catch muet, et l'audience se fige.
      window.__presRelireEtat=function(){_ordEtat.signaler();};
      function relireEtat(){_ordEtat.signaler();}
      function relireChat(){_ordChat.signaler();}
      _ordChat=relireAvec('&chat=1',function(d){
          // ⚠️ NOTIFIER CE QUI VIENT D'ARRIVER, ET SEULEMENT ÇA. 'addMsg' rend faux pour un
          // message déjà connu — la relecture ramène tout l'historique, donc sans cette condition
          // la pastille de non-lus compterait chaque message à chaque relecture. Et sans l'appel,
          // elle ne compte plus rien : c'est la régression que le test d'un hôte a attrapée en
          // lisant le source de ce paquet, à travers la frontière de deux dépôts.
          if(d.messages)d.messages.forEach(function(m){if(addMsg(m))notifyMsg(m);else updateMsg(m);});
          if(typeof d.locked!=='undefined')applyLock(d.locked);
      });

      // ⚠️ LE FILET. Borner la cadence ouvre la possibilité qu'un signal se perde — un WebSocket
      // qui tombe, un onglet endormi, un message jamais délivré. Une resynchronisation lente
      // rattrape ce cas : elle ne coûte presque rien et évite qu'une audience reste figée sur un
      // état périmé en croyant être à jour. C'est l'inverse d'une optimisation : c'est le prix de
      // la borne.
      _filet=setInterval(function(){_ordEtat.maintenant();_ordChat.maintenant();},25000);

      // ⚠️ LE TITRE VIENT D'ICI, PAS DE LA PRÉSENCE. La liste des participants tirait
      // « présentateur » de la charge de présence, que chacun compose lui-même : un
      // 'track({role:"presenter"})' suffisait à apparaître comme le présentateur devant toute
      // l'audience, avec le nom et l'avatar de son choix. Le canal ne peut pas arbitrer ça — un
      // participant légitime a le droit d'y écrire SA présence.
      //
      // Le serveur renvoie la CLÉ de celui qui a prouvé le control_token ; l'audience compare. Pas
      // de clé, pas de titre : mieux vaut aucun titre qu'un titre usurpé.
      function etatDuServeur(st){
        if(typeof st.presenter_name!=='undefined'){var n2=st.presenter_name||'';
          if(n2!==PRESNAME){PRESNAME=n2;try{if(ch)renderPres(ch.presenceState());}catch(e){}}}
        if(_onState)_onState(st);
      }
      relire('&state=1',function(d){if(d.state)etatDuServeur(d.state);});

      // Le message reçu sert à savoir QU'IL SE PASSE quelque chose, et à notifier ; son CONTENU
      // vient de la relecture. Sans ça, une notification pourrait afficher un texte forgé.
      ch.on('broadcast',{event:'msg'},function(){relireChat();});
      ch.on('broadcast',{event:'msg-upd'},function(){relireChat();});
      ch.on('broadcast',{event:'lock'},function(){relireChat();});
      ch.on('broadcast',{event:'state'},function(){relireEtat();});
      ch.on('broadcast',{event:'typing'},function(p){onTyping(p&&p.payload);});
      // ⚠️ AUCUNE CHARGE NE PASSE. Elle est ignorée plus loin, mais s'arrêter là serait une défense
      // par accident : le jour où quelqu'un rebranche un paramètre, la charge d'un canal public
      // redeviendrait crue sans que rien ne le signale. On coupe le chemin, pas seulement l'usage.
      ch.on('broadcast',{event:'map'},function(){if(_onMap)_onMap();});
      ch.subscribe(function(st){if(st==='SUBSCRIBED'){REFPRETE.then(function(){ME.ref=MOIREF;ch.track({name:me.name,ref:MOIREF,avatar:me.avatar,role:me.role,member:!!me.member,uid:presId()});sendAttend();});}});
      _tyIv=setInterval(renderTyping,1500);
      _atIv=setInterval(sendAttend,25000);
      // Filet de sécurité : au déchargement de la page/iframe (fermeture, reload, switch), on retire la présence
      // → évite les fantômes (« je me vois deux fois » au retour). Une seule fois.
      if(!_phWired){_phWired=true;window.addEventListener('pagehide',function(){try{clearInterval(_filet);_ordEtat.arreter();_ordChat.arreter();}catch(e){}try{if(ch){ch.untrack();ch.unsubscribe();ch=null;}}catch(e){}});}
    }catch(e){}}
  function disconnect(){try{clearInterval(_tyIv);}catch(e){}try{clearInterval(_atIv);}catch(e){}try{clearInterval(_filet);_filet=null;}catch(e){}try{if(_ordEtat)_ordEtat.arreter();_ordEtat=null;}catch(e){}try{if(_ordChat)_ordChat.arreter();_ordChat=null;}catch(e){}try{delete window.__presRelireEtat;}catch(e){window.__presRelireEtat=null;}try{sendAttend();}catch(e){}try{if(ch){ch.untrack();ch.unsubscribe();ch=null;}}catch(e){}var pb=document.getElementById('presBtn');if(pb)pb.style.display='none';var cb=document.getElementById('chatBtn');if(cb)cb.style.display='none';var _fb=document.getElementById('chatFab');if(_fb)_fb.classList.remove('on');var pn=document.getElementById('chatPanel');if(pn)pn.classList.add('hidden');}
  // Membre de l'équipe reconnu via la session app (MÊME ORIGINE, localStorage) → avatar + nom auto.
  // Le jeton d'acces de la session locale, quand il y en a une. C'est la SEULE chose qui prouve au
  // serveur qu'on est un membre ; 'member:true' dans la page ne prouve rien, il ne sert qu'a l'affichage.
  function accessToken(){try{var raw=localStorage.getItem(LIVECFG.hostAuthKey||'');if(!raw)return '';var s=JSON.parse(raw);
    return String((s&&(s.access_token||(s.currentSession&&s.currentSession.access_token)||(s.session&&s.session.access_token)))||'');}catch(e){return '';}}
  function detectMember(){try{var raw=localStorage.getItem(LIVECFG.hostAuthKey||'');if(!raw)return null;var s=JSON.parse(raw);var u=s&&(s.user||(s.currentSession&&s.currentSession.user)||(s.session&&s.session.user));if(u&&u.email){var m=u.user_metadata||{};return{name:m.name||u.email,email:u.email,avatar:m.avatarUrl||'',member:true,role:'viewer'};}}catch(e){}return null;}
  return {connect:connect,disconnect:disconnect,detectMember:detectMember,sendMap:sendMap,onMap:onMap,sendState:sendState,onState:onState};
})();`;

module.exports = { LIVE_CSS, LIVE_BAR, LIVE_PANEL, LIVE_JS };
