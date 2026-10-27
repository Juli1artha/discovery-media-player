// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// L'HÔTE DÉMARRE, L'IFRAME CONDUIT — ET L'HÔTE APPREND CE QUE L'IFRAME DÉCIDE.
//
// Demandé par un hôte (26/10) qui mène ses rendez-vous clients en présentation : environ 200 par mois,
// lancés pendant un appel. Son application vit sur `app.`, le player sur `doc.` :
//
//   • la page du présentateur ne pouvait reprendre que par la session du membre, lue dans le
//     localStorage de SA propre origine — vide chez cet hôte. Le jeton rendu par `present-start`,
//     appelé côté serveur, n'avait aucun chemin pour entrer dans l'iframe ;
//   • démarrée depuis le bouton du player, la présentation naissait sans que l'hôte en apprenne le
//     slug : seuls « Inviter » et « Passer la main » le transmettaient.
//
// ⚠️ CE FICHIER EXÉCUTE LA PAGE. L'adoption a un piège qu'aucune lecture du gabarit ne montre : le
// compteur d'écriture. Une iframe qui adopte un jeton RÉUTILISÉ (rechargement, changement de
// document) arrive sous un `write_seq` déjà avancé ; repartie de 1, chacune de ses pages est refusée
// comme périmée, et `setPage` répond ok — l'audience ne suit plus, rien ne le dit. Le seul moyen de
// le voir est de faire tourner une page après l'adoption et de lire le rang qu'elle porte.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraiesPresentations = require("../presentations.js");
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraiesPresentations, getPresentation: async () => null, listMessages: async () => [] },
};
const player = require("../handler.js");

const SLUG = "Ab3-_xYz9012";
const JETON = "Q1w2E3r4T5y6U7i8O9p0-_aZ";

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
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: ["https://app.exemple.fr"] },
  };
}

/**
 * La page du présentateur, ENCADRÉE (`embed=1`) — le mode de l'hôte qui a demandé. Une IMAGE plutôt
 * qu'un PDF : sans pdf.js (absent du banc), seule une image démarre la visionneuse et câble les
 * boutons de rotation, qui sont le moyen d'obtenir une écriture de pilotage sans faire défiler.
 */
async function htmlPresentateur() {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({
    method: "GET", headers: {}, socket: {},
    query: { preview: "1", embed: "1", url: "https://exemple.supabase.co/storage/v1/object/public/resources/r0.png", name: "r0.png", title: "R0", docId: "doc1", by: "BD" },
  }, res);
  return res.body;
}

function scriptsDe(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("script")].map((s) => s.textContent || "");
}

// Mêmes précautions que `finDePresentation` : chaque banc rejoue la page dans la MÊME fenêtre, donc
// les minuteries et écouteurs du banc précédent sont coupés avant d'en ouvrir un nouveau. Sans ça,
// l'écouteur « message » d'un banc précédent adopterait aussi, et répondrait deux fois.
const minuterieDOrigine = globalThis.setTimeout.bind(globalThis);
const attendre = (ms = 0) => new Promise((r) => minuterieDOrigine(r, ms));
const minuteriesOuvertes = [];
const vraiSetInterval = window.setInterval.bind(window);
const vraiSetTimeout = window.setTimeout.bind(window);
window.setInterval = (f, ms, ...r) => { const id = vraiSetInterval(f, ms, ...r); minuteriesOuvertes.push(id); return id; };
window.setTimeout = (f, ms, ...r) => { const id = vraiSetTimeout(f, ms, ...r); minuteriesOuvertes.push(id); return id; };
const ecouteursPoses = [];
const vraiAjouterEcouteur = window.addEventListener.bind(window);
window.addEventListener = (type, fn, opts) => { ecouteursPoses.push({ type, fn, opts }); return vraiAjouterEcouteur(type, fn, opts); };
function nettoyerLeBancPrecedent() {
  for (const id of minuteriesOuvertes.splice(0)) {
    try { window.clearInterval(id); } catch { /* déjà partie */ }
    try { window.clearTimeout(id); } catch { /* déjà partie */ }
  }
  for (const e of ecouteursPoses.splice(0)) {
    try { window.removeEventListener(e.type, e.fn, e.opts); } catch { /* déjà parti */ }
  }
}

/**
 * Monte la page sous un HÔTE : une vraie fenêtre (celle d'un cadre jsdom) posée comme `parent`.
 * `reponses` décide ce que le serveur rend à chaque action ; chaque appel est consigné.
 */
