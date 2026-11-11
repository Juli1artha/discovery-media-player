// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE GABARIT « LECTURE » (#595) : une barre fine, une action pleine, la navigation dans une pastille.
//
// ⚠️ CE QUI A ÉTÉ CONSTATÉ CHEZ UN HÔTE (11/11/2026) : treize commandes au même poids dans une barre
// noire, « Partager » en blanc comme seul repère, pivoter deux fois au premier rang, le pied légal posé
// sur le bas de la page.
//
// ⚠️ LE RISQUE PROPRE À CE LOT : le script de la visionneuse retrouve ses boutons par leur id, certains
// sans garde. Une barre redessinée qui en oublie un ne casse pas un bouton, elle arrête la PAGE. D'où
// les essais qui démarrent la vraie page et comptent les ids.
//
// Dimensions VARIÉES : `?gabarit=` (absent, lecture), placement et libellé des actions, droit de
// télécharger, lien tracé ou aperçu (pour le pied légal). Dimensions TENUES FIXES : aucun assistant
// (le gabarit s'efface devant lui ; cet aiguillage n'est pas joué ici, faute de greffon de laboratoire),
// jsdom (aucune mise en page : ni contraste, ni largeur réelle — vérifiés à part dans Chrome).

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
function retirerLesFantomes() {
  for (const [type, fn, opts] of posesSurDocument.splice(0)) document.removeEventListener(type, fn, opts);
}

async function monter({ query = {}, vp = PAYSAGE, total = 21 } = {}) {
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
  const CROCHET = "import(CFG.pdfjs)";
  let substitutions = 0;
  for (const code of blocs) {
    const n = code.split(CROCHET).length - 1;
    substitutions += n;
    window.eval((n ? code.split(CROCHET).join("Promise.resolve(window.pdfjsLib)") : code) + EXPORTER);
  }
  expect(substitutions, "le crochet de chargement de pdf.js doit exister, sinon la page ne démarre jamais ici").toBe(1);
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  expect(window.__n, "le document est chargé").toBe(total);
  return window.__V;
}

const attendre = () => new Promise((r) => setTimeout(r, 40)); // le report de page de la construction vaut 30 ms


const { reglagesLecture, barreLecture } = require("../gabarit-lecture.js");
const ids = () => [...document.querySelectorAll("[id]")].map((e) => e.id);

describe("⚠️ #595 — sans ?gabarit=, rien ne change", () => {
  it("l'ancienne barre est servie à l'identique, sans la feuille du gabarit", async () => {
    const html = await htmlApercu({});
    expect(html).toContain('<button class="dl primary" id=shareBtn>Partager</button>');
    expect(html).not.toContain("g-lecture");
    expect(html).not.toContain("gpill");
  });
});

describe("⚠️ #595 — la page démarre avec la nouvelle barre", () => {
  it("chaque id que le script lit existe, et une seule fois", async () => {
    const V = await monter({ query: { gabarit: "lecture" } });
    expect(document.body.classList.contains("g-lecture")).toBe(true);
    const tous = ids();
    for (const id of ["zin", "zout", "zlbl", "rotL", "rotR", "vignBtn", "fs", "presentBtn", "shareBtn", "dlBtn", "barMore", "barMenu", "pg", "closeBtn", "pop", "shSend", "shSelf", "shCopy", "gPill", "pillPrev", "pillNext", "fitBtn", "gProg"]) {
      expect(tous, `#${id}`).toContain(id);
    }
    const doublons = tous.filter((x, i) => tous.indexOf(x) !== i);
    expect(doublons, "un id en double, et getElementById choisit au hasard du balisage").toEqual([]);
    expect(V, "la poignée de visionneuse est offerte : la page a démarré").toBeTruthy();
  });

  it("ouvre en page entière sans ?fit=, et le bouton de la pastille bascule en gardant la page", async () => {
    const V = await monter({ query: { gabarit: "lecture" } });
    expect(V.ajustement).toBe("page");
    const fit = document.getElementById("fitBtn");
    expect(fit.textContent).toBe("Largeur");
    const entiere = parseInt(document.querySelector("#pages .page").style.width, 10);
    fit.click();
    expect(V.ajustement).toBe("largeur");
    expect(fit.textContent).toBe("Page entière");
    expect(fit.getAttribute("aria-pressed")).toBe("false");
    expect(parseInt(document.querySelector("#pages .page").style.width, 10)).toBeGreaterThan(entiere);
    fit.click();
    expect(V.ajustement).toBe("page");
  });

  it("la pastille tourne les pages et la barre dit la progression", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await attendre(); demandees.length = 0;
    expect(document.getElementById("pillPrev").disabled, "page 1 : rien avant").toBe(true);
    expect(document.getElementById("gProg").style.width).toBe("5%");
    document.getElementById("pillNext").click();
    expect(demandees).toEqual([2]);
  });

  it("le menu « ⋯ » déclenche le vrai bouton, rangé hors de vue", async () => {
    await monter({ query: { gabarit: "lecture" } });
    let rotations = 0;
    document.getElementById("rotL").addEventListener("click", () => { rotations += 1; });
    expect(document.getElementById("rotL").closest(".gcache"), "pivoter n'est plus au premier rang").toBeTruthy();
    document.querySelector('#barMenu [data-t="rotL"]').click();
    expect(rotations).toBe(1);
  });
});

