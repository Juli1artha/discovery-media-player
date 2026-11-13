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

// LE DIRECT MONTE DANS LA BARRE (13/11/2026). Vu chez ADN Family, sur une fiche de programme : pendant une
// présentation, la pilule du bas couvrait la page, débordait du cadre (« Terminer » coupé), et trois de ses
// boutons — Changer de document, Inviter l'équipe, Passer la main — n'envoyaient qu'un message que l'hôte
// n'écoutait pas. Et un clic sur un onglet rechargeait le cadre : la présentation s'arrêtait chez le client.
// Dimensions VARIÉES : gabarit (lecture, ancien), gestes déclarés (aucun, switch, les trois), panneau (ouvert,
// fermé). TENUES FIXES : l'aperçu encadré, et un serveur doublé qui accepte toute présentation.
describe("⚠️ 13/11 — dans le gabarit lecture, le direct vit dans la barre", () => {
  let fetchOrigine;
  beforeEach(() => {
    fetchOrigine = window.fetch;
    window.fetch = (url, init) => {
      const corps = init && init.body ? JSON.parse(init.body) : {};
      const rep = corps.action === "present-start" ? { ok: true, slug: "abc123", control: "c".repeat(32) } : { ok: true };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rep) });
    };
  });
  afterEach(() => { window.fetch = fetchOrigine; });

  const presenter = async () => { document.getElementById("presentBtn").click(); await vider(); await vider(); };
  // Le banc ne charge pas la feuille de style (la tête de la page est retirée) : ce qui se cache se cache
  // donc par l'attribut `hidden`, que le banc lit — pas par une règle qu'il ne verrait pas.
  const visible = (id) => !document.getElementById(id).hidden;

  it("« Présenter » devient « En direct », et rien ne se pose sur la page tant qu'on ne l'ouvre pas", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    const direct = document.getElementById("gDirectBtn");
    expect(direct.hidden, "pas de « En direct » avant le direct").toBe(true);
    await presenter();
    expect(direct.hidden).toBe(false);
    expect(document.body.classList.contains("g-direct")).toBe(true);
    expect(document.getElementById("pbar").style.display, "la pilule du bas ne s'affiche plus").toBe("none");
    direct.click();
    expect(document.getElementById("pbar").style.display).toBe("grid");
    expect(direct.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("pbarLink").value).toMatch(/\/present\/abc123$/);
  });

  it("sans geste déclaré, ni « Changer de document », ni « Inviter l'équipe », ni « Passer la main »", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await presenter();
    document.getElementById("gDirectBtn").click();
    for (const id of ["pbarSwitch", "pbarInvite", "pbarHandover"]) expect(visible(id), id).toBe(false);
    for (const id of ["pbarCopy", "pbarMap", "pbarEnd"]) expect(visible(id), id).toBe(true);
  });

  it("un geste nommé par l'hôte apparaît, et part chez lui", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", presenter: ["switch"] });
    await presenter();
    document.getElementById("gDirectBtn").click();
    expect(visible("pbarSwitch")).toBe(true);
    expect(visible("pbarInvite")).toBe(false);
    recus.length = 0;
    document.getElementById("pbarSwitch").click();
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-present-switch", slug: "abc123" });
    // Un chrome suivant REMPLACE le précédent : sans `presenter`, le geste repart.
    await envoyer({ type: "chrome" });
    expect(visible("pbarSwitch")).toBe(false);
  });

  it("pendant le direct, un onglet ne recharge pas le cadre tant que l'hôte ne sait pas changer de document", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "Plaquette" }, { id: "doc:b", label: "Notice" }], activeTab: "doc:a" });
    await presenter();
    recus.length = 0;
    const notice = [...document.querySelectorAll("#gTabs .gtab")][1];
    expect(notice.getAttribute("aria-disabled")).toBe("true");
    notice.click(); await vider();
    expect(recus.map((m) => m && m.type)).not.toContain("3dd-doc-host-action");
    // L'hôte qui sait changer de document le dit : l'onglet redevient un geste.
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "Plaquette" }, { id: "doc:b", label: "Notice" }], activeTab: "doc:a", presenter: ["switch"] });
    const notice2 = [...document.querySelectorAll("#gTabs .gtab")][1];
    expect(notice2.hasAttribute("aria-disabled")).toBe(false);
    notice2.click(); await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-host-action", id: "doc:b" });
  });

  it("Échap referme le panneau avant le lecteur, et un clic dehors aussi", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await presenter();
    const pb = document.getElementById("pbar");
    document.getElementById("gDirectBtn").click();
    recus.length = 0;
    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await vider();
    expect(pb.style.display).toBe("none");
    expect(recus.map((m) => m && m.type)).not.toContain("3dd-doc-close");
    document.getElementById("gDirectBtn").click();
    document.getElementById("pbarLink").click();
    expect(pb.style.display, "un clic DANS le panneau le laisse ouvert").toBe("grid");
    document.getElementById("scroll").click();
    expect(pb.style.display).toBe("none");
  });

  it("l'ancien gabarit garde sa pilule et ses sept boutons", async () => {
    await monter({ query: { embed: "1" } });
    await presenter();
    expect(document.getElementById("pbar").style.display).toBe("flex");
    for (const id of ["pbarSwitch", "pbarInvite", "pbarHandover", "pbarEnd"]) expect(visible(id), id).toBe(true);
  });
});