async function banc(reponses = {}) {
  nettoyerLeBancPrecedent();
  const html = await htmlPresentateur();
  document.documentElement.innerHTML = html;
  window.localStorage.clear();

  const cadre = document.createElement("iframe");
  document.body.appendChild(cadre);
  const hote = cadre.contentWindow;
  const recus = [];
  hote.postMessage = (data) => { recus.push(data); };
  Object.defineProperty(window, "parent", { configurable: true, get: () => hote });

  const appels = [];
  window.fetch = (url, init) => {
    const corps = (() => { try { return JSON.parse(String((init && init.body) || "{}")); } catch { return {}; } })();
    appels.push({ url: String(url), action: corps.action, corps });
    if (String(url).includes("state=1")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { active: false } }) });
    }
    const r = reponses[corps.action];
    if (typeof r === "function") return r(corps);
    if (r) return Promise.resolve({ ok: r.statut === 200, status: r.statut, json: async () => r.corps });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  };
  window.supabase = { createClient: () => ({ channel: () => { const c = { on: () => c, subscribe: () => c, send: () => {}, track: () => {}, untrack: () => {}, unsubscribe: () => {} }; return c; } }) };
  // La rotation reconstruit la vue après avoir écrit ; jsdom n'a pas d'IntersectionObserver, et
  // l'exception partirait après l'essai, sur le compte du suivant.
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

  for (const code of scriptsDe(html)) {
    try { window.eval(code + "\n;try{globalThis.Player=Player;}catch(e){}"); } catch { /* pas d'image à décoder, et on n'en a pas besoin */ }
  }

  const connexions = [];
  window.Live = {
    connect: (slug, me, control) => connexions.push({ slug, control }), disconnect: () => connexions.push("disconnect"),
    sendState: () => {}, sendMap: () => {}, onState: () => {}, onMap: () => {}, detectMember: () => {},
  };
  await attendre();
  return {
    appels, recus, connexions,
    confier: async (data) => {
      window.dispatchEvent(new window.MessageEvent("message", { data, source: hote }));
      await attendre(); await attendre();
    },
    annonces: (type) => recus.filter((m) => m && m.type === "3dd-doc-" + type),
    bandeau: () => document.getElementById("pbar"),
  };
}

const ATTACHE = { type: "3dd-doc-present-attach", slug: SLUG, control: JETON };
const ADOPTE = { "present-adopt": { statut: 200, corps: { ok: true, page: 1, rotation: 0, seq: 41 } } };

afterAll(() => { nettoyerLeBancPrecedent(); delete window.parent; });

