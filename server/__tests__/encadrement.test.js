// TOUTE PAGE QU'UN HÔTE PEUT INTÉGRER DOIT ÊTRE ENCADRABLE PAR CET HÔTE.
//
// ⚠️ C'est la seule panne qu'un hôte ne peut PAS diagnostiquer : le navigateur bloque l'iframe
// avant tout script, donc rien ne peut lui être émis — ni `embed-denied`, ni erreur. Il voit un
// silence, indiscernable d'une instance injoignable, et son repli ouvre le document ailleurs.
//
// Trouvé deux fois en deux jours, sur deux pages différentes. La première fois par l'absence de
// DOC_FRAME_ANCESTORS, la seconde par un `'self'` écrit EN DUR dans la branche de l'aperçu — vrai
// tant que l'application et le player partagent un déploiement, faux dès qu'une instance est
// séparée, et rien ne le signalait. Conséquence absurde relevée par l'hôte : la page de REFUS
// était encadrable chez lui, pas la page de SUCCÈS. Le chemin d'erreur était plus portable que le
// chemin nominal.

const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  current_page: 1, active: true, updated_at: "2026-08-13T00:00:00.000Z",
};
const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => ({ ...PRESENTATION }), listMessages: async () => [] } };

// ⚠️ APRÈS le double, jamais avant : le gestionnaire déstructure ses dépendances au chargement,
// une substitution plus tardive n'aurait aucun effet.
const player = require("../handler.js");

const HOTE = "https://app.exemple.fr";

function contexte(ancetres) {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"), async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: ancetres },
  };
}

async function csp(query, ancetres = [HOTE]) {
  process.env.DOC_FRAME_ANCESTORS = ancetres.join(" ");
  player.init(contexte(ancetres));
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query }, res);
  const h = res.headers["content-security-policy"] || "";
  return { statut: res.statusCode, ancetres: (h.match(/frame-ancestors ([^;]*)/) || [])[1] || "", corps: res.body };
}

const APERCU = { preview: "1", url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf", name: "demo.pdf" };

describe("aperçu interne", () => {
  it("accepte l'hôte configuré quand il est intégré", async () => {
    const r = await csp({ ...APERCU, embed: "1" });
    expect(r.statut).toBe(200);
    expect(r.ancetres, "l'hôte configuré doit pouvoir encadrer l'aperçu").toContain(HOTE);
  });

  // Hors intégration, rien ne change : un aperçu autonome n'a aucune raison d'être encadré.
  it("reste en même origine quand il ne l'est pas", async () => {
    const r = await csp(APERCU);
    expect(r.ancetres.trim()).toBe("'self'");
  });
});

describe("page d'audience", () => {
  // Elle ne passait AUCUN paramètre : `frame-ancestors 'none'`, encadrable par personne.
  it("accepte l'hôte configuré quand elle est intégrée", async () => {
    const r = await csp({ present: PRESENTATION.slug, embed: "1" });
    expect(r.statut).toBe(200);
    expect(r.ancetres).toContain(HOTE);
  });

  it("reste inencadrable sinon — c'est une page publique", async () => {
    const r = await csp({ present: PRESENTATION.slug });
    expect(r.ancetres.trim()).toBe("'none'");
  });
});

describe("le chemin nominal est au moins aussi portable que le chemin d'erreur", () => {
  // ⚠️ LE TEST QUI AURAIT ÉVITÉ TOUT ÇA. Un refus encadrable devant une réussite qui ne l'est pas
  // est un signe : on a corrigé l'exception sans corriger la règle.
  it("succès et refus acceptent les mêmes hôtes", async () => {
    const succes = await csp({ ...APERCU, embed: "1" });
    const refus = await csp({ preview: "1", url: "https://ailleurs.example/x.pdf", name: "x.pdf", embed: "1" });
    expect(refus.statut).toBe(404);
    for (const origine of [HOTE, "'self'"]) {
      expect(succes.ancetres, `succès : ${origine}`).toContain(origine);
      expect(refus.ancetres, `refus : ${origine}`).toContain(origine);
    }
  });
});

describe("carte d'identité", () => {
  // Un booléen ne suffisait pas : un hôte doit voir que SON domaine manque, sans ouvrir un document.
  it("dit POUR QUELLES origines l'instance accepte d'être encadrée", async () => {
    const r = await csp({ contract: "1" });
    const carte = JSON.parse(r.corps);
    expect(carte.frameAncestors).toContain(HOTE);
    expect(carte.frameAncestors).toContain("'self'");
  });

  it("le dit aussi quand rien n'est configuré — c'est justement le cas qui pose problème", async () => {
    const carte = JSON.parse((await csp({ contract: "1" }, [])).corps);
    expect(carte.frameAncestors).toEqual(["'self'", "https://*.vercel.app"]);
  });
});
