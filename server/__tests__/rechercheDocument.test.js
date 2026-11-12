// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CHERCHER DANS LE DOCUMENT (#612, L6a) — la vraie page d'aperçu, dans le gabarit « lecture ».
//
// ⚠️ CE QUI MANQUAIT : les pages sont virtualisées, le « Rechercher » du navigateur ne voit que les deux ou trois
// rendues ; et un document numérisé ne contient pas de texte, ce que rien ne disait.
//
// Le banc fait tourner la page avec un pdf.js de doublure qui porte un TEXTE PAR PAGE, et une couche texte
// minimale qui pose un `span` par élément — comme la vraie (`TextLayer.textDivs`, marked content exclu).
// Dimensions VARIÉES : la requête (casse, accents, absente), les pages sans texte (toutes, quelques-unes), le
// navigateur (avec et sans l'API CSS Custom Highlight), le clavier (Ctrl+F, /, Entrée, Maj+Entrée, Échap).
// Dimensions TENUES FIXES : le chemin d'aperçu encadré, et jsdom — ni mise en page ni défilement réel : la page
// visée est relevée par `scrollIntoView`.

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

const NOTICE = [
  ["Notice descriptive", "Résidence Exemple"],
  ["Le CHAUFFAGE est collectif.", "Chauffage au sol dans les pièces de vie."],
  ["Équipement des cuisines"],
  ["Parkings en sous-sol"],
  ["Annexe : chauffage d'appoint"],
];
let lectures = 0;   // appels à getTextContent : la recherche doit lire à la demande, pas au chargement

function fauxPdfjs(textes) {
  const pageDe = (n) => ({
    rotate: 0,
    getViewport: () => ({ width: 595, height: 842, scale: 1 }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    getTextContent: () => { lectures += 1; return Promise.resolve({ items: [{ type: "beginMarkedContent" }, ...(textes[n - 1] || []).map((str) => ({ str, hasEOL: true })), { type: "endMarkedContent" }] }); },
  });
  const pdf = { numPages: textes.length, destroy() {}, getPage: (n) => Promise.resolve(pageDe(n)) };
  // La couche texte de doublure : un span par élément qui a une chaîne, comme celle de pdf.js.
  class TextLayer {
    constructor({ textContentSource, container }) { this.source = textContentSource; this.container = container; this.textDivs = []; }
    render() {
      for (const it of this.source.items) {
        if (it.str === undefined) continue;
        const s = document.createElement("span"); s.textContent = it.str; this.container.appendChild(s); this.textDivs.push(s);
      }
      return Promise.resolve();
    }
  }
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
async function monter({ query = { gabarit: "lecture" }, textes = NOTICE, highlights = false, rendre = false } = {}) {
  retirerLesFantomes();
  lectures = 0;
  const html = await htmlApercu(query);
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const balise = /<body([^>]*)>/i.exec(html);
  const classe = balise && /class=("?)([^\s">]+)\1/.exec(balise[1]);
  document.body.className = classe ? classe[2] : "";
  const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")].map((s) => s.textContent || "").filter((c) => c.trim());
  window.pdfjsLib = fauxPdfjs(textes);
  window.HTMLCanvasElement.prototype.getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
  // `rendre` : un observateur qui déclare VISIBLE tout ce qu'on lui confie — les pages se rendent, avec leur couche
  // texte. Sans lui, jsdom ne rend aucune page (rien n'entre jamais dans la vue).
  window.IntersectionObserver = rendre
    ? function (cb) { this.observe = (el) => armerOrigine(() => cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this), 0); this.unobserve = () => {}; this.disconnect = () => {}; }
    : function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; };
  // L'API CSS Custom Highlight : absente de jsdom ; posée à la demande pour éprouver les deux chemins.
  if (highlights) {
    window.Highlight = class { constructor() { this.plages = []; } add(r) { this.plages.push(r); } };
    window.CSS = { highlights: new Map() };
  } else {
    delete window.Highlight; window.CSS = undefined;
  }
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
  expect(window.__n, "le document est chargé").toBe(textes.length);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const touche = (cible, key, extra = {}) => cible.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
async function taper(texte) {
  const champ = document.getElementById("gFindIn");
  champ.value = texte;
  champ.dispatchEvent(new window.Event("input", { bubbles: true }));
  await attendre(300);                                   // l'anti-rebond (220 ms), puis la lecture du texte
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
}
const compteur = () => document.getElementById("gFindN").textContent;
const ouvert = () => document.getElementById("gFind").classList.contains("open");

describe("#612 — la loupe et le champ", () => {
  it("dans le gabarit « lecture », une loupe ; dans l'ancienne barre, rien", async () => {
    await monter();
    expect(document.getElementById("gFindBtn")).not.toBeNull();
    await monter({ query: {} });
    expect(document.getElementById("gFindBtn")).toBeNull();
    expect(document.getElementById("gFind")).toBeNull();
  });
  it("Ctrl+F et « / » ouvrent le champ, le focus dedans ; la loupe aussi", async () => {
    await monter();
    expect(ouvert()).toBe(false);
    touche(document.body, "f", { ctrlKey: true });
    expect(ouvert()).toBe(true);
    expect(document.activeElement.id).toBe("gFindIn");
    touche(document.getElementById("gFindIn"), "Escape");
    touche(document.body, "/");
    expect(ouvert()).toBe(true);
    touche(document.getElementById("gFindIn"), "Escape");
    document.getElementById("gFindBtn").click();
    expect(ouvert()).toBe(true);
  });
});

