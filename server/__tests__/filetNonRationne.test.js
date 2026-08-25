// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// RATIONNER LE FILET AURAIT REMPLACÉ UN DÉNI DE SERVICE PAR UN AUTRE.
//
// Le budget de relecture ferme la porte par laquelle un diffuseur hostile faisait relire toute une
// salle jusqu'au quota — et au-delà, jusqu'aux 429 qui arrêtaient leurs pages. Mais il ne doit gater
// que ce qui vient du CANAL.
//
// ⚠️ Deux appels, deux natures :
//
//   • `signaler()` est déclenché par une diffusion, donc par n'importe quel participant. C'est la
//     porte à rationner.
//   • `maintenant()` est le filet périodique, déclenché par NOUS toutes les 25 s. Le rationner
//     rendrait une audience à budget épuisé DÉFINITIVEMENT MUETTE : un participant hostile n'aurait
//     eu qu'à vider le budget de chacun pour figer la salle, sans même toucher au serveur. On aurait
//     fermé une porte en en ouvrant une plus petite et plus sûre.
//
// C'est le plancher : quoi qu'il arrive, l'audience finit toujours par se resynchroniser.
//
// ⚠️ CETTE PROPRIÉTÉ NE SE VOIT PAS SUR LA FONCTION, SEULEMENT SUR LE CÂBLAGE. Un test unitaire du
// budget passerait avec un filet rationné. Il faut exécuter la page — c'est le bout-en-bout côté
// AUDIENCE que les trois audits réclament, ici sur le morceau qui vient d'être touché.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  current_page: 1, active: true, updated_at: "2026-08-16T00:00:00.000Z",
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

/** Les scripts en ligne, lus par le parseur du navigateur — jamais par une expression régulière. */
function scriptsDe(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("script")].map((s) => s.textContent || "");
}

async function pageAudience() {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: PRESENTATION.slug } }, res);
  return res.body;
}

/** Rend la page, l'exécute, et compte les relectures d'état qu'elle émet. */
async function audience() {
  const html = await pageAudience();
  document.documentElement.innerHTML = html;

  const lectures = [];
  window.fetch = (url) => {
    lectures.push(String(url));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, state: { active: true, current_page: 1 } }) });
  };
  window.supabase = { createClient: () => ({ channel: () => { const c = { on: () => c, subscribe: () => c, send: () => {}, track: () => {}, untrack: () => {}, unsubscribe: () => {} }; return c; } }) };

  for (const code of scriptsDe(html)) {
    try { window.eval(code + "\n;try{globalThis.Player=Player;}catch(e){}"); } catch { /* pdf.js n'est pas là */ }
  }
  // ⚠️ Toute la mécanique de relecture vit à l'intérieur de « connect() » : sans connexion, le
  // banc exécuterait la page sans jamais atteindre ce qu'il prétend tester. C'est ce qui a fait
  // échouer sa première version — « __presRelireEtat » restait indéfini, et un test qui n'atteint
  // pas son sujet ne dit rien.
  window.Live.connect(PRESENTATION.slug, { name: "Spectateur", email: "", avatar: "", role: "viewer", member: false }, null);
  return {
    /** Une diffusion reçue : c'est ce qu'un participant peut provoquer à volonté. */
    diffusion: () => { try { window.__presRelireEtat(); } catch { /* pas encore branché */ } },
    etats: () => lectures.filter((u) => u.includes("state=1")).length,
  };
}

describe("le filet de resynchronisation n'est jamais rationné", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("la page expose bien le déclencheur de relecture", async () => {
    await audience();
    expect(typeof window.__presRelireEtat, "sans lui le test ne prouverait rien").toBe("function");
  });

  // ⚠️ LE CŒUR DU TEST — ET SA PREMIÈRE VERSION NE MORDAIT PAS.
  //
  // Elle martelait, puis observait une accalmie de 60 s. Un filet rationné passait quand même : le
  // budget se recharge d'un jeton toutes les 5 s, le filet ne tourne que toutes les 25 s, donc il
  // trouve TOUJOURS un jeton après une pause. Le test décrivait la bonne propriété et ne la touchait
  // pas — quatrième banc de la journée dans ce cas.
  //
  // La condition qui sépare les deux mondes est le martèlement CONTINU : à ce moment-là, le budget
  // est vide chaque fois que le filet se présente.
  //
  // ⚠️ ET LE SEUIL EST MESURÉ, PAS DEVINÉ. Une heure de martèlement rend 884 relectures avec le
  // filet libre (720 de budget + 20 de rafale + 144 de filet) et exactement 740 s'il est rationné —
  // ses appels consomment alors les jetons du signal. On compare donc au budget signalé, qui est la
  // frontière réelle entre les deux comportements, et non à un nombre écrit à la main.
  it("sous martèlement continu, le filet passe quand même", async () => {
    const a = await audience();
    const C = window.Player.cadence;

    for (let i = 0; i < 1800; i++) { a.diffusion(); await vi.advanceTimersByTimeAsync(2000); }

    expect(a.etats(), "un filet rationné plafonnerait au budget du signal : l'audience se figerait "
      + "dès qu'un participant hostile le vide, sans qu'aucune erreur ne le dise")
      .toBeGreaterThan(C.PRESENT_SIGNAL_BUDGET_PER_HOUR + C.PRESENT_READ_BURST);

    expect(a.etats(), "et le total reste celui du modèle : budget + rafale + filet")
      .toBeLessThanOrEqual(C.PRESENT_SIGNAL_BUDGET_PER_HOUR + C.PRESENT_READ_BURST + C.RESYNC_READS_PER_HOUR);
  });

  // Et l'autre moitié : le martèlement, lui, doit bien être borné.
  it("le martèlement ne produit plus une relecture par diffusion", async () => {
    const a = await audience();
    for (let i = 0; i < 400; i++) { a.diffusion(); await vi.advanceTimersByTimeAsync(400); }
    expect(a.etats(), "c'était la porte : une relecture par signal, pour chaque spectateur")
      .toBeLessThan(200);
  });
});