// « PRÉSENTER » CONFIÉ À L'HÔTE (13/11/2026). Lancée depuis un cadre d'une autre origine, une présentation n'a pas de
// propriétaire, et personne ne peut en changer le document. L'hôte qui nomme `start` la démarre côté serveur, au nom du
// membre, et la confie par `present-attach`.
describe("⚠️ 13/11 — « Présenter » confié à l'hôte qui nomme start", () => {
  let fetchOrigine, actions;
  beforeEach(() => {
    fetchOrigine = window.fetch; actions = [];
    window.fetch = (url, init) => {
      const corps = init && init.body ? JSON.parse(init.body) : {};
      actions.push(corps.action);
      const rep = corps.action === "present-start" ? { ok: true, slug: "local1", control: "c".repeat(32) } : { ok: true, seq: 0 };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rep) });
    };
  });
  afterEach(() => { window.fetch = fetchOrigine; });

  it("le clic demande à l'hôte, ne démarre rien ici, et la conduite confiée allume « En direct »", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", presenter: ["start", "switch"] });
    recus.length = 0;
    const btn = document.getElementById("presentBtn");
    btn.click(); await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-present-request" });
    expect(actions, "aucune présentation sans propriétaire").not.toContain("present-start");
    expect(btn.disabled).toBe(true);
    btn.click(); await vider();
    expect(recus.filter((m) => m && m.type === "3dd-doc-present-request").length, "un second clic ne redemande pas").toBe(1);
    await envoyer({ type: "present-attach", slug: "srv123", control: "k".repeat(32) });
    await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-present-attached", slug: "srv123" });
    expect(document.getElementById("gDirectBtn").hidden).toBe(false);
    expect(btn.disabled, "le bouton revient intact pour après « Terminer »").toBe(false);
  });

  it("une conduite refusée rend le bouton", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", presenter: ["start"] });
    window.fetch = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ ok: false }) });
    const btn = document.getElementById("presentBtn");
    btn.click(); await vider();
    await envoyer({ type: "present-attach", slug: "srv123", control: "k".repeat(32) });
    await vider();
    expect(btn.disabled).toBe(false);
  });

  it("sans start, « Présenter » démarre ici, comme avant", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", presenter: ["switch"] });
    document.getElementById("presentBtn").click(); await vider(); await vider();
    expect(actions).toContain("present-start");
  });

  // 13/11, essai de Julien : « le bouton ne propose rien » — il menait aux onglets sans rien montrer.
  it("« Changer de document » déplie la liste des documents de l'hôte, et un choix fait ce que ferait l'onglet", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", tabs: [{ id: "doc:a", label: "Plaquette" }, { id: "doc:b", label: "Notice" }, { id: "plans", label: "Plans · 18" }], activeTab: "doc:a", presenter: ["switch"] });
    document.getElementById("presentBtn").click(); await vider(); await vider();
    document.getElementById("gDirectBtn").click();
    recus.length = 0;
    const sw = document.getElementById("pbarSwitch");
    sw.click(); await vider();
    const docs = [...document.querySelectorAll("#pbarDocs .pbar-doc")];
    expect(docs.map((b) => b.textContent)).toEqual(["Plaquette", "Notice", "Plans · 18"]);
    expect(docs[0].disabled, "le document affiché est marqué, pas proposé").toBe(true);
    expect(sw.getAttribute("aria-expanded")).toBe("true");
    expect(recus.map((m) => m && m.type), "aucun sélecteur demandé à l'hôte").not.toContain("3dd-doc-present-switch");
    docs[1].click(); await vider();
    expect(recus).toContainEqual({ type: "3dd-doc-host-action", id: "doc:b" });
    expect(document.getElementById("pbar").style.display, "le panneau se referme").toBe("none");
  });

  it("le panneau dit qui présente : le nom, et la photo seulement en https", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1", by: "Julien Arthapignet", av: "https://exemple.supabase.co/storage/v1/object/public/photos/j.jpg" } });
    document.getElementById("presentBtn").click(); await vider(); await vider();
    const qui = document.getElementById("pbarQui");
    expect(qui.textContent).toBe("Julien Arthapignet");
    expect(qui.querySelector("img").getAttribute("src")).toMatch(/^https:\/\/exemple\.supabase\.co\//);
    await monter({ query: { gabarit: "lecture", embed: "1", by: "Julien", av: "javascript:alert(1)" } });
    document.getElementById("presentBtn").click(); await vider(); await vider();
    expect(document.getElementById("pbarQui").querySelector("img")).toBeNull();
  });
});

