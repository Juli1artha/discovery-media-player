// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// ON ANNONÇAIT LA FIN AVANT DE L'OBTENIR.
//
// `endPresent` partait en « sendBeacon » — qui ne rend AUCUNE réponse, ni « enregistré » ni
// « refusé » — puis nettoyait l'interface, effaçait le jeton de contrôle et coupait le canal. Si
// l'appel échouait, la présentation restait VIVANTE pour l'audience pendant que le présentateur la
// croyait close ; et « clearCtl » ayant déjà jeté son jeton, il n'avait même plus de quoi la
// refermer. Il ne lui restait que la péremption : trois minutes d'audience en aveugle.
//
// ⚠️ Le beacon n'achetait rien ici. Il sert à faire partir une requête pendant que la page MEURT ;
// or le seul appelant était un BOUTON. On avait payé le prix d'une contrainte qu'on ne subissait
// pas. Il est désormais sur « pagehide », et là seulement.
//
// Signalé par un audit externe (P0-1).
//
// ⚠️ CE FICHIER EXÉCUTE LA PAGE, ET C'EST LE POINT. Les tests de ce défaut auraient pu s'écrire en
// comparant des POSITIONS dans le texte du gabarit — c'est ce que fait « ecrirePuisSignaler ». Mais
// une sonde textuelle ne sait pas distinguer « on diffuse après la réponse » de « on diffuse dans la
// branche d'ÉCHEC » : les deux ont le signal après l'appel. Il faut faire échouer l'appel pour voir
// la différence. C'est le chantier que les deux audits réclamaient — un vrai bout-en-bout — sur le
// morceau où il manquait le plus.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraiesPresentations = require("../presentations.js");
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraiesPresentations, getPresentation: async () => null, listMessages: async () => [] },
};
const player = require("../handler.js");

function contexteMinimal() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

/** La page du PRÉSENTATEUR : l'aperçu interne, celui qui porte le bandeau et le bouton « Terminer ». */
async function htmlPresentateur() {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({
    method: "GET", headers: {}, socket: {},
    query: { preview: "1", url: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf", name: "d.pdf", title: "D", docId: "doc1", by: "Moi" },
  }, res);
  return res.body;
}

/** Une promesse qu'on dénoue à la main : c'est elle qui rend l'ORDRE observable. */
function differee() {
  let tenir, rompre;
  const p = new Promise((ok, ko) => { tenir = ok; rompre = ko; });
  return { promesse: p, tenir, rompre };
}

/**
 * Les scripts en ligne d'une page, lus par le PARSEUR DU NAVIGATEUR.
 *
 * ⚠️ C'était une expression régulière, et trois corrections successives n'ont pas suffi : elle
 * ratait « <SCRIPT> », puis « </script > », puis « </script\t\n bar> ». Chaque rustine appelait la
 * suivante, parce qu'on ne rattrape pas la grammaire du HTML à la main — c'est exactement le
 * reproche que l'analyse statique nous faisait, et elle avait raison de le répéter.
 *
 * Le banc tourne dans jsdom : le parseur du navigateur est là, il voit par construction ce que le
 * navigateur voit. Une garde qui lit la page autrement que le navigateur ne garde pas la page.
 */
function scriptsDe(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("script")].map((s) => s.textContent || "");
}

/** Laisse les chaînes de promesses se dérouler. */
// ⚠️ Passe par la minuterie D'ORIGINE, capturée avant l'enveloppe ci-dessous. En jsdom
// « globalThis » EST la fenêtre : s'en remettre à lui reviendrait à utiliser l'enveloppe, et le
// nettoyage du banc suivant pourrait couper l'attente du test en cours, qui ne se réglerait jamais.
const minuterieDOrigine = globalThis.setTimeout.bind(globalThis);
const respirer = () => new Promise((r) => minuterieDOrigine(r, 0));

