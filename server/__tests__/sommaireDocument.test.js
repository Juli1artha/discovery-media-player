// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE SOMMAIRE DU DOCUMENT (#612, L6b) — la vraie page d'aperçu, dans le gabarit « lecture ».
//
// Le banc fait tourner la page avec un pdf.js de doublure qui porte des SIGNETS de toutes les sortes : destination
// nommée (`getDestination`), référence de page (`getPageIndex`), numéro de page direct, et une destination qui ne se
// résout pas. Dimensions VARIÉES : signets présents / absents, gabarit, largeur d'écran, clavier. Dimensions TENUES
// FIXES : le chemin d'aperçu, et jsdom — la page visée est relevée par `scrollIntoView`.

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

const SIGNETS = [
  { title: "1. Généralités", dest: "gen", items: [
    { title: "1.1 Le terrain", dest: [{ num: 12, gen: 0 }, { name: "Fit" }] },
    { title: "1.2 Les réseaux", dest: [3, { name: "Fit" }] },
  ] },
  { title: "2. Chauffage", dest: "chauf" },
  { title: "Annexe introuvable", dest: "nulle-part" },
];
const NOMMEES = { gen: [{ num: 10, gen: 0 }, { name: "XYZ" }], chauf: [{ num: 14, gen: 0 }, { name: "Fit" }] };
const INDEX_DES_REFS = { 10: 0, 12: 1, 14: 4 };   // num de la référence → index de page (0 = page 1)
let lectures = 0;

function fauxPdfjs({ total = 6, signets = SIGNETS } = {}) {
  const page = { rotate: 0, getViewport: () => ({ width: 595, height: 842, scale: 1 }), render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: () => { lectures += 1; return Promise.resolve({ items: [] }); } };
  const pdf = {
    numPages: total, destroy() {}, getPage: () => Promise.resolve(page),
    getOutline: () => Promise.resolve(signets),
    getDestination: (nom) => Promise.resolve(NOMMEES[nom] || null),
    getPageIndex: (ref) => (ref && ref.num in INDEX_DES_REFS ? Promise.resolve(INDEX_DES_REFS[ref.num]) : Promise.reject(new Error("ref inconnue"))),
  };
  class TextLayer { constructor() { this.textDivs = []; } render() { return Promise.resolve(); } }
  return { GlobalWorkerOptions: {}, TextLayer, getDocument() { return { promise: Promise.resolve(pdf), destroy() {} }; } };
}

const EXPORTER = ";try{if(typeof Player!=='undefined')window.Player=Player;}catch(e){}";
const posesSurDocument = [];
const ajouterOrigine = document.addEventListener.bind(document);
document.addEventListener = (type, fn, opts) => { posesSurDocument.push([type, fn, opts]); return ajouterOrigine(type, fn, opts); };
const minuteursDesPages = new Set();
const armerOrigine = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms, ...args) { const id = armerOrigine(fn, ms, ...args); minuteursDesPages.add(id); return id; };
function retirerLesFantomes() {
  for (const [type, fn, opts] of posesSurDocument.splice(0)) document.removeEventListener(type, fn, opts);
  for (const id of minuteursDesPages) clearTimeout(id);
  minuteursDesPages.clear();
}

let demandees = [];
let recus = [];
async function monter({ query = { gabarit: "lecture" }, signets = SIGNETS, total = 6, largeur = 1200 } = {}) {
  retirerLesFantomes();
  lectures = 0;
  const html = await htmlApercu(query);
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const balise = /<body([^>]*)>/i.exec(html);
  const classe = balise && /class=("?)([^\s">]+)\1/.exec(balise[1]);
  document.body.className = classe ? classe[2] : "";
  const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")].map((s) => s.textContent || "").filter((c) => c.trim());
  window.pdfjsLib = fauxPdfjs({ total, signets });
  Object.defineProperty(window, "innerWidth", { value: largeur, configurable: true });
  window.HTMLCanvasElement.prototype.getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
  window.IntersectionObserver = function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; };
  demandees = [];
  window.HTMLElement.prototype.scrollIntoView = function () { if (this.dataset && this.dataset.p) demandees.push(+this.dataset.p); };
  const scroll = document.getElementById("scroll");
  Object.defineProperty(scroll, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(scroll, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(scroll, "scrollWidth", { value: 900, configurable: true });
  let st = 0;
  Object.defineProperty(scroll, "scrollTop", { get: () => st, set: (v) => { st = Math.max(0, Number(v) || 0); }, configurable: true });
  recus = [];
  const cadre = document.createElement("iframe");
  document.body.appendChild(cadre);
  const hote = cadre.contentWindow;
  hote.addEventListener("message", (e) => recus.push(e.data));
  Object.defineProperty(window, "parent", { get: () => hote, configurable: true });
  const CROCHET = "import(CFG.pdfjs)";
  for (const code of blocs) window.eval(code.split(CROCHET).join("Promise.resolve(window.pdfjsLib)") + EXPORTER);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  expect(window.__n, "le document est chargé").toBe(total);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const touche = (cible, key, extra = {}) => cible.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));

