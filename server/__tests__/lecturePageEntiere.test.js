// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LIRE UN DOCUMENT : LA PAGE ENTIÈRE D'ABORD, ET UNE NAVIGATION POUR TOUS (#593).
//
// ⚠️ CE QUI A ÉTÉ CONSTATÉ CHEZ UN HÔTE, LE 11/11/2026. Une plaquette paysage de 21 pages, ouverte en
// surimpression : la largeur suivait le cadre sans regarder la hauteur, la couverture était coupée à
// mi-hauteur sous une étiquette « 100 % ». Une seule touche était écoutée (Échap, et seulement
// encadrée), les flèches n'existaient qu'avec l'assistant, et « Page 1 / 21 » ne se cliquait pas.
//
// Ce banc fait tourner la VRAIE page servie par la route d'aperçu, avec un pdf.js de laboratoire.
// Dimensions qu'il FAIT VARIER : `?fit=` (absent, auto, page, width, inconnu), le format de la première
// page (paysage, portrait), la cible d'une touche (document, champ, bouton). Dimensions qu'il TIENT
// FIXES : un cadre de 900 × 500, aucun greffon assistant, le chemin d'aperçu (le lien tracé passe par
// la même fonction `ajustementDemande`, mais ce banc ne le sert pas), et jsdom — qui ne fait ni mise en
// page ni défilement réel : la page demandée est relevée par une doublure de `scrollIntoView`.

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
const PORTRAIT = { width: 778, height: 1100 };
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

const largeurPage = () => parseInt(document.querySelector("#pages .page").style.width, 10);
const touche = (key, cible = document.body, opts = {}) => {
  const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  cible.dispatchEvent(e);
  return e;
};
const attendre = () => new Promise((r) => setTimeout(r, 40)); // le report de page de la construction vaut 30 ms

describe("⚠️ #593 — la page entière à l'ouverture", () => {
  it("sans ?fit= : rien ne change, la page paysage suit la largeur — et déborde", async () => {
    const V = await monter();
    expect(V.ajustement).toBe("largeur");
    expect(largeurPage() * (PAYSAGE.height / PAYSAGE.width), "c'est ce débordement que #593 décrit").toBeGreaterThan(HAUTEUR_CADRE);
    expect(document.body.classList.contains("fit-page")).toBe(false);
  });

  it("?fit=auto sur un paysage : la page tient dans la hauteur du cadre", async () => {
    const V = await monter({ query: { fit: "auto" } });
    expect(V.ajustement).toBe("page");
    expect(largeurPage() * (PAYSAGE.height / PAYSAGE.width)).toBeLessThanOrEqual(HAUTEUR_CADRE);
    expect(document.body.classList.contains("fit-page")).toBe(true);
  });

  it("?fit=auto sur un portrait de plusieurs pages : la largeur, comme avant", async () => {
    const V = await monter({ query: { fit: "auto" }, vp: PORTRAIT });
    expect(V.ajustement).toBe("largeur");
  });

  it("une valeur hors liste vaut absence, côté serveur comme côté page", async () => {
    const V = await monter({ query: { fit: "PAGE" } });
    expect(V.ajustement).toBe("largeur");
    expect(await htmlApercu({ fit: "<script>" }), "rien de la valeur reçue ne repart dans la page").not.toContain("<script>\"");
  });
});