describe("l'hôte confie une présentation à l'iframe", () => {
  it("l'iframe adopte sans session : bandeau, canal temps réel, battement — et le dit", async () => {
    const b = await banc(ADOPTE);
    await b.confier(ATTACHE);

    const adoption = b.appels.find((a) => a.action === "present-adopt");
    expect(adoption, "le jeton doit être éprouvé par le serveur avant d'afficher quoi que ce soit").toBeTruthy();
    expect(adoption.corps).toEqual({ action: "present-adopt", slug: SLUG, control: JETON });
    expect(b.appels.some((a) => a.action === "present-reclaim"), "la reprise exige une session que cette page n'a pas")
      .toBe(false);
    expect(b.bandeau().style.display, "le bandeau du présentateur est affiché").toBe("flex");
    expect(b.connexions).toContainEqual({ slug: SLUG, control: JETON });
    expect(b.annonces("present-attached"), "sans réponse, l'hôte ne distingue pas « je pilote » de « j'ai refusé »")
      .toEqual([{ type: "3dd-doc-present-attached", slug: SLUG }]);
  });

  // ⚠️ LE CAS QUI JUSTIFIE L'APPEL AU SERVEUR. Avec `_seq=0`, la page suivante porterait le rang 1
  // sous un write_seq de 41 : refusée comme périmée, en silence.
  it("la première page tournée après l'adoption porte un rang AU-DESSUS de celui de la base", async () => {
    const b = await banc(ADOPTE);
    await b.confier(ATTACHE);
    document.getElementById("rotR").click();
    for (let i = 0; i < 20 && !b.appels.some((a) => a.action === "present-page"); i++) await attendre(50);

    const page = b.appels.find((a) => a.action === "present-page");
    expect(page, "sans écriture observée, l'essai ne prouverait rien").toBeTruthy();
    expect(page.corps.control).toBe(JETON);
    expect(page.corps.seq, "repartir de 1 sous 41 : chaque page refusée, l'audience figée").toBeGreaterThan(41);
  });

  it.each([
    [403, "denied", "jeton faux, ou présentation terminée — l'hôte propriétaire peut reprendre"],
    [409, "denied", "jeton remplacé par une reprise ailleurs"],
    [404, "not-found", "slug inconnu"],
    [500, "unreachable", "état inconnu : réessayer ne coûte rien"],
  ])("un refus %i est dit à l'hôte (%s) et rien n'est piloté", async (statut, motif, _pourquoi) => {
    const b = await banc({ "present-adopt": { statut, corps: { ok: false, status: statut } } });
    await b.confier(ATTACHE);
    expect(b.annonces("present-attach-failed")).toEqual([{ type: "3dd-doc-present-attach-failed", slug: SLUG, reason: motif }]);
    expect(b.annonces("present-attached")).toEqual([]);
    expect(b.bandeau().style.display, "un refus n'affiche pas de bandeau qui piloterait dans le vide").not.toBe("flex");
  });

  it("un réseau absent est « injoignable », pas un refus", async () => {
    const b = await banc({ "present-adopt": () => Promise.reject(new Error("réseau")) });
    await b.confier(ATTACHE);
    expect(b.annonces("present-attach-failed")).toEqual([{ type: "3dd-doc-present-attach-failed", slug: SLUG, reason: "unreachable" }]);
  });

  it("une seconde présentation pendant qu'on en pilote une est refusée — pas substituée", async () => {
    const b = await banc(ADOPTE);
    await b.confier(ATTACHE);
    await b.confier({ type: "3dd-doc-present-attach", slug: "Autre-Slug-12", control: JETON });
    expect(b.annonces("present-attach-failed")).toEqual([{ type: "3dd-doc-present-attach-failed", slug: "Autre-Slug-12", reason: "busy" }]);
    expect(b.appels.filter((a) => a.action === "present-adopt"), "la seconde n'atteint pas le serveur").toHaveLength(1);
  });

  it("le même jeton reconfié est confirmé sans rien refaire", async () => {
    const b = await banc(ADOPTE);
    await b.confier(ATTACHE);
    await b.confier(ATTACHE);
    expect(b.annonces("present-attached")).toHaveLength(2);
    expect(b.appels.filter((a) => a.action === "present-adopt")).toHaveLength(1);
  });

  // L'hôte a repris côté serveur (`present-reclaim`) : jeton neuf pour la même présentation. Le canal
  // temps réel porte l'ancien — il doit se rouvrir avec le nouveau, et le rang repartir de la base.
  it("un jeton NEUF pour la même présentation remplace l'ancien", async () => {
    const NEUF = "Z9y8X7w6V5u4T3s2R1q0-_Ab";
    const b = await banc({ "present-adopt": (c) => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, page: 1, rotation: 0, seq: c.control === NEUF ? 0 : 41 }) }) });
    await b.confier(ATTACHE);
    await b.confier({ type: "3dd-doc-present-attach", slug: SLUG, control: NEUF });
    expect(b.connexions.slice(-2)).toEqual(["disconnect", { slug: SLUG, control: NEUF }]);
    document.getElementById("rotR").click();
    for (let i = 0; i < 20 && !b.appels.some((a) => a.action === "present-page"); i++) await attendre(50);
    const page = b.appels.find((a) => a.action === "present-page");
    expect(page.corps.control).toBe(NEUF);
    expect(page.corps.seq, "le rang de la reprise est zéro : on repart de 1, pas de 42").toBe(1);
  });

  it("un attachement malformé n'est pas un attachement — rien ne part au serveur", async () => {
    const b = await banc(ADOPTE);
    await b.confier({ type: "3dd-doc-present-attach", slug: SLUG });
    await b.confier({ type: "3dd-doc-present-attach", slug: SLUG, control: "court" });
    expect(b.appels.some((a) => a.action === "present-adopt")).toBe(false);
  });

  it("un cadre qui n'est pas le parent ne confie rien", async () => {
    const b = await banc(ADOPTE);
    const autre = document.createElement("iframe");
    document.body.appendChild(autre);
    window.dispatchEvent(new window.MessageEvent("message", { data: ATTACHE, source: autre.contentWindow }));
    await attendre(); await attendre();
    expect(b.appels.some((a) => a.action === "present-adopt")).toBe(false);
  });
});

describe("l'hôte apprend ce que l'iframe décide", () => {
  const DEMARRE = { "present-start": { statut: 200, corps: { ok: true, slug: SLUG, control: JETON } } };

  it("démarrée par le bouton « Présenter », la présentation est annoncée avec son slug", async () => {
    const b = await banc(DEMARRE);
    document.getElementById("presentBtn").click();
    await attendre(); await attendre();
    expect(b.annonces("present-started")).toEqual([{ type: "3dd-doc-present-started", slug: SLUG }]);
    expect(JSON.stringify(b.recus), "le jeton de contrôle ne remonte jamais à l'hôte").not.toContain(JETON);
  });

  it("terminée par « Terminer », la fin est annoncée une fois CONFIRMÉE", async () => {
    const b = await banc(DEMARRE);
    document.getElementById("presentBtn").click();
    await attendre(); await attendre();
    document.getElementById("pbarEnd").click();
    for (let i = 0; i < 10 && !b.annonces("present-ended").length; i++) await attendre(10);
    expect(b.annonces("present-ended")).toEqual([{ type: "3dd-doc-present-ended", slug: SLUG }]);
  });

  it("une fin que le serveur refuse n'est pas annoncée", async () => {
    const b = await banc({ ...DEMARRE, "present-end": { statut: 500, corps: { ok: false } } });
    document.getElementById("presentBtn").click();
    await attendre(); await attendre();
    document.getElementById("pbarEnd").click();
    await attendre(50);
    expect(b.annonces("present-ended"), "l'hôte qui clôt son rendez-vous sur ce message clôturerait une présentation vivante")
      .toEqual([]);
  });
});
