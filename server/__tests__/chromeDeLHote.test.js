// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'HÔTE DÉCLARE LA BARRE, LE PLAYER LUI DIT LA PAGE ET LE CLIC (#596).
//
// ⚠️ CE QUI MANQUAIT CHEZ UN HÔTE (11/11/2026) : changer de document sans fermer (plaquette, notice,
// plan d'un lot), ouvrir sa fiche du lot depuis la barre du player — il n'y en a plus qu'une —, et savoir
// où en est le lecteur. Le player ne connaissait que `share`, `close` et la présentation.
//
// Ce banc fait tourner la vraie page d'aperçu, encadrée par une VRAIE fenêtre (celle d'une iframe vide de
// jsdom) qui joue l'hôte : elle envoie `chrome`, elle reçoit `page` et `host-action`.
// Dimensions VARIÉES : gabarit (lecture, ancien), émetteur (le parent, la page elle-même), forme du
// message (juste, fautive), présence de l'élément d'une action du player. Dimensions TENUES FIXES : le
// chemin d'aperçu (un lien tracé n'a pas « Présenter » ; les droits d'un vrai lien sont éprouvés dans
// gabaritLecture.test.js), et jsdom — ni mise en page, ni origine : le contrôle d'émetteur est celui de
// `onHostMessage`, par fenêtre, que jsdom sait faire.

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




let recus = [];
let hote = null;
// Le format du fil vient du pont que la PAGE embarque (browser.generated.js), pas d'une copie : `dist/`
// n'est pas versionné, et un format retapé ici validerait ma supposition plutôt que le contrat.
const toWire = (msg) => window.Player.bridge.toWire(msg);
const vider = () => new Promise((r) => setTimeout(r, 20));    // postMessage est asynchrone
const envoyer = async (msg, source = hote) => { window.dispatchEvent(new window.MessageEvent("message", { data: toWire(msg), source })); await vider(); };

describe("⚠️ #596 — le player dit la page à son hôte", () => {
  it("à chaque changement de page, avec le total", async () => {
    const V = await monter({ query: { gabarit: "lecture" } });
    await vider(); recus.length = 0;
    V.showPage(3);
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-page", page: 3, total: 21 });
  });

  it("dans l'ancien gabarit aussi", async () => {
    const V = await monter({});
    await vider(); recus.length = 0;
    V.showPage(4);
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-page", page: 4, total: 21 });
  });

  it("sans page qui l'encadre, il ne se parle pas à lui-même", async () => {
    // Non encadrée, `window.parent` est la page elle-même : on guette ce qu'elle s'y posterait.
    // Un espion plutôt qu'un écouteur `message` — jsdom laisse `origin` et `source` vides, si bien
    // qu'un écouteur filtré ne verrait jamais rien, et qu'un écouteur non filtré n'a pas lieu d'être.
    const V = await monter({ query: { gabarit: "lecture" }, encadre: false });
    const poste = vi.spyOn(window, "postMessage");
    try {
      V.showPage(3);
      await vider();
      expect(poste.mock.calls.map(([m]) => m && m.type)).not.toContain("3dd-doc-page");
    } finally {
      poste.mockRestore();
    }
  });
});

