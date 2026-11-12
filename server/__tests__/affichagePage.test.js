// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE MODE D'AFFICHAGE PART AVEC LA SESSION (#617) — la vraie page d'aperçu, suivi INTERNE (un membre, `uemail` +
// `docId`), dont le traceur envoie son résumé par `fetch` (jsdom n'a pas `sendBeacon`).
//
// Dimensions VARIÉES : le gabarit (lecture, ancien), les gestes (clavier, flèches, ajustement). Dimensions TENUES
// FIXES : un document portrait de 21 pages, le chemin interne ; la forme exacte est bornée côté serveur
// (affichageSession.test.js).

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

async function htmlApercu(extra) {
  player.init(contexteMinimal());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: "https://exemple.supabase.co/storage/v1/object/public/resources/doc.pdf", name: "doc.pdf", ...extra } }, res);
  return res.body;
}

const PAYSAGE = { width: 1100, height: 778 };   // A4 couché, proportion 0,707
const LARGEUR_CADRE = 900, HAUTEUR_CADRE = 500;

function fauxPdfjs(vp, total) {
  const page = { rotate: 0, getViewport: () => ({ ...vp, scale: 1 }), render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: () => Promise.resolve({ items: [] }) };
  const pdf = { numPages: total, destroy() {}, getPage: () => Promise.resolve(page) };
  return { GlobalWorkerOptions: {}, getDocument() { return { promise: Promise.resolve(pdf), destroy() {} }; } };
}

const EXPORTER = ";try{if(typeof Player!=='undefined')window.Player=Player;}catch(e){}";
let demandees;

// ⚠️ LES ÉCOUTEURS POSÉS SUR `document` SURVIVENT AU REMPLACEMENT DU HTML. Sans ce nettoyage, la page
// montée par l'essai précédent répondait encore au clavier, avec SON ajustement et SON cadre : un essai
// en largeur voyait la touche prise par un fantôme en page entière. On relève chaque écouteur posé par
// la page et on le retire avant de monter la suivante.
const posesSurDocument = [];
const ajouterOrigine = document.addEventListener.bind(document);
document.addEventListener = (type, fn, opts) => { posesSurDocument.push([type, fn, opts]); return ajouterOrigine(type, fn, opts); };
// ⚠️ ET LEURS MINUTEURS AUSSI. Une page montée en lecture arme l'effacement à 3 s ; montée avec de vrais
// minuteurs, elle le laissait courir après l'essai. Sous couverture (CI, 11/11), l'essai suivant durait
// assez pour que ce minuteur fantôme efface la pastille d'une page en ANCIEN gabarit, qui n'en a pas :
// « l'ancien gabarit ne s'efface jamais » échouait en CI et passait ici. Reproduit en ralentissant
// l'essai de 3,2 s ; seul, il passait — la page n'y était pour rien.
const minuteursDesPages = new Set();
const armerOrigine = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms, ...args) { const id = armerOrigine(fn, ms, ...args); minuteursDesPages.add(id); return id; };
function retirerLesFantomes() {
  for (const [type, fn, opts] of posesSurDocument.splice(0)) document.removeEventListener(type, fn, opts);
  for (const id of minuteursDesPages) clearTimeout(id);
  minuteursDesPages.clear();
}

