// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor 19/08/2026) — texte déplacé À L'IDENTIQUE, aucun changement
// de comportement. Reste à PLAT dans server/ : plusieurs gardes de forge ciblent server/*.js,
// un sous-dossier les viderait en silence (la garde qui énumère maigrit quand on range).

const { esc } = require("./texte");

// Même câblage que les autres modules : le contexte arrive par init(), jamais par un global.
let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

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

module.exports = { init, BOT_CSS, ICO, ICONS, botMarkup };
