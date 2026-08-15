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

// ⚠️ LA GARDE QUI MANQUAIT, ET QUI A COÛTÉ UNE VERSION.
//
// En 0.1.25, une insertion a produit `return var h2={…}` dans le script en ligne. Le bloc entier ne
// se parsait plus — la couche live était morte : ni chat, ni présence, ni relecture d'état. La
// version est partie sur npm avec ce défaut.
//
// Ce fichier avait pourtant un test qui EXÉCUTE la page… et qui avale l'erreur, parce que son
// `catch` est là pour les scripts dont les dépendances (pdf.js) manquent hors navigateur. Une
// SyntaxError passait par la même porte que la dépendance absente.
//
// D'où la séparation : ANALYSER ne doit jamais échouer, EXÉCUTER a le droit. `new vm.Script` ne
// fait que compiler — pas besoin de dépendances pour dire qu'un fichier est du JavaScript valide.
//
// ⚠️ C'est un test du STUDIO qui l'a trouvé, en rendant la page depuis le paquet installé. Le
// player, lui, ne l'avait pas — le même déséquilibre qu'en 0.1.20, où un hôte avait rattrapé une
// régression que ce dépôt ne voyait pas. On rapatrie la garde ici, à la source.
describe("le script en ligne est du JavaScript valide", () => {
  const vm = require("node:vm");

  it("chaque bloc se compile — la question est posée AVANT toute dépendance", async () => {
    const html = await pageAudience();
    const blocs = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1]).filter((c) => c.trim());
    expect(blocs.length, "il doit bien y avoir du script à vérifier").toBeGreaterThan(0);
    for (const code of blocs) {
      expect(() => new vm.Script(code), "un bloc ne se parse pas : toute la couche live tombe avec")
        .not.toThrow();
    }
  });
});

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
