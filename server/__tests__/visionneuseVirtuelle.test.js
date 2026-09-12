// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE NOMBRE DE NOEUDS DE LA VISIONNEUSE EST BORNÉ, QUELLE QUE SOIT LA LONGUEUR DU DOCUMENT.
//
// ⚠️ LE PRÉSENTATEUR CRÉAIT UN ÉLÉMENT PAR PAGE ET UN BOUTON PAR VIGNETTE, POUR TOUT LE DOCUMENT.
// Mesuré par un audit externe dans un Chrome réel : 10 000 pages → ~70 000 nœuds, 50 000 → ~450 000,
// reconstruction au zoom 2,4 s. Un document hostile n'a pas besoin d'être lourd, il lui suffit
// d'être long.
//
// ⚠️ CE BANC COMPTE DES NŒUDS, JAMAIS DES MILLISECONDES — c'est la demande de l'audit, et c'est la
// règle de ce dépôt : un nombre qu'on ne peut pas reproduire n'a rien à faire dans un test. La borne
// vient de `Player.viewer.plafondFenetre`, calculée avec les mêmes constantes que le gabarit.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Long", file_name: "long.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/long.pdf",
  current_page: 1, active: true, updated_at: "2026-09-12T00:00:00.000Z",
};
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => ({ ...PRESENTATION }), listMessages: async () => [] },
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

async function htmlVisionneuse() {
  player.init(contexteMinimal());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  // ⚠️ LA ROUTE D'APERÇU, PAS `?present=` : c'est elle qui sert `page-visionneuse.js` (la page
  // d'audience a sa propre visionneuse, sans #scroll ni #vignIn — mesuré en cherchant les ids).
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: PRESENTATION.file_url, name: PRESENTATION.file_name } }, res);
  return res.body;
}

const TOTAL = 10000;
const VISIBLE_PAGES = 900, VISIBLE_VIGN = 700;

/** Un pdf.js de laboratoire : un document de 10 000 pages, livré tout de suite ; `jamais` = un document qui n'arrive jamais. */
function fauxPdfjs({ jamais = false, total = TOTAL } = {}) {
  const journal = { detruits: 0, pagesDemandees: [] };
  const page = {
    rotate: 0,
    getViewport: () => ({ width: 800, height: 1100, scale: 1 }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    getTextContent: () => Promise.resolve({ items: [] }),
  };
  const pdf = { numPages: total, destroy() { journal.detruits += 1; }, getPage: (n) => { journal.pagesDemandees.push(n); return Promise.resolve(page); } };
  return {
    journal,
    lib: {
      GlobalWorkerOptions: {},
      getDocument() { return { promise: jamais ? new Promise(() => {}) : Promise.resolve(pdf), destroy() { journal.detruits += 1; } }; },
    },
  };
}

function poserLeChamp(el, hauteur) {
  Object.defineProperty(el, "clientHeight", { value: hauteur, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 900, configurable: true });
  let st = 0;
  Object.defineProperty(el, "scrollTop", { get: () => st, set: (v) => { st = Math.max(0, Number(v) || 0); }, configurable: true });
}

async function monter(opts) {
  const html = await htmlVisionneuse();
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")]
    .map((s) => s.textContent || "").filter((c) => c.trim());
  const faux = fauxPdfjs(opts);
  window.pdfjsLib = faux.lib;
  window.PlayerBot = { init(v) { window.__V = v; } };            // la poignée de visionneuse, telle qu'offerte aux greffons
  window.HTMLCanvasElement.prototype.getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) });
  window.IntersectionObserver = function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; };
  poserLeChamp(document.getElementById("scroll"), VISIBLE_PAGES);
  poserLeChamp(document.getElementById("vignIn"), VISIBLE_VIGN);
  const exporter = ";try{if(typeof Player!=='undefined')window.Player=Player;}catch(e){}";
  // ⚠️ LA VISIONNEUSE CHARGE pdf.js PAR UN import() DE MODULE ES, qui échoue en jsdom et conduit à
  // refuserWorker() — donc jamais à start(). On substitue le faux À CET ENDROIT, par crochet de
  // source (même technique que vignettesChat.test.js), et on VÉRIFIE que la substitution a eu lieu :
  // sans elle, ce banc évaluerait une page qui ne démarre pas et ne prouverait rien.
  const CROCHET_IMPORT = "import(CFG.pdfjs)";
  let substitutions = 0;
  const echecs = [];
  for (const code of blocs) {
    const n = code.split(CROCHET_IMPORT).length - 1;
    substitutions += n;
    const prepare = n ? code.split(CROCHET_IMPORT).join("Promise.resolve(window.pdfjsLib)") : code;
    try { window.eval(prepare + exporter); } catch (e) { echecs.push(String((e && e.message) || e)); }
  }
  expect(substitutions, "le crochet de chargement de pdf.js doit exister, sinon la page ne démarre jamais ici").toBe(1);
  for (const m of echecs) expect(m, `un bloc de la page a échoué : ${m}`).not.toMatch(/is not defined|Unexpected|SyntaxError/);
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  return { faux, V: window.__V, viewer: window.Player.viewer };
}