// ⚠️ UN BANC QUI PARTAGE SA FENÊTRE PARTAGE SES MINUTERIES.
//
// Chaque banc ré-évalue les scripts de la page dans la MÊME fenêtre jsdom : les intervalles du banc
// précédent — battement de cœur, filet de resynchronisation à 25 s — continuent de tourner et
// appellent « Live.sendState() » sur le « window.Live » COURANT, c'est-à-dire l'espion du test en
// cours. Un « sendState » parasite apparaissait alors dans le cas d'échec, où il ne doit rien y
// avoir : le test échouait sur Node 24 et passait sur Node 22, à la milliseconde près.
//
// ⚠️ C'est la même cause que les beacons empilés, traitée cette fois à la racine plutôt que
// contournée : on coupe les minuteries des bancs précédents avant d'en ouvrir un nouveau. Un test
// dont le verdict dépend de la vitesse de la machine ne dit rien.
const minuteriesOuvertes = [];
function couperLesMinuteriesPrecedentes() {
  for (const id of minuteriesOuvertes.splice(0)) {
    try { window.clearInterval(id); } catch { /* déjà partie */ }
    try { window.clearTimeout(id); } catch { /* déjà partie */ }
  }
}
// ⚠️ LES DEUX, ET C'EST « setTimeout » QUI COMPTAIT. L'indice était dans l'échec lui-même : le
// tableau contenait « sendState » SANS « disconnect », alors que « endPresent » appelle toujours les
// deux à la suite. Ce n'était donc pas une fin de présentation, mais « diffuserEtat() » — déclenché
// par l'ordonnanceur d'écriture, qui DIFFÈRE de 500 ms. Les tests durent une dizaine de
// millisecondes : l'écriture d'un banc retombait plusieurs tests plus loin.
const vraiSetInterval = window.setInterval.bind(window);
const vraiSetTimeout = window.setTimeout.bind(window);
window.setInterval = (f, ms, ...r) => { const id = vraiSetInterval(f, ms, ...r); minuteriesOuvertes.push(id); return id; };
window.setTimeout = (f, ms, ...r) => { const id = vraiSetTimeout(f, ms, ...r); minuteriesOuvertes.push(id); return id; };

let bancsCrees = 0;
async function banc() {
  bancsCrees++;
  couperLesMinuteriesPrecedentes();
  const html = await htmlPresentateur();
  // ⚠️ ON NE RETIRE PAS LES BALISES DE SCRIPT, ET C'EST PLUS SÛR QUE DE LES RETIRER. Un script
  // posé par « innerHTML » ne s'exécute jamais — la spec HTML l'interdit — donc le filtrage
  // n'apportait rien. Il avait en revanche la FORME d'un assainissement maison, que l'analyse
  // statique signale à juste titre : un filtre par expression régulière sur du HTML rate ce
  // qu'il ne prévoit pas (ici les majuscules). La bonne réponse à « votre filtre est incomplet »
  // est souvent « ce filtre n'a pas lieu d'être », pas « rendons-le plus malin ».
  document.documentElement.innerHTML = html;
  window.localStorage.clear();

  const appels = [];
  let enAttente = null;                       // la requête « present-end » qu'on tient en suspens
  const relu = { active: false };             // ce que la RELECTURE d'état rendra (banc : fermée par défaut)
  window.fetch = (url, init) => {
    const corps = (() => { try { return JSON.parse(String((init && init.body) || "{}")); } catch { return {}; } })();
    appels.push({ url: String(url), action: corps.action, corps, init: init || {} });
    if (String(url).includes("state=1")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { active: relu.active } }) });
    }
    if (corps.action === "present-start") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, slug: "S1", control: "C1" }) });
    }
    if (corps.action === "present-end") {
      enAttente = differee();
      return enAttente.promesse;
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  };
  // Le canal temps réel : on n'en veut que les APPELS.
  window.supabase = { createClient: () => ({ channel: () => { const c = { on: () => c, subscribe: () => c, send: () => {}, track: () => {}, untrack: () => {}, unsubscribe: () => {} }; return c; } }) };

  // ⚠️ Le paquet est en « use strict » : un eval strict garde ses déclarations pour lui. On le
  // réexpose — artefact du banc, pas du produit : dans un navigateur c'est une balise script, et
  // « var Player » y est bien global.
  for (const code of scriptsDe(html)) {
    try { window.eval(code + "\n;try{globalThis.Player=Player;}catch(e){}"); } catch { /* pdf.js n'est pas là, et on n'en a pas besoin */ }
  }

  // On démarre une vraie présentation, par le bouton.
  document.getElementById("presentBtn").click();
  await respirer();

  // Puis on substitue la couche live, pour observer ce qui lui est demandé et QUAND.
  const vus = [];
  window.Live = {
    connect: () => vus.push("connect"), disconnect: () => vus.push("disconnect"),
    sendState: () => vus.push("sendState"), sendMap: () => vus.push("sendMap"),
    onState: () => {}, onMap: () => {}, detectMember: () => {},
  };
  return {
    appels, vus, relu,
    finir: () => { document.getElementById("pbarEnd").click(); return respirer(); },
    reponse: () => enAttente,
    bandeau: () => document.getElementById("pbar"),
    bouton: () => document.getElementById("pbarEnd"),
    jetonStocke: () => Object.keys(window.localStorage).some((k) => window.localStorage.getItem(k) === "C1"),
  };
}