async function monter({ query = {}, vp = PAYSAGE, total = 21, encadre = true, importLent = false, surPret = null } = {}) {
  retirerLesFantomes();
  const html = await htmlApercu(query);
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  // La balise <body> elle-même est retirée par le remplacement ci-dessus : on reporte sa classe, qui porte le gabarit.
  const balise = /<body([^>]*)>/i.exec(html);
  const classe = balise && /class=("?)([^\s">]+)\1/.exec(balise[1]);
  document.body.className = classe ? classe[2] : "";
  const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")].map((s) => s.textContent || "").filter((c) => c.trim());
  window.pdfjsLib = fauxPdfjs(vp, total);
  window.PlayerBot = { init(v) { window.__V = v; } };
  window.HTMLCanvasElement.prototype.getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
  window.IntersectionObserver = function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; };
  // La doublure qui relève la page visée : jsdom ne fait pas défiler.
  demandees = [];
  window.HTMLElement.prototype.scrollIntoView = function () { if (this.dataset && this.dataset.p) demandees.push(+this.dataset.p); };
  const scroll = document.getElementById("scroll");
  Object.defineProperty(scroll, "clientHeight", { value: HAUTEUR_CADRE, configurable: true });
  Object.defineProperty(scroll, "clientWidth", { value: LARGEUR_CADRE, configurable: true });
  Object.defineProperty(scroll, "scrollWidth", { value: LARGEUR_CADRE, configurable: true });
  let st = 0;
  Object.defineProperty(scroll, "scrollTop", { get: () => st, set: (v) => { st = Math.max(0, Number(v) || 0); }, configurable: true });
  // L'HÔTE : une vraie fenêtre (celle d'une iframe vide), posée comme parent de la page AVANT que ses
  // scripts ne tournent — `onHostMessage` lit `window.parent` à l'inscription. Ce que le player lui envoie
  // est relevé dans `recus`.
  recus = [];
  if (encadre) {
    const cadre = document.createElement("iframe");
    document.body.appendChild(cadre);
    hote = cadre.contentWindow;
    hote.addEventListener("message", (e) => { recus.push(e.data); if (surPret && e.data && e.data.type === "3dd-doc-embed-ready") surPret(); });
    Object.defineProperty(window, "parent", { get: () => hote, configurable: true });
  } else {
    hote = null;
    Object.defineProperty(window, "parent", { get: () => window, configurable: true });
  }
  const CROCHET = "import(CFG.pdfjs)";
  let substitutions = 0;
  for (const code of blocs) {
    const n = code.split(CROCHET).length - 1;
    substitutions += n;
    // `importLent` : pdf.js arrive APRÈS l'annonce, comme dans un vrai navigateur où le module se télécharge.
    const charge = importLent ? "new Promise(function(r){ setTimeout(function(){ r(window.pdfjsLib); }, 80); })" : "Promise.resolve(window.pdfjsLib)";
    window.eval((n ? code.split(CROCHET).join(charge) : code) + EXPORTER);
  }
  expect(substitutions, "le crochet de chargement de pdf.js doit exister, sinon la page ne démarre jamais ici").toBe(1);
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  if (importLent) await new Promise((r) => setTimeout(r, 150));
  expect(window.__n, "le document est chargé").toBe(total);
  return window.__V;
}





// Ce que le banc emprunté relève de l'hôte (messages reçus, fenêtre parente).
let recus = [];
let hote = null;
let envois = [];
async function monterAvecSuivi(query) {
  envois = [];
  window.fetch = (url, opts) => { try { envois.push(JSON.parse(String(opts && opts.body))); } catch { /* pas du JSON */ } return Promise.resolve({ ok: true, json: async () => ({}) }); };
  try { delete window.navigator.sendBeacon; } catch { /* absent */ }
  await monter({ query: { uemail: "membre@exemple.fr", docId: "doc-1", ...query }, vp: { width: 595, height: 842 } });
}
const derniereSession = () => [...envois].reverse().find((m) => m && m.event === "session");
const envoyerLeResume = async () => { window.dispatchEvent(new window.Event("beforeunload")); await new Promise((r) => setTimeout(r, 0)); };

describe("#617 — la session dit son mode d'affichage", () => {
  it("gabarit « lecture » : gabarit, ajustement, format, mode une page, et les gestes comptés", async () => {
    await monterAvecSuivi({ gabarit: "lecture" });
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    document.getElementById("pillNext").click();
    document.getElementById("fitBtn").click();
    await envoyerLeResume();
    const s = derniereSession();
    expect(s, "un résumé de session est parti").toBeTruthy();
    expect(s.internal).toBe(true);
    expect(s.modeAffichage).toMatchObject({ gabarit: "lecture", format: "portrait", une_page: false });
    expect(["page", "largeur"]).toContain(s.modeAffichage.ajustement);
    expect(s.modeAffichage.gestes).toMatchObject({ clavier: 1, fleches: 1, ajustement: 1, recherche: 0, sommaire: 0 });
  });
  it("ancienne barre : « ancien »", async () => {
    await monterAvecSuivi({});
    await envoyerLeResume();
    expect(derniereSession().modeAffichage).toMatchObject({ gabarit: "ancien" });
  });
  it("rien de ce qu'on a cherché ne part : seulement des énumérations et des compteurs", async () => {
    await monterAvecSuivi({ gabarit: "lecture" });
    await envoyerLeResume();
    const a = derniereSession().modeAffichage;
    for (const v of Object.values(a)) expect(["string", "boolean", "object"]).toContain(typeof v);
    for (const v of Object.values(a.gestes)) expect(Number.isInteger(v)).toBe(true);
    expect(Object.keys(a).sort()).toEqual(["ajustement", "format", "gabarit", "gestes", "une_page"]);
  });
});