describe("⚠️ #593 — le clavier", () => {
  it("→ et ← tournent la page, quel que soit l'ajustement", async () => {
    await monter();
    await attendre(); demandees.length = 0;
    expect(touche("ArrowRight").defaultPrevented).toBe(true);
    expect(demandees).toEqual([2]);
  });

  it("Fin et Début vont aux bornes", async () => {
    await monter();
    await attendre(); demandees.length = 0;
    touche("End"); touche("Home");
    expect(demandees).toEqual([21, 1]);
  });

  // En largeur, une page ne tient pas à l'écran : sauter à la suivante ferait passer la moitié non lue.
  it("Espace ne tourne la page qu'en page entière ; en largeur, il fait défiler d'un écran", async () => {
    await monter();
    await attendre(); demandees.length = 0;
    const scroll = document.getElementById("scroll");
    expect(touche(" ", scroll).defaultPrevented, "dans le document : le navigateur s'en charge").toBe(false);
    // ⚠️ Hors du document (à l'ouverture, après un clic sur la barre), Espace ne faisait RIEN : c'est
    // #scroll qui défile, pas la page. Constaté dans Chrome le 11/11 sur une notice portrait.
    const avant = scroll.scrollTop;
    expect(touche(" ").defaultPrevented).toBe(true);
    expect(scroll.scrollTop - avant, "un écran, moins un recouvrement").toBe(HAUTEUR_CADRE - 40);
    expect(demandees, "aucun saut de page en largeur").toEqual([]);
    await monter({ query: { fit: "page" } });
    await attendre(); demandees.length = 0;
    expect(touche(" ").defaultPrevented).toBe(true);
    expect(demandees).toEqual([2]);
  });

  it("rien n'est pris dans un champ, ni avec une touche de modification", async () => {
    await monter({ query: { fit: "page" } });
    await attendre(); demandees.length = 0;
    const champ = document.createElement("input");
    document.body.appendChild(champ);
    expect(touche("ArrowRight", champ).defaultPrevented).toBe(false);
    expect(touche("ArrowRight", document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(touche("End", document.body, { metaKey: true }).defaultPrevented).toBe(false);
    expect(demandees).toEqual([]);
  });

  // ⚠️ Sinon on ne pourrait plus voir la moitié droite d'un plan agrandi.
  it("← / → reviennent au défilement horizontal quand la page déborde du cadre", async () => {
    await monter({ query: { fit: "page" } });
    await attendre(); demandees.length = 0;
    Object.defineProperty(document.getElementById("scroll"), "scrollWidth", { value: LARGEUR_CADRE * 2, configurable: true });
    expect(touche("ArrowRight").defaultPrevented).toBe(false);
    expect(demandees).toEqual([]);
  });

  it("+ et − zooment, 0 revient à l'ajustement d'ouverture", async () => {
    await monter({ query: { fit: "page" } });
    const avant = largeurPage();
    touche("+");
    expect(largeurPage()).toBeGreaterThan(avant);
    touche("0");
    expect(largeurPage()).toBe(avant);
  });
});

describe("⚠️ #593 — flèches et aller à une page", () => {
  it("les flèches existent hors assistant et tournent la page", async () => {
    await monter({ query: { fit: "auto" } });
    await attendre(); demandees.length = 0;
    expect(document.body.classList.contains("multi")).toBe(true);
    const prec = document.getElementById("navPrev");
    expect(prec.disabled, "page 1 : rien avant").toBe(true);
    document.getElementById("navNext").click();
    expect(demandees).toEqual([2]);
  });

  it("« Page 1 / 21 » se clique, et Entrée va à la page saisie", async () => {
    await monter();
    await attendre(); demandees.length = 0;
    document.getElementById("pg").click();
    const champ = document.getElementById("pgIn");
    expect(champ, "le champ remplace le bouton").toBeTruthy();
    champ.value = "14";
    touche("Enter", champ);
    expect(demandees).toEqual([14]);
    expect(document.getElementById("pgIn")).toBeNull();
  });

  // ⚠️ La surimpression écoute Échap sur `document` : sans arrêt de propagation, annuler une saisie
  // refermait tout le player.
  it("Échap dans le champ annule la saisie sans remonter jusqu'au document", async () => {
    await monter({ query: { embed: "1" } });
    let echapAuDocument = 0;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") echapAuDocument += 1; });
    document.getElementById("pg").click();
    touche("Escape", document.getElementById("pgIn"));
    expect(document.getElementById("pgIn")).toBeNull();
    expect(echapAuDocument).toBe(0);
  });
});
