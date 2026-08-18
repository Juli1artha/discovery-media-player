// QUATRE PRÉSENTATIONS « ACTIVES » PENDANT TROIS JOURS, ET PERSONNE POUR LE VOIR.
//
// Chez le second hôte, chaque clôture échouait (marqueur d'archive NOT NULL, migration 0008) — et
// RIEN ne le disait : le catch de la route avalait l'erreur sans la journaliser, et la purge des
// périmées ne tournait que si quelqu'un ouvrait le panneau des présentations. Un échec de clôture
// ne prive de rien qu'on regarde : son succès ne produit rien, donc son échec non plus.

const presentations = require("../presentations.js");

describe("la purge ne dépend plus de l'ouverture d'un panneau", () => {
  function base() {
    const etat = { patches: [], inserts: 0 };
    presentations.init({
      errors: { capture() {} },
      db: {
        async request(chemin, o) {
          if (o && o.method === "PATCH") { etat.patches.push(chemin); return []; }
          if (o && o.method === "POST") { etat.inserts += 1; return []; }
          return [];
        },
      },
    });
    return etat;
  }

  it("démarrer une présentation purge les orphelines d'avant", async () => {
    const b = base();
    await presentations.createPresentation({ fileUrl: "https://exemple.fr/d.pdf", owner: { email: "a@x.fr" } });
    const purge = b.patches.find((c) => c.includes("active=eq.true") && c.includes("last_seen=lte."));
    expect(purge, "sans purge au démarrage, une orpheline attend qu'on ouvre un panneau").toBeTruthy();
    expect(b.inserts, "et la présentation démarre bel et bien").toBe(1);
  });

  // ⚠️ La purge est un service, jamais un préalable : une base qui refuse la purge ne doit pas
  // empêcher de PRÉSENTER — sinon on a échangé une orpheline invisible contre une panne visible.
  it("une purge qui échoue n'empêche pas de démarrer", async () => {
    const etat = { inserts: 0 };
    presentations.init({
      errors: { capture() {} },
      db: {
        async request(chemin, o) {
          if (o && o.method === "PATCH") throw new Error("base grognon");
          if (o && o.method === "POST") { etat.inserts += 1; return []; }
          return [];
        },
      },
    });
    const r = await presentations.createPresentation({ fileUrl: "https://exemple.fr/d.pdf", owner: {} });
    expect(r.slug).toBeTruthy();
    expect(etat.inserts).toBe(1);
  });

  it("la purge est CONDITIONNÉE : une session qui vient de battre n'est pas visée", async () => {
    const b = base();
    await presentations.purgerPerimees(Date.now());
    const chemin = b.patches[0];
    expect(chemin).toContain("active=eq.true");
    expect(chemin, "sans borne sur last_seen, la purge éteint aussi les vivantes").toContain("last_seen=lte.");
  });
});

describe("un échec de la route de clôture laisse une trace", () => {
  it("le catch journalise au lieu d'avaler", async () => {
    const ID = require.resolve("../presentations.js");
    const vraies = require("../presentations.js");
    require.cache[ID] = { id: ID, filename: ID, loaded: true,
      exports: { ...vraies, endPresentation: async () => { throw new Error("23502: not null"); } } };
    delete require.cache[require.resolve("../handler.js")];
    const player = require("../handler.js");

    const captures = [];
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } },
      mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { capture(e, ctx) { captures.push({ message: String(e && e.message), ctx }); } },
      legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
    });

    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler(
      { method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {},
        body: { action: "present-end", slug: "Ab3-_xYz9012", control: "jeton" } },
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(captures, "trois jours d'échecs sans une ligne nulle part : le catch doit parler").toHaveLength(1);
    expect(captures[0].message).toContain("23502");
    expect(captures[0].ctx.route).toBe("present-end");

    // remettre le vrai module pour les autres fichiers d'essais
    require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: vraies };
    delete require.cache[require.resolve("../handler.js")];
  });
});