// ⚠️ CE BLOC DOIT RESTER LE PREMIER, ET LE TEST LE DIT LUI-MÊME.
//
// Chaque banc ré-évalue les scripts de la page dans la MÊME fenêtre jsdom, donc empile un écouteur
// « pagehide » de plus. Après sept bancs, un départ de page produit sept envois : le compte devient
// illisible, et un test qui ne peut plus compter ne peut plus dire non. Plutôt que d'assouplir
// l'assertion — « au moins un », qui passerait aussi avec zéro écouteur des bancs précédents et un
// bug ici — on garde le compte exact et on vérifie l'hypothèse qui le rend exact.
describe("le beacon est à sa place, sur le départ de la page", () => {
  it("fermer l'onglet en pleine présentation envoie l'avis de fin", async () => {
    const b = await banc();
    expect(bancsCrees, "ce bloc doit rester en tête du fichier : un second banc empilerait un écouteur")
      .toBe(1);

    const envoyes = [];
    navigator.sendBeacon = (url, blob) => { envoyes.push({ url, blob }); return true; };
    window.dispatchEvent(new window.Event("pagehide"));
    await respirer();

    expect(envoyes.length, "sinon l'audience suit une présentation morte jusqu'à la péremption")
      .toBe(1);
    expect(String(envoyes[0].url)).toContain("/api/doc");
    void b;
  });
});

describe("la présentation démarre bien avant qu'on la termine", () => {
  it("le bouton « Présenter » ouvre une présentation et range son jeton", async () => {
    const b = await banc();
    expect(b.appels.map((a) => a.action), "sans démarrage réussi, la suite ne prouverait rien")
      .toContain("present-start");
    expect(b.jetonStocke(), "le jeton de contrôle est conservé pour piloter").toBe(true);
    expect(b.bandeau().style.display, "le bandeau du présentateur est affiché").toBe("flex");
  });
});

