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
//
// ⚠️ ET LA CORRECTION D'ALORS N'A TENU QUE LÀ OÙ ELLE A ÉTÉ ÉCRITE. Trois réponses en texte lui
// ont échappé (audit CODEX 5.6, 25/08) : le `500` du bout de `/doc`, qui ne posait AUCUN type ; le
// `400` « aucun document demandé », qui posait le type mais pas `nosniff` ; et les deux réponses
// de `bin/serve.js`, dans le seul fichier où le player ne pouvait pas les poser lui-même. Une
// règle réappliquée à la main se réapplique mal — il n'y a donc plus qu'UNE fonction par laquelle
// un corps en texte quitte ce serveur, et ce banc l'éprouve par les ROUTES, pas par elle.

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

function contexteComplet(surcharges = {}) {
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
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
    ...surcharges,
  };
}

const resSimple = () => ({
  statusCode: 0, entetes: {}, corps: null, headersSent: false,
  setHeader(k, v) { if (this.headersSent) throw Object.assign(new Error("Cannot set headers after they are sent"), { code: "ERR_HTTP_HEADERS_SENT" }); this.entetes[k] = v; },
  end(c) { this.corps = c === undefined ? this.corps : c; this.headersSent = true; },
});

describe("les deux refus en texte des ROUTES, éprouvés par la route", () => {
  it("⚠️ une requête sans document : 400, type ET nosniff — il manquait le second", async () => {
    handler.init(contexteComplet());
    const res = resSimple();
    await handler.handler({ method: "GET", headers: {}, socket: {}, query: {} }, res);
    expect(res.statusCode).toBe(400);
    attendreTexte(res);
    // Le corps guide un intégrateur : on tient la règle, mais ce refus doit rester explicite.
    expect(String(res.corps)).toContain("?slug=");
  });

  it("⚠️ le 500 du bout de `/doc` : il ne posait AUCUN type, donc un corps devinable", async () => {
    handler.init(contexteComplet({ db: { async request() { throw new Error("banc : la base tombe"); }, async selectAll() { throw new Error("banc : la base tombe"); } } }));
    const res = resSimple();
    await handler.handler({ method: "GET", headers: {}, socket: {}, query: { slug: "abc" } }, res);
    expect(res.statusCode).toBe(500);
    attendreTexte(res);
  });
});

describe("le refus survit à un en-tête déjà parti", () => {
  // ⚠️ CE N'EST PAS UNE PRÉCAUTION THÉORIQUE. Le premier appelant de `refuserEnTexte` est le
  // `catch` de `/doc` : une erreur peut y arriver APRÈS que `sendHtml` ait commencé à écrire.
  // `setHeader` jette alors ERR_HTTP_HEADERS_SENT — dans le rattrapage lui-même, ce qui change une
  // erreur signalée en rejet non rattrapé. Le remède est pire que le mal qu'il corrige.
  it("⚠️ ne jette pas, et ne tente pas de reposer ce qui est parti", () => {
    const res = resSimple();
    res.end("déjà écrit");
    expect(() => handler.refuserEnTexte(res, 500, "Erreur")).not.toThrow();
    expect(res.statusCode, "le statut était parti avec les en-têtes : le réécrire serait un mensonge").toBe(0);
    expect(res.corps).toBe("déjà écrit");
  });

  it("pose bien tout quand rien n'est encore parti", () => {
    const res = resSimple();
    handler.refuserEnTexte(res, 404, "Fichier indisponible");
    expect(res.statusCode).toBe(404);
    attendreTexte(res);
    expect(res.corps).toBe("Fichier indisponible");
  });
});