describe("⚠️ #595 — les actions : placées et renommées, jamais inventées", () => {
  it("l'action principale et la secondaire, avec leurs libellés", async () => {
    await monter({ query: { gabarit: "lecture", primary: "share", primaryLabel: "Envoyer au client", secondary: "present" } });
    const partager = document.getElementById("shareBtn");
    expect(partager.className).toContain("gprim");
    expect(partager.textContent).toBe("Envoyer au client");
    expect(document.getElementById("presentBtn").className).toContain("gsec");
    expect(document.getElementById("dlBtn").closest(".gcache"), "télécharger part dans le menu").toBeTruthy();
    expect(document.querySelector('#barMenu [data-t="dlBtn"]')).toBeTruthy();
  });

  it("un libellé est du texte, jamais du balisage", async () => {
    const piege = "<img src=x onerror=alert(1)>";
    await monter({ query: { gabarit: "lecture", primaryLabel: piege } });
    const b = document.getElementById("shareBtn");
    expect(b.querySelector("img")).toBeNull();
    expect(b.textContent).toBe(piege);
  });

  it("un libellé trop long est refusé entier, pas tronqué", () => {
    expect(reglagesLecture({ gabarit: "lecture", primaryLabel: "x".repeat(41) }).primaryLabel).toBe("");
    expect(reglagesLecture({ gabarit: "lecture", primaryLabel: "x".repeat(40) }).primaryLabel).toBe("x".repeat(40));
  });

  it("hors liste : action par défaut ; secondaire égale à la principale : abandonnée ; sans gabarit : rien", () => {
    expect(reglagesLecture({ gabarit: "lecture", primary: "delete" }).primary).toBe("share");
    expect(reglagesLecture({ gabarit: "lecture", primary: "share", secondary: "share" }).secondary).toBe("");
    expect(reglagesLecture({ gabarit: "LECTURE" })).toBeNull();
    expect(reglagesLecture({})).toBeNull();
  });

  // ⚠️ PLACER N'OUVRE AUCUN DROIT : c'est la phrase du ticket, et la seule qui protège quelque chose.
  it("télécharger interdit par le lien : absent, même placé en bouton principal", () => {
    const html = barreLecture({ reglages: reglagesLecture({ gabarit: "lecture", primary: "download" }), preview: false, embed: false, title: "Doc", fileUrl: "/f", allowDownload: false, legalHtml: "", tracked: true });
    expect(html).not.toContain("dlBtn");
    expect(html).not.toContain("Télécharger");
  });

  it("présenter n'existe qu'en aperçu, où qu'on le place", () => {
    const html = barreLecture({ reglages: reglagesLecture({ gabarit: "lecture", primary: "present" }), preview: false, embed: true, title: "Doc", fileUrl: "/f", allowDownload: true, legalHtml: "", tracked: true });
    expect(html).not.toContain("presentBtn");
    expect(html).toContain("embedCloseBtn");
  });
});

describe("⚠️ #595 — « Lecture mesurée » reste à l'écran sur un lien tracé", () => {
  const PIED = "<details class=lgl><summary class=lgl-pill>MENTION</summary></details>";
  const base = { reglages: reglagesLecture({ gabarit: "lecture" }), embed: false, title: "Doc", fileUrl: "/f", allowDownload: true, legalHtml: PIED };
  it("lien tracé : dans la barre, qui ne s'efface pas", () => {
    const html = barreLecture({ ...base, preview: false, tracked: true });
    expect(html.indexOf("MENTION")).toBeGreaterThan(0);
    expect(html.indexOf("MENTION"), "avant la fin de la barre, pas dans le menu").toBeLessThan(html.indexOf("id=barMenu"));
    expect(html.split("MENTION").length - 1, "une seule fois : deux mentions, deux panneaux qui s'ouvrent").toBe(1);
  });
  it("aperçu interne : dans le menu, à « À propos »", () => {
    const html = barreLecture({ ...base, preview: true, tracked: false });
    expect(html.indexOf("MENTION")).toBeGreaterThan(html.indexOf("id=barMenu"));
    expect(html.split("MENTION").length - 1).toBe(1);
  });
  it("et la page ne le pose plus en bas, par-dessus le document", async () => {
    await monter({ query: { gabarit: "lecture" } });
    const pied = document.querySelector(".lgl");
    if (pied) expect(pied.closest(".gbar, .gmenu"), "le pied légal vit dans la barre ou le menu").toBeTruthy();
  });
});

describe("⚠️ #595 — les commandes s'effacent, la barre non", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("trois secondes sans geste : la pastille part ; un geste la ramène", async () => {
    await monter({ query: { gabarit: "lecture" } });
    vi.useFakeTimers();
    document.dispatchEvent(new window.Event("pointermove"));
    vi.advanceTimersByTime(2900);
    expect(document.body.classList.contains("g-off")).toBe(false);
    vi.advanceTimersByTime(200);
    expect(document.body.classList.contains("g-off")).toBe(true);
    document.dispatchEvent(new window.Event("pointermove"));
    expect(document.body.classList.contains("g-off")).toBe(false);
  });

  it("jamais sous les doigts : menu ouvert, rien ne part", async () => {
    await monter({ query: { gabarit: "lecture" } });
    vi.useFakeTimers();
    document.dispatchEvent(new window.Event("pointermove"));
    document.getElementById("barMore").click();
    expect(document.getElementById("barMenu").classList.contains("open")).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(document.body.classList.contains("g-off")).toBe(false);
  });

  it("l'ancien gabarit ne s'efface jamais", async () => {
    await monter({});
    vi.useFakeTimers();
    document.dispatchEvent(new window.Event("pointermove"));
    vi.advanceTimersByTime(10000);
    expect(document.body.classList.contains("g-off")).toBe(false);
  });
});
