// @vitest-environment jsdom
//
// L'AUDIENCE DOIT VRAIMENT ÊTRE BRANCHÉE SUR L'ÉTAT DU PRÉSENTATEUR.
//
// ⚠️ Ce test existe à cause d'une panne en production. `appliquerEtat` était défini dans un bloc
// de script, et l'abonnement à la diffusion écrit dans le SUIVANT — autre portée. La référence
// n'existait pas, la ReferenceError partait dans un try/catch muet, et l'audience n'avait aucun
// écouteur d'état. Invisible pendant tout le temps où une seconde voie (lecture de table) portait
// la page ; « les pages ne tournent plus » le jour où on l'a retirée pour fermer une fuite.
//
// La leçon : deux voies qui font la même chose ne se valident pas l'une l'autre. Tant que la
// seconde existait, aucun test ne pouvait dire laquelle marchait. On exécute donc la page.

// ⚠️ AVANT de requérir le gestionnaire : il déstructure ses dépendances au chargement, donc une
// substitution plus tardive n'aurait aucun effet — il partirait chercher la vraie base.
const PRESENTATION_ID = require.resolve("../presentations.js");
const vraiesPresentations = require("../presentations.js");
const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  current_page: 1, active: true, updated_at: "2026-08-13T00:00:00.000Z",
};
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraiesPresentations, getPresentation: async () => ({ ...PRESENTATION }), listMessages: async () => [] },
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

describe("page audience", () => {
  it("expose vraiment le gestionnaire que la couche live doit brancher", async () => {
    const html = await pageAudience();

    // ⚠️ On EXÉCUTE la page. Le test statique ne pouvait pas voir le défaut : le code fautif
    // contenait bien l'appel à onState — il référençait simplement un nom absent de cette
    // portée-là. Seule l'exécution distingue « écrit » de « branché ».
    window.supabase = { createClient: () => ({ channel: () => { const c = { on: () => c, subscribe: () => c }; return c; } }) };
    for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      // `window.eval` et pas `new Function` : les scripts déclarent des `var` au niveau global,
      // qu'une portée de fonction rendrait invisibles au bloc suivant — c'est exactement le
      // genre de nuance de portée qui a produit le bug.
      try { window.eval(m[1]); } catch { /* les scripts qui dépendent de pdf.js ne nous intéressent pas */ }
    }

    expect(typeof window.__presAppliquerEtat,
      "le gestionnaire d'état n'est pas exposé : la couche live, définie dans un autre bloc, ne peut pas le brancher")
      .toBe("function");
  });

  it("branche ce gestionnaire-là, et pas un nom hors de portée", async () => {
    const html = await pageAudience();
    expect(html).toContain("Live.onState(window.__presAppliquerEtat)");
  });

  // Il ne doit plus rester une seule voie qui exige une table lisible publiquement.
  it("n'ouvre aucun abonnement à une table", async () => {
    expect(await pageAudience()).not.toContain("postgres_changes");
  });

  // Un câblage raté doit se dire. C'est le silence, pas le bug, qui a coûté la journée.
  it("crie si la couche live manque, au lieu d'avaler l'erreur", async () => {
    expect(await pageAudience()).toContain("console.error('[present]");
  });
});
