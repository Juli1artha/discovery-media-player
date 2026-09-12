// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ LE FLUX BORNAIT LES OCTETS, RIEN NE BORNAIT LE NOMBRE DE FLUX. Un audit externe a ouvert 200
// transferts lents à la fois (13/09) : 200 appels amont, 200 pipelines, 200 réponses ouvertes, dans
// un seul processus. Ces bancs fixent l'admission : un plafond par processus, un refus 503 AVANT
// l'appel amont, aucune file, et une place rendue sur succès, erreur amont et déconnexion cliente.

const player = require("../handler.js");

const URL_OK = "https://exemple.supabase.co/storage/v1/object/public/docs/p.pdf";

/** Un amont dont on tient la bride : chaque appel rend une promesse qu'on résout (ou rejette) à la main. */
function amont() {
  const enAttente = [];
  const reponse = () => ({ ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) }, body: null, arrayBuffer: async () => Buffer.from("pdf") });
  return {
    appels: 0,
    enAttente,
    fetchFile() { this.appels += 1; return new Promise((resoudre, rejeter) => enAttente.push({ resoudre: () => resoudre(reponse()), rejeter })); },
    liberer() { for (const p of enAttente.splice(0)) p.resoudre(); },
    casser() { for (const p of enAttente.splice(0)) p.rejeter(new Error("amont en panne")); },
  };
}

function initialiser(a, config = {}) {
  const captures = [];
  // Un limiteur RÉEL en mémoire (fenêtre fixe) : l'avertissement « une fois par heure » passe par lui.
  const compte = new Map();
  const allow = async (cle, max) => { const n = (compte.get(cle) || 0) + 1; compte.set(cle, n); return n <= max; };
  player.init({
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"), fetchFile: (u, o) => a.fetchFile(u, o), async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { allow },
    branding: { async logo() { return ""; }, name: "Studio", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture(e, meta) { captures.push({ message: e.message, meta }); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], ...config },
  });
  return captures;
}

/** Une demande d'aperçu en flux : elle part, et sa promesse ne se règle qu'à la fin du relais. */
function demander() {
  const res = {
    statusCode: 0, headers: {}, body: "", fini: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); this.fini = true; },
  };
  const p = player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1", name: "p.pdf" } }, res);
  return { res, p };
}
const tour = () => new Promise((r) => setImmediate(r));

describe("⚠️ les relais de fichiers passent par une admission", () => {
  it("au-delà du plafond : 503 + Retry-After, et l'amont n'est PAS appelé pour les refusés", async () => {
    const a = amont(); const captures = initialiser(a);
    const demandes = Array.from({ length: 70 }, () => demander());
    await tour(); await tour();
    expect(a.appels, "64 transferts admis, pas un de plus").toBe(64);
    const refuses = demandes.filter((d) => d.res.statusCode === 503);
    expect(refuses.length).toBe(6);
    expect(refuses[0].res.headers["retry-after"]).toBe("2");
    expect(demandes.filter((d) => d.res.fini && d.res.statusCode !== 503).length, "aucune file : les autres sont en vol, ni servis ni refusés").toBe(0);
    expect(captures.length, "l'exploitant l'apprend une fois").toBe(1);
    expect(captures[0].message).toMatch(/64 transferts simultanés/);
    a.liberer();
    await Promise.all(demandes.map((d) => d.p));
    expect(demandes.filter((d) => d.res.statusCode === 200).length).toBe(64);
  });

  it("la place revient après un succès : une demande de plus est admise", async () => {
    const a = amont(); initialiser(a, { maxConcurrentRelays: 2 });
    const d1 = demander(), d2 = demander(); await tour();
    const d3 = demander(); await tour();
    expect(d3.res.statusCode, "contrôle positif : le plafond de 2 mord").toBe(503);
    a.liberer(); await Promise.all([d1.p, d2.p, d3.p]);
    const d4 = demander(); await tour();
    expect(a.appels, "la place rendue est reprise").toBe(3);
    a.liberer(); await d4.p;
  });

  it("⚠️ la place revient après une ERREUR amont — sinon un amont en panne remplit le plafond pour toujours", async () => {
    const a = amont(); initialiser(a, { maxConcurrentRelays: 2 });
    const d1 = demander(), d2 = demander(); await tour();
    a.casser();
    await Promise.all([d1.p, d2.p].map((p) => p.catch(() => {})));
    const d3 = demander(); await tour();
    expect(a.appels, "après deux échecs, la troisième est admise").toBe(3);
    a.liberer(); await d3.p.catch(() => {});
  });

  it("⚠️ la place revient quand le client est parti au milieu du flux — le pipeline rejette, le finally rend", async () => {
    // Un amont qui STREAME, et une réponse dont le socket meurt : pipeline() rejette « premature close ».
    const { Readable } = require("node:stream");
    let ouverts = 0;
    const flux = () => ({ ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) },
      body: Readable.toWeb(new Readable({ read() { /* ne finit jamais */ } })) });
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, fetchFile: async () => { ouverts += 1; return flux(); }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "S", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture() {} }, legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], maxConcurrentRelays: 1 },
    });
    const { Writable } = require("node:stream");
    const resVivante = () => { const w = new Writable({ write(_c, _e, cb) { cb(); } }); w.setHeader = () => {}; w.statusCode = 0; return w; };
    const r1 = resVivante();
    const p1 = player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, r1);
    await tour(); await tour();
    expect(ouverts, "contrôle positif : le premier relais est en vol").toBe(1);
    r1.destroy(new Error("client parti"));                       // le socket meurt au milieu du flux
    await p1;
    const r2 = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() {} };
    player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, r2);
    await tour(); await tour();
    expect(ouverts, "la place du client parti est rendue : le second relais part").toBe(2);
    expect(r2.statusCode).not.toBe(503);
  });

  it("un plafond absurde retombe sur 64, un plafond posé est respecté", async () => {
    const a = amont(); initialiser(a, { maxConcurrentRelays: "n'importe quoi" });
    const demandes = Array.from({ length: 65 }, () => demander()); await tour();
    expect(a.appels).toBe(64);
    a.liberer(); await Promise.all(demandes.map((d) => d.p));
  });
});