describe("rien n'est annoncé tant que le serveur n'a pas confirmé", () => {
  it("pendant que l'appel est en vol, l'audience n'est pas prévenue", async () => {
    const b = await banc();
    await b.finir();

    expect(b.appels.some((a) => a.action === "present-end"), "l'avis de fin doit partir").toBe(true);
    // ⚠️ LE CŒUR DU TEST. On ne dénoue PAS la réponse : l'appel est en vol.
    expect(b.vus, "diffuser avant la confirmation fait relire une présentation encore active")
      .not.toContain("sendState");
    expect(b.vus, "couper le canal avant la confirmation, c'est ne jamais pouvoir dire que c'est fini")
      .not.toContain("disconnect");
  });

  it("l'avis part par une requête dont on peut LIRE la réponse, pas par un beacon", async () => {
    const b = await banc();
    await b.finir();
    const fin = b.appels.find((a) => a.action === "present-end");
    expect(fin, "l'appel existe").toBeTruthy();
    expect(fin.init.keepalive, "keepalive garde la requête en vie sans renoncer à la réponse").toBe(true);
    expect(fin.corps.control, "le jeton de contrôle autorise la clôture").toBe("C1");
  });

  it("une fois le 2xx reçu, l'audience est prévenue PUIS le canal coupé", async () => {
    const b = await banc();
    await b.finir();
    b.reponse().tenir({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await respirer();

    expect(b.vus, "l'audience doit relire l'état une fois la fin enregistrée").toContain("sendState");
    expect(b.vus.indexOf("disconnect"), "couper avant d'avoir signalé, c'est perdre l'avis")
      .toBeGreaterThan(b.vus.indexOf("sendState"));
    expect(b.bandeau().style.display, "et le bandeau disparaît").toBe("none");
    expect(b.jetonStocke(), "le jeton n'a plus lieu d'être").toBe(false);
  });
});

// ⚠️ LE CAS QU'UNE SONDE TEXTUELLE NE PEUT PAS VOIR. Le signal est bien APRÈS l'appel dans les deux
// versions ; seul un échec distingue « après la réponse » de « après le départ ».
describe("un échec ne fait pas croire à une fin", () => {
  it("l'audience n'est pas prévenue et le canal reste ouvert", async () => {
    const b = await banc();
    await b.finir();
    b.reponse().tenir({ ok: false, status: 500, json: async () => ({ ok: false }) });
    await respirer();

    expect(b.vus, "la présentation n'est pas terminée : rien à annoncer").not.toContain("sendState");
    expect(b.vus, "et le présentateur reste connecté à son audience").not.toContain("disconnect");
  });

  it("le présentateur garde de quoi réessayer — jeton, bandeau et bouton", async () => {
    const b = await banc();
    await b.finir();
    b.reponse().rompre(new Error("réseau"));
    await respirer();

    expect(b.jetonStocke(), "effacer le jeton sur un échec, c'est retirer le seul moyen de refermer")
      .toBe(true);
    expect(b.bandeau().style.display, "le bandeau reflète l'état réel : la présentation vit encore")
      .toBe("flex");
    expect(b.bouton().disabled, "le bouton doit redevenir cliquable").toBe(false);
    // ⚠️ VISIBLE, PAS UN TOOLTIP. La première version disait l'échec dans un `title` — que
    // personne ne survole. Le second hôte a eu des présentations « actives » trois jours sans
    // que quiconque le voie : l'échec d'une clôture ne prive de rien qu'on regarde, donc c'est
    // à l'interface de le mettre sous les yeux.
    const err = document.getElementById("pbarErr");
    expect(err, "l'élément d'erreur doit exister dans la barre").toBeTruthy();
    expect(err.textContent, "et dire ce qui s'est passé, plutôt que se taire").toMatch(/TOUJOURS ACTIVE/);
    expect(err.classList.contains("on"), "un message invisible ne dit rien").toBe(true);
  });

  // ⚠️ RELIRE, PAS RÉUTILISER — réserve du second hôte, et elle est juste : relire la réponse du
  // PATCH ferait ce que faisait le cache négatif, la mesure confirmerait ce que l'écriture croit
  // avoir fait. On exige donc un SECOND aller-retour, indépendant, après le ok du serveur.
  it("après le ok du serveur, une RELECTURE indépendante confirme la fin", async () => {
    const b = await banc();
    await b.finir();
    b.reponse().tenir({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await respirer();

    // Après l'écriture seulement : la page vivante fait aussi des lectures d'état pour son propre
    // suivi — c'est la relecture POST-clôture qu'on exige, pas l'absence de toute autre lecture.
    const idxFin = b.appels.findIndex((x) => x.action === "present-end");
    const relectures = b.appels.slice(idxFin + 1).filter((x) => x.url.includes("state=1"));
    expect(relectures.length, "le ok de l'écriture a été cru sur parole — aucun second aller-retour").toBeGreaterThanOrEqual(1);
    expect(b.bandeau().style.display, "état relu « fermée » : l'interface peut fermer").toBe("none");
  });

  it("le serveur dit ok mais la base dit ENCORE ACTIVE : l'interface ne ment pas", async () => {
    const b = await banc();
    b.relu.active = true;                     // la relecture contredira l'écriture
    await b.finir();
    b.reponse().tenir({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await respirer();

    expect(b.bandeau().style.display, "fermer l'interface convertirait un échec en confirmation visuelle").toBe("flex");
    const err = document.getElementById("pbarErr");
    expect(err.classList.contains("on")).toBe(true);
    expect(err.textContent).toMatch(/ENCORE ACTIVE/);
    expect(b.jetonStocke(), "le jeton doit survivre : c'est le seul moyen de refermer").toBe(true);
  });

  it("et un second clic retente vraiment", async () => {
    const b = await banc();
    await b.finir();
    b.reponse().rompre(new Error("réseau"));
    await respirer();
    await b.finir();
    expect(b.appels.filter((a) => a.action === "present-end").length,
      "sans PRES conservé, le second clic ne partirait nulle part").toBe(2);
  });
});