describe("⚠️ #596 — l'hôte déclare onglets et sous-titre", () => {
  it("les onglets s'affichent en texte, l'actif est marqué, un clic part chez l'hôte", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", subtitle: "Clos Belharra · Anglet", tabs: [{ id: "doc:plaquette", label: "Plaquette" }, { id: "doc:notice", label: "<img src=x onerror=1>" }], activeTab: "doc:plaquette" });
    expect(document.getElementById("gSub").textContent).toBe("Clos Belharra · Anglet");
    const onglets = [...document.querySelectorAll("#gTabs .gtab")];
    expect(onglets.map((b) => b.textContent)).toEqual(["Plaquette", "<img src=x onerror=1>"]);
    expect(document.querySelector("#gTabs img"), "un libellé est du texte").toBeNull();
    expect(onglets[0].getAttribute("aria-selected")).toBe("true");
    recus.length = 0;
    onglets[1].click();
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-host-action", id: "doc:notice" });
    expect(onglets[1].classList.contains("on"), "l'onglet cliqué se marque tout de suite").toBe(true);
  });

  // ⚠️ TROUVÉ DANS CHROME, PAS ICI (11/11) : le contrat dit « après embed-ready », une page hôte a répondu
  // à embed-ready par un chrome… perdu. L'écoute ne s'inscrivait qu'au démarrage, une fois pdf.js chargé,
  // soit APRÈS l'annonce. Ce banc chargeait pdf.js instantanément et ne pouvait pas le voir : il lui faut
  // un import lent, comme le vrai.
  it("un chrome envoyé dès embed-ready n'est pas perdu, même si pdf.js arrive après", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" }, importLent: true,
      surPret: () => window.dispatchEvent(new window.MessageEvent("message", { data: window.Player.bridge.toWire({ type: "chrome", tabs: [{ id: "doc:a", label: "Tôt" }] }), source: hote })) });
    expect([...document.querySelectorAll("#gTabs .gtab")].map((b) => b.textContent)).toEqual(["Tôt"]);
  });

  it("un message mal formé est ignoré en entier : la barre reste telle quelle", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "A" }] });
    window.dispatchEvent(new window.MessageEvent("message", { data: { type: "3dd-doc-chrome", tabs: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: "x" })) }, source: hote }));
    await vider();
    expect([...document.querySelectorAll("#gTabs .gtab")].map((b) => b.textContent)).toEqual(["A"]);
  });

  // ⚠️ Seul le parent parle à la page : un script de la page qui s'enverrait un `chrome` à lui-même
  // n'a pas à pouvoir réécrire la barre.
  it("un message qui ne vient pas du parent est ignoré", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "Intrus" }] }, window);
    expect(document.getElementById("gTabs").hidden).toBe(true);
  });

  it("l'ancien gabarit ignore chrome sans casser", async () => {
    await monter({});
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "A" }] });
    expect(document.getElementById("gTabs")).toBeNull();
    expect(document.getElementById("shareBtn").className).toContain("primary");
  });
});

