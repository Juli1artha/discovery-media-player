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

  // ⚠️ UNE PLACE N'EST BORNÉE QUE SI LE RELAIS FINIT. Plafond 1, un client qui cesse de lire : la place
  // restait prise pour toujours et plus aucun fichier ne partait (audit externe, 13/09).
  // `requestTimeout` ne couvre pas l'émission d'une réponse — seul un délai de progression le fait.
  it("⚠️ un relais figé est ABANDONNÉ après le délai sans progression, et sa place rendue à la demande suivante", async () => {
    const { Readable, Writable } = require("node:stream");
    let ouverts = 0, sourcesDetruites = 0;
    const captures = [];
    const flux = () => {
      const src = new Readable({ read() { this.push(Buffer.alloc(1024)); } });      // un amont qui a toujours de quoi envoyer
      src.on("close", () => { sourcesDetruites += 1; });
      return { ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) }, body: Readable.toWeb(src) };
    };
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, fetchFile: async () => { ouverts += 1; return flux(); }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "S", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture(e) { captures.push(String(e && e.message)); } }, legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], maxConcurrentRelays: 1, relayStallMs: 80 },
    });
    // Un client qui LIT UNE FOIS puis plus jamais : l'écriture suivante ne rappelle pas.
    const fige = () => { let lus = 0; const w = new Writable({ write(_c, _e, cb) { lus += 1; if (lus === 1) cb(); /* la 2e ne rend jamais la main */ } }); w.setHeader = () => {}; w.statusCode = 0; return w; };
    const r1 = fige();
    const p1 = player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, r1);
    await tour(); await tour();
    expect(ouverts, "contrôle positif : le relais est en vol").toBe(1);
    const r2 = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() {} };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, r2);
    expect(r2.statusCode, "contrôle positif : tant que le premier est figé, le second est refusé").toBe(503);
    await p1;                                                    // l'abandon fait rejeter le pipeline : le relais FINIT
    expect(captures.some((m) => /aucune progression depuis 80 ms/.test(m)), "la cause est nommée").toBe(true);
    expect(sourcesDetruites, "la source amont est détruite, pas laissée ouverte").toBe(1);
    const r3 = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() {} };
    player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, r3);
    await tour(); await tour();
    expect(ouverts, "la place rendue est reprise : le troisième part vers l'amont").toBe(2);
    expect(r3.statusCode).not.toBe(503);
  });

  it("⚠️ le budget total abandonne aussi un relais qui PROGRESSE lentement sans jamais finir", async () => {
    const { Readable, Writable } = require("node:stream");
    const captures = [];
    let src;
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, fetchFile: async () => { src = new Readable({ read() { setTimeout(() => this.push(Buffer.alloc(16)), 10); } }); return { ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) }, body: Readable.toWeb(src) }; }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "S", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture(e) { captures.push(String(e && e.message)); } }, legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], relayStallMs: 5_000, relayMaxMs: 120 },
    });
    const w = new Writable({ write(_c, _e, cb) { cb(); } }); w.setHeader = () => {}; w.statusCode = 0;
    const debut = Date.now();
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, w);
    expect(Date.now() - debut, "fini par le budget, pas par la progression").toBeLessThan(2_000);
    expect(captures.some((m) => /plus de 120 ms au total/.test(m))).toBe(true);
    expect(src.destroyed, "la source amont est détruite").toBe(true);
  });

  it("un plafond absurde retombe sur 64, un plafond posé est respecté — et le refus est DIT à l'initialisation", async () => {
    const a = amont(); const captures = initialiser(a, { maxConcurrentRelays: "n'importe quoi" });
    expect(captures.map((c) => c.message).join("\n")).toMatch(/maxConcurrentRelays=n'importe quoi \(entier de 1 à 1024, défaut 64\)/);
    const demandes = Array.from({ length: 65 }, () => demander()); await tour();
    expect(a.appels).toBe(64);
    a.liberer(); await Promise.all(demandes.map((d) => d.p));
  });

  // ⚠️ UN HÔTE A LU `lectureSaturee.total = 0` COMME « NOUS N'AVONS JAMAIS SATURÉ LES RELAIS » (13/09).
  // Ce champ ne compte que le cache de lecture ; la carte n'avait rien pour les relais, et on demandait
  // aux hôtes de fouiller leurs journaux. Le compteur est sur la carte, et c'est un état du processus.
  it("⚠️ la carte compte les relais refusés — et init() ne remet pas ce compte à zéro", async () => {
    const carte = async () => {
      const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
      await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
      return JSON.parse(res.body);
    };
    const a = amont(); initialiser(a, { maxConcurrentRelays: 2 });
    const avant = (await carte()).relaisRefuses;
    expect(Object.keys(avant).sort(), "trois clés, jamais séparées").toEqual(["derniereIlYaS", "fenetreS", "total"]);
    const demandes = Array.from({ length: 5 }, () => demander()); await tour();
    const refusees = demandes.filter((d) => d.res.statusCode === 503).length;
    expect(refusees, "contrôle positif : trois refus").toBe(3);
    const apres = (await carte()).relaisRefuses;
    expect(apres.total - avant.total).toBe(3);
    expect(apres.derniereIlYaS, "le dernier refus vient d'avoir lieu").toBe(0);
    expect(apres.fenetreS).toBeGreaterThanOrEqual(0);
    a.liberer(); await Promise.all(demandes.map((d) => d.p));
    initialiser(amont(), { maxConcurrentRelays: 64 });
    expect((await carte()).relaisRefuses.total, "un contexte neuf ne réécrit pas l'histoire du processus").toBe(apres.total);
  });

  // ⚠️ `init` REMETTAIT LE COMPTEUR À ZÉRO, ET DÉSARMAIT LE PLAFOND. Un hôte qui rappelle `init`
  // pendant qu'un relais est ouvert : la demande suivante partait vers l'amont avec l'unique place
  // encore prise, puis le `finally` de l'ancien relais rendait le compteur négatif (reproduit par un
  // audit externe, cinquième passe, 13/09). Le compteur appartient au processus, pas au contexte.
  it("⚠️ init() ne désarme pas le plafond : un relais admis AVANT la réinitialisation occupe toujours sa place", async () => {
    const a1 = amont(); initialiser(a1, { maxConcurrentRelays: 1 });
    const d1 = demander(); await tour();
    expect(a1.appels, "contrôle positif : le premier relais est en vol").toBe(1);
    expect(player.__relaisEnCours()).toBe(1);
    const a2 = amont(); initialiser(a2, { maxConcurrentRelays: 1 });          // le même processus, un contexte neuf
    expect(player.__relaisEnCours(), "la réinitialisation ne touche pas au compteur").toBe(1);
    const d2 = demander(); await d2.p;
    expect(d2.res.statusCode, "le second est refusé : la place est encore prise").toBe(503);
    expect(a2.appels, "et l'amont du contexte neuf n'est PAS appelé").toBe(0);
    a1.liberer(); await d1.p;
    expect(player.__relaisEnCours(), "le premier a fini : zéro, pas moins").toBe(0);
    const d3 = demander(); await tour();
    expect(a2.appels, "un troisième est admis").toBe(1);
    a2.liberer(); await d3.p;
    expect(player.__relaisEnCours(), "jamais négatif").toBe(0);
  });

  it("⚠️ les bornes de temps d'un relais sont celles de son ADMISSION — un init pendant le transfert ne les change pas", async () => {
    const { Readable, Writable } = require("node:stream");
    const captures = [];
    const contexte = (relayStallMs) => ({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, fetchFile: async () => ({ ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) }, body: Readable.toWeb(new Readable({ read() { this.push(Buffer.alloc(1024)); } })) }), async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "S", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture(e) { captures.push(String(e && e.message)); } }, legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], relayStallMs },
    });
    player.init(contexte(80));
    const fige = () => { let lus = 0; const w = new Writable({ write(_c, _e, cb) { lus += 1; if (lus === 1) cb(); } }); w.setHeader = () => {}; w.statusCode = 0; return w; };
    const p1 = player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, fige());
    await tour(); await tour();
    player.init(contexte(60_000));                              // pendant le transfert : 60 s pour les SUIVANTS
    const debut = Date.now();
    await p1;
    expect(Date.now() - debut, "abandonné sous la borne de son admission, pas sous la nouvelle").toBeLessThan(5_000);
    expect(captures.some((m) => /aucune progression depuis 80 ms/.test(m))).toBe(true);
  });

  // ⚠️ `setTimeout` RAMÈNE À 1 ms TOUT DÉLAI AU-DELÀ DE 2 147 483 647 ms. Un `relayStallMs` de
  // 2 147 483 648 — « 24,8 jours » — abandonnait le transfert en 6 ms avec 65 TimeoutOverflowWarning
  // (audit externe, cinquième passe). La borne n'accepte qu'un entier dans une plage écrite, et une
  // valeur hors plage retombe sur le défaut EN LE DISANT.
  it("⚠️ un délai au-delà de la limite native de setTimeout retombe sur le défaut : le relais FINIT, sans TimeoutOverflowWarning", async () => {
    const { Readable, Writable } = require("node:stream");
    const captures = [];
    const avertissements = [];
    const ecoute = (w) => { avertissements.push(String(w && w.name)); };
    process.on("warning", ecoute);
    try {
      player.init({
        plugins: {}, has: () => false,
        storage: { isAllowedUrl: () => true, fetchFile: async () => { let n = 0; const src = new Readable({ read() { setTimeout(() => this.push(n++ < 5 ? Buffer.alloc(16) : null), 10); } }); return { ok: true, status: 200, headers: { get: (k) => (k === "content-type" ? "application/pdf" : null) }, body: Readable.toWeb(src) }; }, async put() {} },
        db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
        identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
        limits: { async allow() { return true; } },
        branding: { async logo() { return ""; }, name: "S", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
        errors: { async capture(e) { captures.push(String(e && e.message)); } }, legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
        config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], relayStallMs: 2_147_483_648, relayMaxMs: 2_147_483_648 },
      });
      expect(captures.filter((m) => /réglages de relais hors plage/.test(m)), "dit UNE fois, à l'initialisation").toHaveLength(1);
      expect(captures[0]).toMatch(/relayStallMs=2147483648 \(entier de 1 à 86400000 ms, défaut 30000\)/);
      expect(captures[0]).toMatch(/relayMaxMs=2147483648/);
      let recus = 0;
      const w = new Writable({ write(c, _e, cb) { recus += c.length; cb(); } }); w.setHeader = () => {}; w.statusCode = 0;
      await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1" } }, w);
      await new Promise((r) => setImmediate(r));
      expect(recus, "les cinq morceaux sont passés : rien n'a été abandonné en 6 ms").toBe(5 * 16);
      expect(captures.some((m) => /abandonné/.test(m)), "aucun abandon").toBe(false);
      expect(avertissements.filter((n) => n === "TimeoutOverflowWarning")).toEqual([]);
    } finally { process.off("warning", ecoute); }
  });
});
