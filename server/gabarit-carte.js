// EXTRAIT DE handler.js (refactor 19/08/2026) — texte déplacé À L'IDENTIQUE, aucun changement
// de comportement. Reste à PLAT dans server/ : plusieurs gardes de forge ciblent server/*.js,
// un sous-dossier les viderait en silence (la garde qui énumère maigrit quand on range).

const { TIERS, MAPS_VERSION } = require("./tiers");

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
    var css=document.createElement('link');css.rel='stylesheet';css.href='${TIERS.leafletCss.url}';css.integrity='${TIERS.leafletCss.sri}';css.crossOrigin='anonymous';document.head.appendChild(css);
    var s=document.createElement('script');s.src='${TIERS.leaflet.url}';s.integrity='${TIERS.leaflet.sri}';s.crossOrigin='anonymous';document.body.appendChild(s); }
  // Google Maps JS chargé à la demande, seulement si une clé est fournie (GMAPS_KEY).
  function loadGoogle(cb){ if(window.google&&window.google.maps){cb();return;} if(!GMAPS_KEY)return; var iv=setInterval(function(){if(window.google&&window.google.maps){clearInterval(iv);cb();}},120);
    if(gLoading)return; gLoading=true;
    var s=document.createElement('script');s.async=true;s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(GMAPS_KEY)+'&v=${MAPS_VERSION}&loading=async';document.body.appendChild(s); }
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
  // ⚠️ LA POSITION NE VOYAGE PLUS DANS LA DIFFUSION.
  //
  // Elle y voyageait, et l'audience l'appliquait telle quelle. Le canal étant public, n'importe quel
  // participant déplaçait donc la carte de tout le monde, avec les coordonnées de son choix. C'était
  // assumé en 0.1.19 au motif que le signal est « éphémère et sans vérité serveur » — l'argument ne
  // tient pas : PENDANT UN MODE CARTE, CE SIGNAL EST L'IMAGE QUE VOIT L'AUDIENCE. 'typing' peut
  // rester cosmétique, 'map' non. (audit P0-1)
  //
  // Le présentateur persiste sa position (route gatée par JWT), puis émet un signal VIDE. L'audience
  // relit l'état et applique ce que le serveur lui donne. Un participant hostile peut toujours
  // émettre le signal : il provoque une relecture, et n'obtient rien.
  //
  // ⚠️ ORDONNANCEUR ET NON DEBOUNCE, et c'est le cœur du problème. schedPersist repoussait
  // l'écriture de 700 ms à chaque mouvement : pendant un déplacement CONTINU, elle ne partait
  // jamais. C'est précisément pour ça que la position voyageait dans la diffusion. Un ordonnanceur
  // écrit au plus une fois par 500 ms ET sert toujours la dernière position — donc l'audience suit
  // pendant le mouvement, pas seulement à l'arrêt.
  //
  // Le suivi devient PAR PALIERS au lieu d'être continu (environ deux fois par seconde). C'est le
  // prix pour que personne d'autre que le présentateur ne pilote l'écran de l'audience.
  // ⚠️ CET ORDONNANCEUR N'EN EST PLUS UN, ET C'EST LE CORRECTIF. Il en existait DEUX ici — un pour la
  // carte, un pour Street View — pendant que quatre autres chemins écrivaient sans passer par eux.
  // Deux mécaniques pour un même rôle, et une couverture d'un chemin sur trois.
  //
  // L'ordonnancement vit désormais dans « presentContent » elle-même : ce qu'on appelle ici finit dans
  // la file unique, avec son regroupement par genre, son écriture unique en vol et son rythme
  // minimum. Il ne reste de cette fonction qu'un adaptateur, pour ne pas réécrire ses appelants.
  //
  // Ce qu'elle garantissait — lire l'état le plus frais — reste vrai autrement : la file conserve la
  // DERNIÈRE demande de ce genre, donc l'état du dernier mouvement.
  function persistOrd(){
    return { signaler: function(){ try{ if(map&&persist)persist(state()); }catch(e){} } }; }
  function broadcast(){ if(!map)return; var n=Date.now(); if(n-_bcT<200)return; _bcT=n;
    var o=persistOrd(); if(o)o.signaler();
    try{ if(window.Live) Live.sendMap(); }catch(e){} }
  function schedPersist(){ var o=persistOrd(); if(o)o.signaler(); else { clearTimeout(_psT); _psT=setTimeout(function(){ if(map&&persist)persist(state()); },700); } }
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
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q='+encodeURIComponent(text),{headers:{Accept:'application/json'}}).then(function(r){return r.json();}).then(function(l){ if(!l||!l.length){res.innerHTML='<div style="padding:9px 14px;color:#888;font-size:12px">Aucun résultat.</div>';return;} res.innerHTML=l.map(function(o){var la=Number(o.lat),lo=Number(o.lon);if(!isFinite(la)||!isFinite(lo)||la<-90||la>90||lo<-180||lo>180)return '';return '<button data-lat="'+la+'" data-lng="'+lo+'">'+String(o.display_name||'').replace(/</g,'&lt;')+'</button>';}).join(''); }).catch(function(){res.innerHTML='<div style="padding:9px 14px;color:#c0392b;font-size:12px">Recherche indisponible.</div>';}); }
  // ── Street View (Google) ─────────────────────────────────────────────────────────────────────────
  function tempHint(t){ var h=document.getElementById('mapHint'); if(h){h.textContent=t; setTimeout(function(){ if(h.textContent===t)h.textContent=(isPres?'':'Vue du présentateur — en direct'); },2600);} }
  // Le présentateur passe en Street View depuis le centre de la carte : on cherche le panorama le plus proche.
  function goSV(center){ if(!GMAPS_KEY){tempHint('Street View indisponible.');return;} tempHint('Recherche Street View…');
    loadGoogle(function(){ try{ new google.maps.StreetViewService().getPanorama({location:{lat:center[0],lng:center[1]},radius:80},function(data,status){ if(status==='OK'&&data&&data.location){ var ll=data.location.latLng; var content={kind:'streetview',position:[ll.lat(),ll.lng()],pov:{heading:0,pitch:0},zoom:1}; if(persist)persist(content); enterSV(content,true,persist); } else { tempHint('Pas de Street View à cet endroit.'); } }); }catch(e){ tempHint('Street View indisponible.'); } }); }
  function svState(){ if(!pano)return null; var p=pano.getPosition(),v=pano.getPov(); if(!p)return null; return {kind:'streetview',position:[p.lat(),p.lng()],pov:{heading:v.heading,pitch:v.pitch},zoom:pano.getZoom()}; }
  // Même règle qu'au-dessus : on persiste, on signale, on ne transporte pas la position.
  // Même chose pour Street View : la file s'en charge, il ne reste qu'un adaptateur.
  function svOrd(){
    return { signaler: function(){ try{ if(persist&&pano)persist(svState()); }catch(e){} } }; }
  function svBcast(){ var n=Date.now(); if(n-_svBcT<200)return; _svBcT=n; if(!svState())return;
    var o=svOrd(); if(o)o.signaler();
    try{ if(window.Live)Live.sendMap(); }catch(e){} }
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

module.exports = { MAP_CSS, MAP_MARKUP, MAP_JS };
