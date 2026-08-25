// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN REFUS EN TEXTE PARTAIT SANS Content-Type — LE SEUL CORPS DE CE SERVEUR QU'UN NAVIGATEUR
// AVAIT LE DROIT DE DEVINER.
//
// Trouvé par le premier scan ZAP baseline (règle 10019, 24/08) : les réponses de refus du relais
// (« Fichier indisponible », « Fichier trop volumineux ») posaient un code et un corps, et rien
// d'autre. Partout ailleurs, ce dépôt POSE le type et interdit le reniflage (`nosniff`) — la règle
// existait, ces chemins-là ne la suivaient pas. Le corps est constant et inoffensif aujourd'hui ;
// le test tient la règle, pas le corps du jour.

const { Writable } = require("node:stream");
const handler = require("../handler.js");

function contexte() {
  return { plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, db: {}, storage: {} };
}

class FauxRes extends Writable {
  constructor() { super({ highWaterMark: 1 }); this.statusCode = 0; this.entetes = {}; this.recus = []; }
  setHeader(k, v) { this.entetes[k] = v; }
  _write(m, _e, fini) { this.recus.push(Buffer.from(m)); fini(); }
}

const attendreTexte = (res) => {
  expect(res.entetes["Content-Type"], "un corps sans type est un corps que le navigateur devine").toBe("text/plain; charset=utf-8");
  expect(res.entetes["X-Content-Type-Options"]).toBe("nosniff");
};

describe("les refus du relais posent leur type", () => {
  it("amont absent : 404, en texte déclaré", async () => {
    const res = new FauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, null, "inline");
    expect(res.statusCode).toBe(404);
    attendreTexte(res);
  });

  it("amont en erreur : 502, en texte déclaré", async () => {
    const res = new FauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, { ok: false, status: 500, headers: new Headers() }, "inline");
    expect(res.statusCode).toBe(502);
    attendreTexte(res);
  });

  it("au-dessus du plafond : 413, en texte déclaré", async () => {
    const res = new FauxRes();
    handler.init(contexte());
    const r = {
      ok: true, status: 200,
      headers: new Headers({ "content-type": "application/pdf", "content-length": String(200 * 1024 * 1024) }),
      body: null,
    };
    await handler.__relayerFichier(res, r, "inline");
    expect(res.statusCode).toBe(413);
    attendreTexte(res);
  });
});
