// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA TÉLÉMÉTRIE EXTERNE EST BORNÉE ET LIMITÉE — un slug public ne peut pas inonder la base.
//
// ⚠️ P1 PERFORMANCE : le chemin analytique externe écrivait sans quota, et upsertSession stockait
// pages_time BRUT (aucun plafond d'entrées, aucune validation numérique) — contrairement au
// chemin interne, déjà borné. Un slug public → écritures illimitées, JSON de session illimité.
const shares = require("../shares.js");
const schema = require("../schema.js");

describe("upsertSession borne ce qui vient du dehors", () => {
  it("un pages_time de 10 000 entrées est rogné au plafond, clés/valeurs validées", async () => {
    let ecrit = null;
    const enorme = {};
    for (let k = 0; k < 10000; k++) enorme[k] = 999999999;   // valeurs bien au-delà des bornes
    enorme["pas-un-nombre"] = 5;                              // clé non numérique
    enorme["-3"] = 5;                                          // page négative
    const ctx = {
      db: { async request(chemin, o) { if ((o && o.method) === "POST") ecrit = o.body[0]; return []; } },
      errors: { capture() {} }, config: {},
    };
    shares.init(ctx); schema.init(ctx);
    await shares.upsertSession(
      { slug: "s", doc_id: "d", recipient_email: null },
      { sessionId: "sess", numPages: 999999999, maxPage: 999999999, totalSeconds: 999999999, pagesTime: enorme },
      { ip: "1.2.3.4", ua: "x" });
    const pt = ecrit.pages_time;
    expect(Object.keys(pt).length, "plafonné en nombre d'entrées").toBeLessThanOrEqual(2000);
    expect("pas-un-nombre" in pt, "clé non numérique rejetée").toBe(false);
    expect("-3" in pt, "page négative rejetée").toBe(false);
    for (const v of Object.values(pt)) expect(v, "valeur bornée").toBeLessThanOrEqual(24 * 3600);
    expect(ecrit.total_seconds, "total borné").toBeLessThanOrEqual(24 * 3600);
    expect(ecrit.num_pages, "num_pages borné").toBeLessThanOrEqual(10000);
  });
});