const pages = () => document.querySelectorAll("#pages .page");
const vignettes = () => document.querySelectorAll("#vignIn .vg");

describe("⚠️ la visionneuse ne matérialise qu'une fenêtre de pages", () => {
  it("⚠️ 10 000 pages : le DOM en porte quelques-unes, pas dix mille", async () => {
    const { V, viewer } = await monter();
    expect(window.__n, "le document est bien chargé").toBe(TOTAL);
    expect(V, "la poignée de visionneuse doit être offerte").toBeTruthy();
    const premiere = pages()[0];
    expect(premiere, "au moins une page existe").toBeTruthy();
    const h = parseInt(premiere.style.height, 10);
    const plafond = viewer.plafondFenetre({ hauteurVisible: VISIBLE_PAGES, hauteurElement: h, ecart: 16, marge: 3 });
    expect(pages().length, `borne : ${plafond} pour ${TOTAL} pages`).toBeLessThanOrEqual(plafond);
    expect(pages().length).toBeGreaterThan(0);
    // ⚠️ BORNE DE COMPTE : avant + matérialisées + après = tout le document. Une grandeur bornée qui
    // sort de ses bornes est le seul témoin gratuit d'une définition.
    const f = V.fenetre;
    expect((f.debut - 1) + (f.fin - f.debut + 1) + (TOTAL - f.fin)).toBe(TOTAL);
    expect(document.getElementById("pagesAvant"), "l'espaceur du haut existe").toBeTruthy();
    expect(document.getElementById("pagesApres"), "l'espaceur du bas existe").toBeTruthy();
  });

  it("⚠️ aller à la page 5 000 la MATÉRIALISE, et la fenêtre reste bornée", async () => {
    const { V, viewer } = await monter();
    V.scrollToPage(5000);
    const el = document.querySelector('#pages .page[data-p="5000"]');
    expect(el, "la page demandée doit exister dans le DOM après le saut").toBeTruthy();
    const h = parseInt(el.style.height, 10);
    const plafond = viewer.plafondFenetre({ hauteurVisible: VISIBLE_PAGES, hauteurElement: h, ecart: 16, marge: 3 });
    expect(pages().length).toBeLessThanOrEqual(plafond);
    const f = V.fenetre;
    expect(f.debut).toBeLessThanOrEqual(5000);
    expect(f.fin).toBeGreaterThanOrEqual(5000);
    expect(document.querySelector('#pages .page[data-p="1"]'), "la page 1 est repartie : elle n'est qu'une hauteur").toBeNull();
    // Les pages matérialisées sont dans l'ordre, sans doublon.
    const nums = [...pages()].map((p) => +p.dataset.p);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("⚠️ les vignettes aussi : quelques boutons, pas dix mille, et celui de la page courante existe", async () => {
    const { V, viewer } = await monter();
    document.getElementById("vignBtn").click();
    expect(vignettes().length, "le panneau est construit").toBeGreaterThan(0);
    const hv = parseInt(vignettes()[0].style.height, 10) + 4;
    const plafond = viewer.plafondFenetre({ hauteurVisible: VISIBLE_VIGN, hauteurElement: hv, ecart: 10, marge: 4 });
    expect(vignettes().length, `borne : ${plafond} pour ${TOTAL} vignettes`).toBeLessThanOrEqual(plafond);
    V.showPage(5000);
    expect(document.querySelector('#vignIn .vg[data-p="5000"]'), "le panneau suit la page courante").toBeTruthy();
    expect(vignettes().length).toBeLessThanOrEqual(plafond);
    const fv = V.vignFenetre;
    expect((fv.debut - 1) + (fv.fin - fv.debut + 1) + (TOTAL - fv.fin)).toBe(TOTAL);
  });

  // ⚠️ L'AUTRE DEMANDE DE L'AUDIT : un document qui n'arrive jamais gardait son transfert et son
  // worker ouverts jusqu'à la fermeture de l'onglet. Un délai global, et destroy() quand il expire.
  // ⚠️ LA VIRTUALISATION BORNE LE DOM, PAS LA GÉOMÉTRIE — reproduit par un audit externe le 13/09 dans
  // Chrome réel : la hauteur de défilement sature à 33 554 432 px, et à 200 % la moitié d'un document
  // de 10 000 pages devient injoignable pendant que le nombre de nœuds reste parfaitement borné.
  // « 6 nœuds à 50 000 pages » était vrai et incomplet. jsdom n'a pas ce plafond : ces bancs éprouvent
  // ce que la visionneuse FAIT du calcul (src/viewer.ts), pas le plafond lui-même — lui vit dans le
  // banc navigateur réel.
  describe("⚠️ au-delà du plafond de défilement du navigateur, la visionneuse le DIT et s'arrête", () => {
    const GRAND = 50000;   // à ~1 254 px par page ici, la 26 7xxᵉ est la dernière sous 33 554 432 px

    it("le plafond est calculé, exposé, et l'avis est visible avec les deux nombres", async () => {
      const { V, viewer } = await monter({ total: GRAND });
      const h = parseInt(pages()[0].style.height, 10);
      const attendu = viewer.pagesAtteignables({ hauteurElement: h, ecart: 16, decalageHaut: 22, total: GRAND });
      expect(attendu, "contrôle positif : ce document DÉPASSE bien le plafond à cette géométrie").toBeLessThan(GRAND);
      expect(V.atteignables).toBe(attendu);
      const avis = document.getElementById("plafondAvis");
      expect(avis, "l'avis existe").toBeTruthy();
      expect(avis.style.display, "et il est visible").not.toBe("none");
      expect(avis.textContent).toContain(String(attendu));
      expect(avis.textContent).toContain(String(GRAND));
      expect(avis.getAttribute("role")).toBe("status");
    });

    it("⚠️ un saut au-delà s'arrête à la dernière page atteignable — jamais un défilement vers nulle part", async () => {
      const { V, viewer } = await monter({ total: GRAND });
      const n = V.atteignables;
      V.scrollToPage(GRAND);
      expect(document.querySelector('#pages .page[data-p="' + GRAND + '"]'), "la dernière page n'est PAS matérialisée : elle n'arrive jamais").toBeNull();
      expect(document.querySelector('#pages .page[data-p="' + n + '"]'), "la dernière ATTEIGNABLE l'est").toBeTruthy();
      const f = V.fenetre;
      expect(f.fin).toBeLessThanOrEqual(n);
      // ⚠️ LA PROPRIÉTÉ QUE LA FENÊTRE BORNÉE NE GARDE PAS SEULE : la position DEMANDÉE au conteneur. Sans
      // le plafond dans scrollToPage, on pose scrollTop = position(50 000) — jsdom l'accepte, Chrome la
      // sature à 33 554 432 et aligne n'importe quoi. Le saut doit demander la position de la dernière
      // atteignable, et rien au-delà du plafond. (Un mutant qui retire le plafond survivait sans ceci.)
      const h = parseInt(pages()[0].style.height, 10);
      const sc = document.getElementById("scroll");
      expect(sc.scrollTop, "la position demandée est celle de la dernière page atteignable").toBe(viewer.positionDe(n, { hauteurElement: h, ecart: 16, decalageHaut: 22 }));
      expect(sc.scrollTop + h).toBeLessThanOrEqual(viewer.PLAFOND_DEFILEMENT_PX);
      expect((f.debut - 1) + (f.fin - f.debut + 1) + Math.round(f.apres / (parseInt(pages()[0].style.height, 10) + 16)),
        "l'espace réservé s'arrête au plafond : avant + matérialisées + après = atteignables, pas le total").toBe(n);
    });

    it("un document sous le plafond n'a pas d'avis, et tout est atteignable", async () => {
      const { V } = await monter();
      expect(V.atteignables).toBe(TOTAL);
      const avis = document.getElementById("plafondAvis");
      expect(avis && avis.style.display, "pas d'avis quand rien n'est injoignable").toBe("none");
    });

    it("en mode une page, le défilement ne navigue pas : tout est atteignable et l'avis se retire", async () => {
      const { V } = await monter({ total: GRAND });
      expect(V.atteignables).toBeLessThan(GRAND);
      V.enterOnePage();
      expect(V.atteignables).toBe(GRAND);
      expect(document.getElementById("plafondAvis").style.display).toBe("none");
      V.showPage(GRAND);
      expect(document.querySelector('#pages .page[data-p="' + GRAND + '"]'), "une page à la fois : la 50 000ᵉ se montre").toBeTruthy();
    });
  });

  it("⚠️ un document qui n'arrive jamais est abandonné : destroy() et un message", async () => {
    vi.useFakeTimers();
    try {
      const html = await htmlVisionneuse();
      document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
      const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")]
        .map((s) => s.textContent || "").filter((c) => c.trim());
      const faux = fauxPdfjs({ jamais: true });
      window.pdfjsLib = faux.lib;
      window.IntersectionObserver = function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; };
      for (const code of blocs) { try { window.eval(code.split("import(CFG.pdfjs)").join("Promise.resolve(window.pdfjsLib)")); } catch { /* dépendances absentes */ } }
      await vi.advanceTimersByTimeAsync(119_000);
      expect(faux.journal.detruits, "avant l'échéance, rien n'est abandonné").toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(faux.journal.detruits, "à l'échéance, la tâche est détruite").toBe(1);
      expect(document.getElementById("lpct").textContent).toMatch(/trop longtemps/);
    } finally { vi.useRealTimers(); }
  });
});