describe("#612 — chercher", () => {
  it("le texte n'est lu qu'à la première recherche, et alors de TOUTES les pages", async () => {
    await monter();
    const auChargement = lectures;
    expect(auChargement, "au chargement, seules les pages rendues lisent leur texte").toBeLessThan(NOTICE.length);
    touche(document.body, "f", { ctrlKey: true });
    await taper("chauffage");
    expect(lectures - auChargement).toBe(NOTICE.length);
    await taper("parking");
    expect(lectures - auChargement, "l'index est gardé : une seconde recherche ne relit rien").toBe(NOTICE.length);
  });
  it("« chauffage » : trois résultats, casse ignorée, on va à la page du premier", async () => {
    await monter();
    touche(document.body, "f", { ctrlKey: true });
    await taper("chauffage");
    expect(compteur()).toBe("1 / 3 · page 2");
    expect(demandees).toContain(2);
  });
  it("Entrée va au suivant, Maj+Entrée au précédent, et l'on fait le tour", async () => {
    await monter();
    touche(document.body, "f", { ctrlKey: true });
    await taper("chauffage");
    const champ = document.getElementById("gFindIn");
    touche(champ, "Enter");
    expect(compteur()).toBe("2 / 3 · page 2");
    touche(champ, "Enter");
    expect(compteur()).toBe("3 / 3 · page 5");
    expect(demandees).toContain(5);
    touche(champ, "Enter");
    expect(compteur()).toBe("1 / 3 · page 2");
    touche(champ, "Enter", { shiftKey: true });
    expect(compteur()).toBe("3 / 3 · page 5");
  });
  it("sans accents dans la requête : « equipement » trouve « Équipement »", async () => {
    await monter();
    touche(document.body, "f", { ctrlKey: true });
    await taper("equipement");
    expect(compteur()).toBe("1 / 1 · page 3");
  });
  it("aucun résultat : le dire, en évidence", async () => {
    await monter();
    touche(document.body, "f", { ctrlKey: true });
    await taper("ascenseur");
    expect(compteur()).toBe("Aucun résultat");
    expect(document.getElementById("gFindN").classList.contains("vide")).toBe(true);
  });
});

describe("#612 — ⚠️ un document numérisé n'est pas un document où le mot n'est pas", () => {
  it("aucune page n'a de texte : « Document numérisé », pas « Aucun résultat »", async () => {
    await monter({ textes: [[], [], [" "]] });
    touche(document.body, "f", { ctrlKey: true });
    await taper("chauffage");
    expect(compteur()).toBe("Document numérisé : il ne contient pas de texte à chercher");
  });
  it("quelques pages en image : elles sont nommées quand on ne trouve rien", async () => {
    await monter({ textes: [["Sommaire"], [], [], ["Annexe"]] });
    touche(document.body, "f", { ctrlKey: true });
    await taper("chauffage");
    expect(compteur()).toBe("Aucun résultat · pages 2 à 3 en image, non lues");
  });
});

describe("#612 — Échap referme la recherche, pas le lecteur", () => {
  // Encadrée (`embed=1`) : c'est là qu'Échap renvoie `close` à l'hôte, donc là que l'enjeu existe.
  it("dans le champ : la recherche se ferme, rien ne part vers l'hôte ; une seconde frappe ferme le lecteur", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    touche(document.body, "f", { ctrlKey: true });
    recus = [];
    touche(document.getElementById("gFindIn"), "Escape");
    await attendre(20);
    expect(ouvert()).toBe(false);
    expect(recus.some((m) => m && m.type === "3dd-doc-close")).toBe(false);
    touche(document.body, "Escape");
    await attendre(20);
    expect(recus.some((m) => m && m.type === "3dd-doc-close")).toBe(true);
  });
  it("hors du champ, la recherche ouverte : la première frappe la ferme, et elle seule", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    touche(document.body, "f", { ctrlKey: true });
    document.body.focus();
    recus = [];
    touche(document.body, "Escape");
    await attendre(20);
    expect(ouvert()).toBe(false);
    expect(recus.some((m) => m && m.type === "3dd-doc-close")).toBe(false);
  });
});

describe("#612 — le surlignage, sur les pages rendues", () => {
  const rendue = () => [...document.querySelectorAll(".textLayer[data-p]")].map((n) => +n.getAttribute("data-p"));
  it("sans l'API Highlight : les span de l'occurrence courante et des autres sont marqués, puis démarqués à la fermeture", async () => {
    await monter({ rendre: true });
    touche(document.body, "f", { ctrlKey: true });
    await taper("notice");                                  // page 1 : rendue au chargement
    expect(rendue()).toContain(1);
    const courant = [...document.querySelectorAll('.textLayer[data-p="1"] .g-courant')].map((s) => s.textContent);
    expect(courant).toEqual(["Notice descriptive"]);
    touche(document.getElementById("gFindIn"), "Escape");
    expect(document.querySelectorAll(".textLayer .g-courant,.textLayer .g-trouve")).toHaveLength(0);
  });
  it("avec l'API Highlight : une plage exacte, sans toucher au DOM de pdf.js", async () => {
    await monter({ highlights: true, rendre: true });
    touche(document.body, "f", { ctrlKey: true });
    await taper("descriptive");
    const h = window.CSS.highlights.get("pdf-courant");
    expect(h.plages).toHaveLength(1);
    expect(h.plages[0].toString()).toBe("descriptive");
    expect(document.querySelectorAll(".textLayer .g-courant")).toHaveLength(0);
    touche(document.getElementById("gFindIn"), "Escape");
    expect(window.CSS.highlights.has("pdf-courant")).toBe(false);
  });
});

describe("#612 — la capacité", () => {
  it("`?contract=1` annonce `reading-search`", async () => {
    player.init(contexteMinimal());
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    expect(JSON.parse(res.body).capabilities).toContain("reading-search");
  });
});