// « TERMINER » APRÈS UNE CONDUITE CONFIÉE (13/11/2026, essai de Julien) : « ça n'a pas coupé côté client, et ça laisse
// direct de mon côté ». Ce banc rejoue le chemin exact : start nommé, présentation confiée par l'hôte, puis Terminer.
describe("⚠️ 13/11 — Terminer une présentation confiée par l'hôte", () => {
  let fetchOrigine, appels;
  beforeEach(() => {
    fetchOrigine = window.fetch; appels = [];
    window.fetch = (url, init) => {
      const corps = init && init.body ? JSON.parse(init.body) : {};
      appels.push(corps.action || String(url));
      const rep = String(url).includes("state=1") ? { ok: true, state: { active: false } } : { ok: true, seq: 0 };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rep) });
    };
  });
  afterEach(() => { window.fetch = fetchOrigine; });

  it("la fin part avec le jeton confié, la barre se range, et l'hôte l'apprend", async () => {
    await monter({ query: { gabarit: "lecture", embed: "1" } });
    await envoyer({ type: "chrome", presenter: ["start", "switch"] });
    document.getElementById("presentBtn").click(); await vider();
    await envoyer({ type: "present-attach", slug: "srv123", control: "k".repeat(32) });
    await vider();
    expect(document.getElementById("gDirectBtn").hidden).toBe(false);
    document.getElementById("gDirectBtn").click();
    recus.length = 0;
    document.getElementById("pbarEnd").click();
    for (let i = 0; i < 6; i += 1) await vider();
    expect(appels).toContain("present-end");
    expect(document.getElementById("pbarErr").textContent).toBe("");
    expect(document.getElementById("gDirectBtn").hidden, "« En direct » disparaît").toBe(true);
    expect(document.body.classList.contains("g-direct")).toBe(false);
    expect(recus).toContainEqual({ type: "3dd-doc-present-ended", slug: "srv123" });
  });
});
