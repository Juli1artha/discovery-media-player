// LE GESTIONNAIRE NE DOIT DÉPENDRE D'AUCUNE PLATEFORME.
//
// Le README promet « Vercel, Next.js, Express, ou le serveur HTTP de Node — le même gestionnaire ».
// C'était vrai à une convention près, jamais écrite : il lisait `req.query`, que les plateformes
// serverless et Express remplissent, mais qu'un serveur HTTP nu laisse indéfini.
//
// ⚠️ ET LE SYMPTÔME ÉTAIT LE PIRE POSSIBLE. Sans paramètres, la requête cherchait un partage nommé
// « rien » et rendait « Ce lien n'est plus valide ou a été révoqué ». Un intégrateur voyait un
// REFUS là où il lui manquait un branchement — l'inversion exacte qu'on passe notre temps à
// corriger. Signalé par un hôte qui montait le player sur http.createServer : chez lui, ça aurait
// marché en production par chance, pas par construction.

const player = require("../handler.js");

function contexteMinimal() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => false, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "", supabasePublishableKey: "", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function appel(req) {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({ method: "GET", headers: {}, socket: {}, ...req }, res);
  return res;
}

describe("d'où viennent les paramètres", () => {
  // La convention serverless : la plateforme a déjà analysé l'URL.
  it("utilise req.query quand la plateforme le fournit", async () => {
    const res = await appel({ query: { contract: "1" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).contract).toBe(1);
  });

  // ⚠️ Le cas qui produisait « lien révoqué ». Un serveur HTTP nu ne remplit pas req.query.
  it("les retrouve dans req.url quand elle ne le fournit pas", async () => {
    const res = await appel({ url: "/api/doc?contract=1" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).contract).toBe(1);
  });

  it("ne se laisse pas troubler par une URL absurde", async () => {
    const res = await appel({ url: "pas une url du tout" });
    expect(res.statusCode).toBe(400);
  });
});

describe("quand rien n'est demandé", () => {
  // ⚠️ LE POINT. Ni slug, ni présentation, ni aperçu : il n'y a rien à afficher, et ce n'est PAS
  // un refus. Rendre la page de révocation envoyait l'intégrateur chercher un lien mort.
  it("le dit, au lieu d'afficher « lien révoqué »", async () => {
    const res = await appel({ query: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Aucun document demandé");
    expect(res.body).not.toContain("révoqué");
  });

  it("oriente vers la cause réelle : les paramètres de requête", async () => {
    expect((await appel({ query: {} })).body).toMatch(/paramètres de requête/);
  });

  // Un slug inconnu, LUI, est bien un refus : la distinction doit rester nette dans les deux sens.
  it("un slug inconnu reste un refus, pas une erreur de branchement", async () => {
    const res = await appel({ query: { slug: "Inconnu-1234" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("révoqué");
  });
});