describe("⚠️ #596 — les actions : celles de l'hôte, et celles du player qu'il place", () => {
  it("une action de l'hôte en contour renvoie son id ; Partager devient le bouton plein renommé", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", actions: [{ id: "fiche-lot", label: "Fiche du lot", place: "secondary" }, { id: "share", label: "Envoyer au client", place: "primary" }] });
    const slots = document.getElementById("gSlots");
    const partager = document.getElementById("shareBtn");
    expect(partager.parentNode).toBe(slots);
    expect(partager.className).toBe("gbtn gprim");
    expect(partager.textContent).toBe("Envoyer au client");
    const fiche = slots.querySelector('[data-host-action="fiche-lot"]');
    expect(fiche.className).toBe("gbtn gsec");
    expect([...slots.children].indexOf(partager), "le bouton plein vient en premier").toBe(0);
    recus.length = 0;
    fiche.click();
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-host-action", id: "fiche-lot" });
  });

  // « UNE action pleine » est la promesse du gabarit : deux « primary » déclarés ne font pas deux boutons
  // pleins, le second rejoint le menu (la mutation qui laissait passer le second avait survécu au banc).
  it("une seule action pleine, une seule en contour : le surplus rejoint le menu", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", actions: [
      { id: "share", label: "Envoyer", place: "primary" }, { id: "fiche-lot", label: "Fiche du lot", place: "primary" },
      { id: "plan", label: "Plan", place: "secondary" }, { id: "grille", label: "Grille", place: "secondary" },
    ] });
    expect(document.querySelectorAll("#gSlots .gprim").length).toBe(1);
    expect(document.querySelectorAll("#gSlots .gsec").length).toBe(1);
    const auMenu = [...document.querySelectorAll("#barMenu .g-act:not(.g-mob)")].map((b) => b.textContent);
    expect(auMenu).toEqual(expect.arrayContaining(["Fiche du lot", "Grille"]));
  });

  it("les actions du player que l'hôte ne cite pas restent joignables, au menu", async () => {
    await monter({ query: { gabarit: "lecture" } });
    await envoyer({ type: "chrome", actions: [{ id: "fiche-lot", label: "Fiche du lot", place: "primary" }] });
    expect(document.getElementById("shareBtn").closest(".gcache")).toBeTruthy();
    const relais = [...document.querySelectorAll("#barMenu .g-act")].map((b) => b.textContent);
    expect(relais).toEqual(expect.arrayContaining(["Partager", "Présenter en direct", "Télécharger"]));
    let partages = 0;
    document.getElementById("shareBtn").addEventListener("click", () => { partages += 1; });
    [...document.querySelectorAll("#barMenu .g-act")].find((b) => b.textContent === "Partager").click();
    expect(partages, "le relais clique le vrai bouton").toBe(1);
  });

  // ⚠️ PLACER N'OUVRE AUCUN DROIT : une action du player sans élément dans la page (téléchargement interdit
  // par le lien) est sautée, où que l'hôte la place.
  it("une action du player absente de la page n'est jamais fabriquée", async () => {
    await monter({ query: { gabarit: "lecture" } });
    document.getElementById("dlBtn").remove();
    await envoyer({ type: "chrome", actions: [{ id: "download", label: "Télécharger", place: "primary" }] });
    expect(document.getElementById("dlBtn")).toBeNull();
    expect(document.querySelector('#gSlots [data-host-action="download"]')).toBeNull();
    expect(document.getElementById("gSlots").textContent).not.toContain("Télécharger");
  });

  it("un chrome sans actions remet la barre de l'adresse : l'hôte peut retirer ce qu'il a posé", async () => {
    await monter({ query: { gabarit: "lecture", primaryLabel: "Envoyer au client", subtitle: "De l'adresse" } });
    await envoyer({ type: "chrome", subtitle: "Du chrome", tabs: [{ id: "doc:a", label: "A" }], actions: [{ id: "fiche-lot", label: "Fiche du lot", place: "primary" }] });
    await envoyer({ type: "chrome" });
    expect(document.querySelector("[data-host-action]")).toBeNull();
    expect(document.getElementById("shareBtn").className).toBe("gbtn gprim");
    expect(document.getElementById("shareBtn").textContent).toBe("Envoyer au client");
    expect(document.getElementById("gSub").textContent).toBe("De l'adresse");
    expect(document.getElementById("gTabs").hidden).toBe(true);
  });
});

// ÉCHAP REFERME D'ABORD CE QUI EST OUVERT. Constaté chez un hôte le 11/11/2026 : le menu « ⋯ » ouvert (il porte
// désormais les actions de l'hôte), Échap fermait le lecteur entier — l'hôte recevait `close` et retirait le cadre.
describe("Échap referme le menu « ⋯ » avant le lecteur", () => {
  const echap = () => document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const types = () => recus.map((m) => m && m.type);
  for (const gabarit of ["lecture", ""]) {
    it(`encadré, ${gabarit ? "gabarit lecture" : "ancien gabarit"} : une frappe pour le menu, la suivante pour le lecteur`, async () => {
      await monter({ query: { ...(gabarit ? { gabarit } : {}), embed: "1" } });
      await vider(); recus.length = 0;
      document.getElementById("barMore").click();
      const menu = document.getElementById("barMenu");
      expect(menu.classList.contains("open"), "le menu s'ouvre").toBe(true);
      echap(); await vider();
      expect(menu.classList.contains("open")).toBe(false);
      expect(types()).not.toContain("3dd-doc-close");
      echap(); await vider();
      expect(types()).toContain("3dd-doc-close");
    });
  }
  it("sans menu ouvert, Échap ferme le lecteur comme avant", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await vider(); recus.length = 0;
    echap(); await vider();
    expect(types()).toContain("3dd-doc-close");
  });
  it("hors cadre, Échap referme le menu et n'envoie rien", async () => {
    await monter({ query: { gabarit: "lecture" }, encadre: false });
    const poste = vi.spyOn(window, "postMessage");
    try {
      document.getElementById("barMore").click();
      echap(); await vider();
      expect(document.getElementById("barMenu").classList.contains("open")).toBe(false);
      expect(poste.mock.calls.map(([m]) => m && m.type)).not.toContain("3dd-doc-close");
    } finally { poste.mockRestore(); }
  });
});
