// EXTRAIT DE handler.js (refactor lot 2, 19/08/2026) — texte déplacé À L'IDENTIQUE. Reste à
// PLAT dans server/ (les gardes de forge ciblent server/*.js).
const { esc, jsonPourScript } = require("./texte");
const { PDFJS, PDFJS_WORKER, TIERS, balise } = require("./tiers");
const { LIVE_CSS, LIVE_BAR, LIVE_PANEL, LIVE_JS } = require("./gabarit-live");
const { MAP_CSS, MAP_MARKUP, MAP_JS } = require("./gabarit-carte");
const { legalFooter, LEGAL_CSS } = require("./gabarit-legal");
const { cleSessionHote, CLE_SESSION_PLAYER, CLE_INVITE } = require("./session-cles");

const { PLAYER_BROWSER_JS } = require("./browser.generated.js");
let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

// Page AUDIENCE d'une présentation live : affiche UNE page (celle du présentateur), suivie en temps réel
// via Supabase Realtime. Navigation verrouillée (page à page). « Terminée » quand le présentateur ferme.
function presentHtml(pres, nonce, logoUrl, supaUrl, supaKey) {
  const title = esc(pres.doc_title || pres.file_name || "Document");
  const presenter = esc(pres.presenter_name || "");
  const logo = esc(logoUrl || "");
  const fileUrl = `/api/doc?present=${encodeURIComponent(pres.slug)}&file=1`;
  const cfg = jsonPourScript({ fileUrl, docUrl: pres.file_url, pdfjs: PDFJS, pdfjsWorker: PDFJS_WORKER, slug: pres.slug, fileName: pres.file_name || "", page: pres.current_page || 1, active: pres.active !== false, content: pres.content || null, supaUrl, supaKey, title: pres.doc_title || pres.file_name || "Document" });
  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=3">
<meta name=robots content="noindex,nofollow">
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
  .lsub{font-size:11.5px;color:#aaa69d;letter-spacing:.03em}
  .srol{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
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
        <div id=sr aria-live=polite class=srol></div>
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
  ${balise(nonce, TIERS.supa)}
  <script nonce="${nonce}">
  (function(){
    var CFG=${cfg};
    var PDF=null, total=0, cur=CFG.page||1, ready=false;
    // ⚠️ DEUX GÉNÉRATIONS, PARCE QU'IL Y A DEUX COURSES DISTINCTES (P1 audit externe).
    //
    // docGen : le présentateur change de document pendant qu'un chargement est en cours. Le
    // callback de l'ANCIEN document arrivait après le nouveau et posait ses pages par-dessus.
    // renderGen : deux getPage() en vol (changement de page rapide, redimensionnement) peuvent
    // se résoudre DANS LE DÉSORDRE — pdf.js ne garantit aucun ordre entre deux pages. Le plus lent
    // gagnait, et l'audience restait sur une page que personne n'avait demandée.
    //
    // Une génération par course : les confondre ferait qu'un simple changement de page invaliderait
    // le document, ou l'inverse.
    var docGen=0, renderGen=0, tacheRendu=null, chargement=null;
    var stage=document.getElementById('stage'), pageEl=document.getElementById('page');
    function hideLoader(){ var l=document.getElementById('load'); if(l){ l.classList.add('hide'); setTimeout(function(){ if(l.parentNode)l.parentNode.removeChild(l); },450);} }
    function ended(){ document.getElementById('ended').style.display='flex';
      var sr=document.getElementById('sr'); if(sr)sr.textContent='Présentation terminée.'; }
    function show(n){
      if(!PDF) return;
      n=Math.max(1,Math.min(total||1, n||1)); cur=n;
      var c=document.getElementById('cur'); if(c)c.textContent=n;
      var sr=document.getElementById('sr'); if(sr)sr.textContent='Page '+n+(total>1?' sur '+total:'');
      // Une image tient sur une page : on la pose, ajustée au cadre, et le reste de la vue —
      // synchronisation, présence, chat — continue de fonctionner à l identique.
      if(PDF.image){
        var pgi=document.getElementById('page'); if(!pgi) return;
        var dispoW=Math.max(120, stage.clientWidth-40), dispoH=Math.max(120, stage.clientHeight-40);
        var ech=Math.min(dispoW/(PDF.image.naturalWidth||1), dispoH/(PDF.image.naturalHeight||1), 1);
        var el=PDF.image.cloneNode(false);
        el.style.width=Math.round((PDF.image.naturalWidth||1)*ech)+'px';
        el.style.height='auto'; el.style.display='block';
        pgi.innerHTML=''; pgi.appendChild(el);
        return;
      }
      // ⚠️ ON ANNULE LE RENDU PRÉCÉDENT AVANT D'EN LANCER UN AUTRE. Le RenderTask était jeté :
      // deux rendus peignaient alors en parallèle, et le plus lent finissait par l'emporter.
      if(tacheRendu){ try{ tacheRendu.cancel(); }catch(e){} tacheRendu=null; }
      var monDoc=docGen, monRendu=++renderGen;
      PDF.getPage(n).then(function(page){
        // Le document a changé, ou une page plus récente a été demandée pendant que celle-ci
        // arrivait : ce résultat n'est plus celui qu'on attend. On ne le pose pas.
        if(monDoc!==docGen || monRendu!==renderGen) return;
        var availW=Math.max(120, stage.clientWidth-40), availH=Math.max(120, stage.clientHeight-40);
        var v1=page.getViewport({scale:1});
        var scale=Math.min(availW/v1.width, availH/v1.height); // fit entier → une page à l'écran
        var dpr=window.devicePixelRatio||1, vp=page.getViewport({scale:scale});
        var cv=document.createElement('canvas'); cv.width=Math.floor(vp.width*dpr); cv.height=Math.floor(vp.height*dpr);
        cv.setAttribute('role','img'); cv.setAttribute('aria-label','Page '+n+(total>1?' sur '+total:''));
        cv.style.width=vp.width+'px'; cv.style.height=vp.height+'px';
        var t=page.render({canvasContext:cv.getContext('2d'),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
        tacheRendu=t;
        // ⚠️ ON NE PUBLIE QU'APRÈS LE RENDU. L'ancien code posait le canvas AVANT que pdf.js n'ait
        // peint : la page apparaissait blanche puis se remplissait, et un rendu périmé pouvait
        // encore écraser le bon. On revérifie la génération APRÈS l'attente — c'est là qu'elle a pu
        // changer, pas avant.
        return t.promise.then(function(){
          if(monDoc!==docGen || monRendu!==renderGen) return;
          if(tacheRendu===t) tacheRendu=null;
          pageEl.innerHTML=''; pageEl.appendChild(cv);
        });
      }).catch(function(){ /* rendu annulé ou page illisible : le rendu courant fait foi */ });
    }
    function boot(){
      import(CFG.pdfjs).then(function(m){
        window.pdfjsLib=m;
        pdfjsLib.GlobalWorkerOptions.workerSrc=CFG.pdfjsWorker;
        load();
      }).catch(function(){ window.__workerRefuse=1; var _e=document.getElementById('pg'); if(_e)_e.textContent="Document non affiche : une dependance n a pas pu etre verifiee."; });
    }
    // ⚠️ UNE PRÉSENTATION PEUT PORTER UNE IMAGE, ET CETTE VUE NE LE SAVAIT PAS. Le bouton
    // Présenter s apparait sans condition sur le type de document : un présentateur qui regarde un
    // PNG peut donc le présenter, et son audience recevait une page qui appelait pdf.js sur une
    // image — « Document indisponible ». Un bouton qui mène à une page morte est pire qu un bouton
    // absent.
    //
    // Ce n est PAS une régression du refus de worker : ce chemin était muet bien avant, et
    // personne ne l avait vu parce qu on ne présente pas souvent une image. Trouvé par le second
    // hôte, en POSANT LA QUESTION là où nous aurions affirmé — sa vue à lui sert des images, il a
    // demandé si la nôtre pouvait en recevoir.
    // ⚠️ Évalué AU CHARGEMENT, pas à l analyse du script : posé en constante de haut niveau, il
    // s exécutait avant que tout soit en place et emportait le reste du bloc avec lui — le
    // gestionnaire d état n était plus exposé, et la couche live ne pouvait plus se brancher. Un
    // essai l a dit tout de suite. Une question posée au bon moment ne coûte rien ; posée trop tôt,
    // elle emporte ce qui vient après.
    // ⚠️ SUR L URL D ORIGINE, JAMAIS SUR L URL DE PROXY. Premier jet : je passais
    // CFG.fileUrl, qui vaut /api/doc?present=...&file=1 — aucune extension, donc la réponse était
    // toujours « ce n est pas une image », et la page repartait sur pdf.js avec un PNG. Pire, un
    // try/catch posé par prudence avalait tout : la sonde n a rien vu jusqu à ce qu on lise le
    // sous-titre du loader, qui disait « Document indisponible ».
    //
    // Une garde défensive qui rend faux sur erreur ne protège pas, elle CACHE. Retirée.
    //
    // ⚠️ LE NOM FAIT FOI, L URL COMPLÈTE — et j avais gardé l inverse. Deux correctifs avaient été
    // écrits pour un symptôme ; comme chacun suffisait, aucune mutation ne pouvait faire rougir le
    // banc. J en ai donc retiré un — et j ai retiré le champ AUTORITAIRE, en gardant celui que le
    // banc savait déjà voir. Le banc a choisi le correctif au lieu de le vérifier.
    //
    // Signalé par le second hôte, qui a compté chez lui : 4 287 documents présentables, 23 dont l
    // URL ne porte aucune extension, aucune image parmi ces 23. Atteignable, non peuplé. Le jour où
    // l un de ces liens porte un PNG, décider sur l URL seule ramène « Document indisponible ».
    //
    // La règle « un correctif à deux changements ne se prouve pas » ne dit pas LEQUEL garder. La
    // réponse n est jamais « celui que le banc sait voir » : on garde le champ qui fait foi, puis on
    // rend le banc capable de le distinguer — un cas où l URL ment et où seul le nom dit vrai.
    function estImage(){ return Player.viewer.isImageDocument(CFG.fileName, CFG.docUrl); }
    function chargerImage(monDoc){
      var im=new Image();
      im.alt='Document présenté';
      im.onload=function(){
        // Le présentateur a pu rebasculer pendant le téléchargement : cette image n'est plus celle
        // du document courant.
        if(monDoc!==docGen) return;
        total=1; ready=true; PDF={image:im};
        var tot=document.getElementById('tot'); if(tot)tot.textContent=1;
        show(1); hideLoader();
        if(!CFG.active) ended();
      };
      im.onerror=function(){ if(monDoc!==docGen) return; var l=document.getElementById('load'); if(l)l.querySelector('.lsub').textContent="Document indisponible."; };
      im.src=CFG.fileUrl;
    }
    // ⚠️ ON LIBÈRE L'ANCIEN DOCUMENT. Un PDFDocumentProxy retient ses pages, ses canvas et son
    // worker : enchaîner les bascules sans détruire faisait croître la mémoire sans borne, et c'est
    // le mode de panne d'une présentation longue — celle qui dure, pas celle qu'on teste.
    function libererDocument(){
      if(tacheRendu){ try{ tacheRendu.cancel(); }catch(e){} tacheRendu=null; }
      if(chargement){ try{ chargement.destroy(); }catch(e){} chargement=null; }
      if(PDF && !PDF.image && typeof PDF.destroy==='function'){ try{ PDF.destroy(); }catch(e){} }
      PDF=null;
    }
    function load(){
      var monDoc=docGen;
      if(estImage()){ chargerImage(monDoc); return; }
      var t=pdfjsLib.getDocument({url:CFG.fileUrl,isEvalSupported:false});
      chargement=t;
      t.promise.then(function(pdf){
        // Une bascule est survenue pendant le chargement : ce document n'est plus attendu, et le
        // garder fuirait. On le détruit plutôt que de simplement l'ignorer.
        if(monDoc!==docGen){ try{ pdf.destroy(); }catch(e){} return; }
        PDF=pdf; total=pdf.numPages; ready=true;
        var tot=document.getElementById('tot'); if(tot)tot.textContent=total;
        show(cur); hideLoader();
        if(!CFG.active) ended();
      }).catch(function(){ if(monDoc!==docGen) return; var l=document.getElementById('load'); if(l)l.querySelector('.lsub').textContent="Document indisponible."; });
    }
    // Le présentateur a changé de document (même session) → recharger le PDF servi par le proxy (URL identique →
    // cache-buster obligatoire), remettre à la page 1, mettre à jour le titre.
    // ⚠️ TOUT CE QUI DÉCRIT LE DOCUMENT CHANGE ENSEMBLE, fileName COMPRIS — c'était le P1.
    //
    // fileName n'était PAS mis à jour, alors que c'est lui qui fait foi pour décider image ou PDF
    // (estImage, et le commentaire plus bas dit pourquoi). Après une bascule, le nom restait celui
    // du document précédent : un PDF→PNG envoyait donc le nouveau PNG à pdf.js, et un PNG→PDF
    // chargeait le nouveau PDF avec new Image(). Dans les deux cas : « Document indisponible ».
    //
    // Une mise à jour partielle d'un état qui se lit comme un TOUT est la forme du défaut : il n'y a
    // pas de moment où CFG doit décrire un document par son URL et un autre par son nom.
    function switchDoc(row){
      docGen++;                 // invalide tout callback du document précédent
      libererDocument();
      var t=document.getElementById('ptitle'); if(t) t.textContent=row.doc_title||row.file_name||'Document';
      var pg=document.getElementById('page'); if(pg) pg.innerHTML='';
      cur=1; total=0; ready=false;
      var tot=document.getElementById('tot'); if(tot)tot.textContent='—';
      var cu=document.getElementById('cur'); if(cu)cu.textContent='1';
      if(row.file_url) CFG.docUrl=row.file_url;
      CFG.fileName=row.file_name||'';
      CFG.title=row.doc_title||row.file_name||'Document';
      CFG.fileUrl='/api/doc?present='+encodeURIComponent(CFG.slug)+'&file=1&v='+encodeURIComponent(row.updated_at||String(row.current_page||1));
      load();
    }
    // La balise pdf.min.js n'existe plus : boot() importe lui-même la bibliothèque.
    boot();
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
        // switchDoc pose LUI-MÊME docUrl/fileName/titre : les poser ici, en partie, était
        // exactement ce qui laissait fileName en arrière.
        if(a.kind==='switch-doc'){ switchDoc(row); return; }
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
  var LIVECFG=${jsonPourScript({ supaUrl: supaUrl || "", supaKey: supaKey || "", hostAuthKey: cleSessionHote(), liveAuthKey: CLE_SESSION_PLAYER, guestKey: CLE_INVITE })};var GMAPS_KEY=${jsonPourScript((PLAYER.config && PLAYER.config.mapsKey) || "")};
  ${LIVE_JS}
  ${MAP_JS}
  (function(){
    var slug=${jsonPourScript(pres.slug)};
    // Carte live : suivre en direct les mouvements du présentateur (broadcast).
    // ⚠️ ON NE CROIT PLUS LA CHARGE. Le signal dit « quelque chose a bougé » ; ce qui a bougé vient
    // de la relecture d'état, gatée par l'écriture du présentateur. Un participant hostile peut
    // émettre : il déclenche une relecture bornée, et n'obtient rien.
    try{ if(window.Live&&window.Map3DD) Live.onMap(function(){ if(window.__presRelireEtat)window.__presRelireEtat(); }); }catch(e){}
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
    function appTok(){ try{ var raw=localStorage.getItem(LIVECFG.hostAuthKey||''); if(!raw)return''; var s=JSON.parse(raw); return (s&&(s.access_token||(s.currentSession&&s.currentSession.access_token)||(s.session&&s.session.access_token)))||''; }catch(e){return'';} }
    function checkOwner(){ var tk=appTok(); if(!tk)return; fetch('/api/doc',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tk},body:JSON.stringify({action:'present-list'})}).then(function(r){return r.json();}).then(function(d){ var mine=false; if(d&&d.presentations){ for(var i=0;i<d.presentations.length;i++){ if(d.presentations[i].slug===slug&&d.presentations[i].mine){mine=true;break;} } } var b=document.getElementById('takeOver'); if(b)b.style.display=mine?'inline-flex':'none'; }).catch(function(){}); }
    function startOwnerWatch(){ var b=document.getElementById('takeOver'); if(b&&!b._w){b._w=1;b.addEventListener('click',function(){ location.href='/app/documents?resume='+encodeURIComponent(slug); });} checkOwner(); setInterval(checkOwner,12000); }
    var me=Live.detectMember();
    if(me){ Live.connect(slug, me); startOwnerWatch(); return; }
    var saved=null; try{ saved=JSON.parse(localStorage.getItem(LIVECFG.guestKey||'dmp-present-me')||'null'); }catch(e){}
    if(saved&&saved.name){ Live.connect(slug, saved); return; }
    // Externe : on demande le nom pour participer.
    var o=document.createElement('div'); o.className='join';
    o.innerHTML='<div class=join-card role=dialog aria-modal=true aria-label="Rejoindre la présentation"><h4>Rejoindre la présentation</h4><p>Votre nom pour participer à la discussion.</p><input id=jName placeholder="Votre nom" aria-label="Votre nom" maxlength=60 autocomplete=name><input id=jMail placeholder="Email (facultatif)" aria-label="Email, facultatif" maxlength=120 autocomplete=email><button id=jGo>Rejoindre</button></div>';
    document.body.appendChild(o);
    var n=o.querySelector('#jName'); try{ n.focus(); }catch(e){}
    function go(){ var name=(n.value||'').trim()||'Invité'; var email=(o.querySelector('#jMail').value||'').trim(); var me2={name:name,email:email,avatar:'',member:false,role:'viewer'}; try{ localStorage.setItem(LIVECFG.guestKey||'dmp-present-me',JSON.stringify(me2)); }catch(e){} o.parentNode&&o.parentNode.removeChild(o); Live.connect(slug, me2); }
    o.querySelector('#jGo').addEventListener('click',go);
    n.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
  })();
  </script>
</body></html>`;
}

module.exports = { init, presentHtml };
