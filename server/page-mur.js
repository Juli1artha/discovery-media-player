// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 2, 19/08/2026) — texte déplacé À L'IDENTIQUE. Reste à
// PLAT dans server/ (les gardes de forge ciblent server/*.js).
const { esc, jsonPourScript } = require("./texte");

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

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
  var SLUG=${jsonPourScript(share.slug || "")};
  var GCID=${jsonPourScript(gcid)};
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

module.exports = { init, notFoundHtml, softWallHtml };