const menu = () => document.getElementById("gTocMenu");
const tiroir = () => document.getElementById("gToc");
const entrees = () => [...document.querySelectorAll("#gTocIn .gtoc-e")];
const vider = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); };
async function ouvrir() { menu().click(); await vider(); }

describe("#612 L6b — l'entrée « Sommaire »", () => {
  it("un PDF à signets : l'entrée apparaît dans « ⋯ »", async () => {
    await monter();
    expect(menu().hidden).toBe(false);
  });
  it("sans signets : pas d'entrée, plutôt qu'un panneau vide", async () => {
    await monter({ signets: null });
    expect(menu().hidden).toBe(true);
    await monter({ signets: [] });
    expect(menu().hidden).toBe(true);
  });
  it("l'ancienne barre : ni entrée ni tiroir", async () => {
    await monter({ query: {} });
    expect(menu()).toBeNull();
    expect(tiroir()).toBeNull();
  });
});

describe("#612 L6b — le tiroir", () => {
  it("les titres, leur niveau, et la page de chacun — destination nommée, référence, numéro direct", async () => {
    await monter();
    await ouvrir();
    expect(tiroir().classList.contains("open")).toBe(true);
    expect(entrees().map((e) => [e.querySelector(".gtoc-titre").textContent, e.querySelector(".gtoc-p")?.textContent ?? null])).toEqual([
      ["1. Généralités", "1"], ["1.1 Le terrain", "2"], ["1.2 Les réseaux", "4"], ["2. Chauffage", "5"], ["Annexe introuvable", null],
    ]);
    expect(entrees()[1].style.paddingLeft).toBe("28px");
  });
  it("une destination qui ne se résout pas reste affichée, sans lien", async () => {
    await monter();
    await ouvrir();
    const e = entrees()[4];
    expect(e.tagName).toBe("SPAN");
    expect(e.classList.contains("sans")).toBe(true);
  });
  it("l'entrée courante est celle sous laquelle on lit", async () => {
    await monter();
    await ouvrir();
    expect(entrees().filter((e) => e.getAttribute("aria-current") === "true").map((e) => e.querySelector(".gtoc-titre").textContent)).toEqual(["1. Généralités"]);
  });
  it("un clic mène à la page ; sur grand écran, le tiroir reste et marque le choix", async () => {
    await monter();
    await ouvrir();
    entrees()[3].click();
    await vider();
    expect(demandees).toContain(5);
    expect(tiroir().classList.contains("open")).toBe(true);
    expect(entrees()[3].classList.contains("on")).toBe(true);
  });
  it("sur un écran étroit, le tiroir se replie pour montrer la page", async () => {
    await monter({ largeur: 375 });
    await ouvrir();
    entrees()[2].click();
    await vider();
    expect(demandees).toContain(4);
    expect(tiroir().classList.contains("open")).toBe(false);
  });
  it("la croix le ferme", async () => {
    await monter();
    await ouvrir();
    document.getElementById("gTocX").click();
    expect(tiroir().classList.contains("open")).toBe(false);
  });
});

describe("#612 L6b — Échap referme le sommaire, pas le lecteur", () => {
  it("encadré : une frappe pour le tiroir (rien vers l'hôte), la suivante pour le lecteur", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await ouvrir();
    recus = [];
    touche(document.body, "Escape");
    await attendre(20);
    expect(tiroir().classList.contains("open")).toBe(false);
    expect(recus.some((m) => m && m.type === "3dd-doc-close")).toBe(false);
    touche(document.body, "Escape");
    await attendre(20);
    expect(recus.some((m) => m && m.type === "3dd-doc-close")).toBe(true);
  });
});

describe("#612 L6b — lire les signets n'est pas lire le document", () => {
  it("ouvrir le sommaire ne lit le texte d'aucune page", async () => {
    await monter();
    const avant = lectures;
    await ouvrir();
    expect(lectures).toBe(avant);
  });
});

describe("#612 L6b — la capacité", () => {
  it("`?contract=1` annonce `reading-outline`", async () => {
    player.init(contexteMinimal());
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    expect(JSON.parse(res.body).capabilities).toContain("reading-outline");
  });
});
