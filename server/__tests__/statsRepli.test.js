// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE REPLI DES STATISTIQUES EST ÉTROIT — ET C'EST TOUT CE QUI LE REND SÛR.
//
// ⚠️ DEPUIS LA 0022, L'AGRÉGATION SE FAIT EN BASE. Le chemin en mémoire reste, parce qu'un hôte
// n'applique pas forcément la dernière migration : `PGRST202` (« aucune fonction de ce nom ») fait
// retomber sur lui, et les chiffres sont les mêmes — le banc de base les confronte ligne à ligne.
//
// ⚠️ MAIS UN REPLI LARGE SERAIT PIRE QUE PAS DE REPLI DU TOUT. Si une base injoignable, un droit
// manquant ou un délai dépassé faisaient AUSSI retomber en mémoire, la lecture des lignes brutes
// échouerait à son tour — ou pire, rendrait un sous-ensemble — et le tableau de bord afficherait
// des chiffres calculés sur ce qui a bien voulu répondre. « Statistiques fausses » se lit
// exactement comme « statistiques » : personne ne va chercher une panne qu'aucun signal n'annonce.
// C'est la même règle étroite que le repli de la présence, et pour la même raison.

const shares = require("../shares.js");

const erreurPostgrest = (statut, message, details) => Object.assign(new Error(message), { statusCode: statut, details });

/** Un faux qui répond aux lectures de lignes, et laisse le banc décider du sort des `rpc/`. */
function base(surRpc) {
  const vus = [];
  const lignes = (c) => {
    if (c.startsWith("commercial_doc_shares")) return [{ slug: "s1", created_at: "2026-01-01T00:00:00Z" }];
    if (c.startsWith("commercial_doc_views")) return [{ slug: "s1", event: "open", page: 2, max_page: 2, seconds: 4, session_id: "x", at: "2026-08-01T10:00:00Z" }];
    return [];
  };
  return {
    vus,
    db: {
      async request(c, o) { vus.push(c); if (String(c).startsWith("rpc/")) return surRpc(c, o); return lignes(c); },
      async selectAll(c) { vus.push(c); return lignes(c); },
    },
  };
}

describe("ce qui fait retomber sur l'agrégation en mémoire", () => {
  it("⚠️ `PGRST202` : la migration n'est pas là, on agrège en mémoire et on rend les chiffres", async () => {
    const b = base(() => { throw erreurPostgrest(404, "Could not find the function", { code: "PGRST202" }); });
    shares.init({ db: b.db });
    const r = await shares.listSharesForDoc("d1");
    expect(r.shares[0].opens, "le repli doit RENDRE les chiffres, pas des zéros").toBe(1);
    expect(b.vus.some((c) => c.startsWith("commercial_doc_views")), "les lignes brutes doivent avoir été lues").toBe(true);
  });

  it("le même repli vaut quand la fonction est nommée dans le MESSAGE plutôt que dans le code", async () => {
    // Un hôte tiers implémente `db.request` lui-même et n'a pas forcément posé `details.code`.
    const b = base(() => { throw new Error("Supabase POST rpc/player_stats_doc → 404 — PGRST202"); });
    shares.init({ db: b.db });
    expect((await shares.listSharesForDoc("d1")).shares[0].opens).toBe(1);
  });
});

describe("⚠️ ce qui NE DOIT PAS faire retomber — et remonte donc", () => {
  const refus = [
    ["base injoignable", () => { throw Object.assign(new Error("fetch failed"), { cause: "ECONNREFUSED" }); }],
    ["délai dépassé", () => { throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }); }],
    ["droit manquant", () => { throw erreurPostgrest(403, "permission denied for function player_stats_doc", { code: "42501" }); }],
    ["erreur de base", () => { throw erreurPostgrest(500, "internal error", { code: "XX000" }); }],
  ];

  for (const [nom, jeter] of refus) {
    it(`${nom} : l'erreur remonte, elle ne devient pas un chiffre`, async () => {
      const b = base(jeter);
      shares.init({ db: b.db });
      // Un repli ici rendrait des statistiques calculées sur ce qui a bien voulu répondre — et
      // rien, dans la réponse, ne distinguerait ce chiffre-là d'un chiffre juste.
      await expect(shares.listSharesForDoc("d1")).rejects.toThrow();
      await expect(shares.overview()).rejects.toThrow();
    });
  }

  it("⚠️ un `rpc/` qui rend une liste VIDE n'est pas une fonction absente", async () => {
    // Un document sans aucune vue rend légitimement zéro ligne. Confondre « vide » et « absente »
    // ferait relire tout l'historique à chaque appel — le coût que cette migration existe pour
    // supprimer — sans que rien ne le signale.
    const b = base(() => []);
    shares.init({ db: b.db });
    const r = await shares.listSharesForDoc("d1");
    expect(r.shares[0].opens, "aucune vue en base : zéro, et c'est la bonne réponse").toBe(0);
    expect(b.vus.some((c) => c.startsWith("commercial_doc_views")),
      "les lignes brutes ont été relues : « vide » a été pris pour « absente »").toBe(false);
  });
});
