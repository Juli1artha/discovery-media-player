// @vitest-environment jsdom
//
// LES VIGNETTES PDF DU CHAT SONT BORNÉES, MUTUALISÉES ET PARESSEUSES (audit externe).
//
// ⚠️ Quatre défauts tenaient dans une seule ligne : cache SANS LIMITE de data-URL (du base64 gardé
// en mémoire, ~1,33× le binaire), aucun partage entre deux messages portant le MÊME PDF, aucun
// `pdf.destroy()` (le worker gardait le document entier pour une vignette de 208 px), et un
// chargement AU RENDU plutôt qu'à l'affichage — un fil de deux cents pièces jointes chargeait deux
// cents documents.
//
// ⚠️ COMMENT CE BANC ATTEINT DU CODE ENFERMÉ DANS UNE IIFE. On n'expose rien en production : on
// ajoute, à l'exécution, une ligne qui EXPORTE des liaisons déjà existantes. Elle ne peut pas
// changer un comportement — mais elle peut ne pas s'appliquer, et le test serait alors vide. Le
// premier essai vérifie donc que le crochet existe : sans lui, tout le reste ne prouverait rien.

const { LIVE_JS } = require("../gabarit-live.js");

const CROCHET = ";try{window.__vignEssai={pdfThumb:pdfThumb,cache:vignUrl,ordre:vignOrdre,enVol:vignEnVol,plafond:VIGN_MAX};}catch(e){}";

function fauxPdfjs(journal) {
  return {
    getDocument(o) {
      journal.chargements.push(o.url);
      const pdf = {
        destroy() { journal.detruits += 1; },
        getPage: () => Promise.resolve({
          getViewport: () => ({ width: 400, height: 560 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      };
      return { promise: Promise.resolve(pdf) };
    },
  };
}

function poser() {
  const journal = { chargements: [], detruits: 0, revoques: [] };
  document.body.innerHTML = '<div id="chatMsgs"></div>';
  window.pdfjsLib = fauxPdfjs(journal);
  let n = 0;
  window.URL.createObjectURL = () => "blob:essai/" + (++n);
  window.URL.revokeObjectURL = (u) => journal.revoques.push(u);
  // jsdom n'implémente pas toBlob ni getContext : on les fournit, sinon rien ne se rend.
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb({ size: 10 }); };
  // Observateur d'intersection minimal : on garde la main pour déclencher l'entrée dans le champ.
  const observes = [];
  window.IntersectionObserver = function (cb) {
    this.observe = (el) => observes.push({ el, cb });
    this.unobserve = (el) => { const i = observes.findIndex((o) => o.el === el); if (i >= 0) observes.splice(i, 1); };
    this.disconnect = () => { observes.length = 0; };
  };
  const corps = LIVE_JS.replace(/\n  return \{connect:connect/, CROCHET + "\n  return {connect:connect");
  window.eval(corps);
  return { journal, observes, api: window.__vignEssai };
}

/** Fabrique un emplacement de vignette et le fait entrer dans le champ de vision. */
function vignette(ctx, url) {
  const ph = document.createElement("span");
  ph.className = "cm-att-ph";
  document.getElementById("chatMsgs").appendChild(ph);
  ctx.api.pdfThumb(url, ph);
  return ph;
}
const entrer = (ctx) => { for (const o of [...ctx.observes]) o.cb([{ isIntersecting: true, target: o.el }]); };
const tour = () => new Promise((r) => setTimeout(r, 0));

describe("vignettes PDF du chat", () => {
  it("le crochet d'essai existe — sinon tout ce fichier ne prouverait rien", () => {
    const ctx = poser();
    expect(ctx.api, "l'injection n'a pas pris : le motif du `return` a changé").toBeTruthy();
    expect(typeof ctx.api.pdfThumb).toBe("function");
    expect(ctx.api.plafond, "un plafond doit exister").toBeGreaterThan(0);
  });

  // ⚠️ LE CŒUR : rien ne part tant que la pièce jointe n'approche pas du viewport.
  it("PARESSEUX : poser cent vignettes ne charge aucun document", async () => {
    const ctx = poser();
    for (let i = 0; i < 100; i++) vignette(ctx, "https://x/doc" + i + ".pdf");
    await tour();
    expect(ctx.journal.chargements.length,
      "un fil ancien chargeait autant de documents que de pièces jointes rendues").toBe(0);
  });

  it("MUTUALISÉ : deux messages portant le MÊME PDF ne le chargent qu'une fois", async () => {
    const ctx = poser();
    vignette(ctx, "https://x/meme.pdf"); vignette(ctx, "https://x/meme.pdf");
    entrer(ctx);
    for (let i = 0; i < 8; i++) await tour();
    expect(ctx.journal.chargements.filter((u) => u === "https://x/meme.pdf").length).toBe(1);
  });

  it("LIBÉRÉ : le document est détruit une fois la vignette faite", async () => {
    const ctx = poser();
    vignette(ctx, "https://x/un.pdf");
    entrer(ctx);
    for (let i = 0; i < 8; i++) await tour();
    expect(ctx.journal.detruits,
      "sans destroy(), le worker garde le document ENTIER pour une vignette de 208 px").toBe(1);
  });

  it("BORNÉ : au-delà du plafond, les plus anciennes URL objet sont révoquées", async () => {
    const ctx = poser();
    const n = ctx.api.plafond + 6;
    for (let i = 0; i < n; i++) {
      vignette(ctx, "https://x/d" + i + ".pdf");
      entrer(ctx);
      for (let k = 0; k < 6; k++) await tour();
    }
    expect(ctx.api.ordre.length, "le cache dépasse son plafond").toBeLessThanOrEqual(ctx.api.plafond);
    expect(ctx.journal.revoques.length,
      "les URL objet évincées ne sont pas révoquées : le binaire reste retenu par le navigateur")
      .toBeGreaterThanOrEqual(n - ctx.api.plafond);
  });

  // ⚠️ Révoquer une URL encore affichée VIDE l'image. L'éviction doit remettre la vignette en
  // réserve, pas laisser une case blanche dans le fil.
  it("une vignette dont l'URL est révoquée est remise en réserve, pas laissée vide", async () => {
    const ctx = poser();
    const premier = vignette(ctx, "https://x/premier.pdf");
    entrer(ctx);
    for (let k = 0; k < 6; k++) await tour();
    expect(premier.querySelector("img"), "la première vignette doit être posée").toBeTruthy();
    for (let i = 0; i < ctx.api.plafond + 2; i++) {
      vignette(ctx, "https://x/suite" + i + ".pdf");
      entrer(ctx);
      for (let k = 0; k < 6; k++) await tour();
    }
    // ⚠️ LA VRAIE PROPRIÉTÉ N'EST PAS « l'image disparaît » — ma première assertion visait cet état
    // INTERMÉDIAIRE, et elle échouait sur du code correct : évincée, la vignette repasse en réserve,
    // est ré-observée, et se recharge dès qu'elle revient dans le champ. Ce qu'il faut interdire,
    // c'est qu'une image AFFICHÉE pointe une URL RÉVOQUÉE — le seul état où le lecteur voit blanc.
    const revoquees = new Set(ctx.journal.revoques);
    const affichees = [...document.querySelectorAll(".cm-att-ph img")].map((i) => i.src);
    expect(affichees.length, "aucune vignette affichée : la mesure ne mesure rien").toBeGreaterThan(0);
    expect(affichees.filter((u) => revoquees.has(u)),
      "une image affichée pointe une URL objet révoquée : elle serait vide chez le lecteur")
      .toEqual([]);
  });
});
