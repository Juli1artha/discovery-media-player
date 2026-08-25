// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE MUR AU NIVEAU DE LA PAGE — LES QUATRE ISSUES DE /doc/:slug SOUS require_auth.
//
// ⚠️ murVisiteur.test.js éprouve l'API du mur (routes-visiteur) ; PERSONNE n'éprouvait la PAGE.
// Or c'est elle qui décide, à chaque GET, entre quatre issues qui n'ont pas le droit de se
// confondre :
//
//   1. greffon absent + document réservé → REFUS (T1 : jamais de dégradation en accès libre) ;
//   2. visiteur sans jeton → le MUR — et le fichier lui-même (?file=1) rend 401 SANS streamer :
//      servir la page de connexion tout en laissant le PDF passer à côté serait un mur de décor ;
//   3. intégré (?embed=1) → le mur DIT à l'hôte que le document est retenu (postMessage
//      embed-denied) — sinon l'hôte croit à une panne et replie sur SON lecteur, qui ouvrirait
//      le document que ce mur protège (incident raconté dans handler.js) ;
//   4. visiteur au jeton → le lecteur, pas le mur.
//
// Et une propriété de dégradation : l'habillage (profil d'agent, marque du client) est
// best-effort — un greffon qui explose n'empêche JAMAIS de lire. « Le loader dégrade, il
// n'empêche pas de lire » était un commentaire ; c'est maintenant un test.

const ID_SHARES = require.resolve("../shares.js");
const vraisShares = require("../shares.js");
let partageRendu = null;
require.cache[ID_SHARES] = {
  id: ID_SHARES, filename: ID_SHARES, loaded: true,
  exports: { ...vraisShares, getShareBySlug: async () => partageRendu, logView: async () => {}, upsertSession: async () => ({}) },
};
const ID_PRES = require.resolve("../presentations.js");
const vraiesPres = require("../presentations.js");
require.cache[ID_PRES] = { id: ID_PRES, filename: ID_PRES, loaded: true,
  exports: { ...vraiesPres, getPresentation: async () => null, listMessages: async () => [] } };

const player = require("../handler.js");

const PARTAGE = {
  slug: "lien-1", doc_title: "Proposition", file_url: "https://exemple.supabase.co/storage/v1/object/public/docs/p.pdf",
  file_name: "proposition.pdf", require_auth: true,
};

let lecturesFichier = [];
function initialiser({ visitors = null, bot = null, forKey = async () => null } = {}) {
  lecturesFichier = [];
  player.init({
    plugins: { ...(visitors ? { visitors } : {}), ...(bot ? { bot } : {}) }, has: () => false,
    storage: {
      isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"),
      async fetchFile(url) { lecturesFichier.push(url); return { ok: true, status: 200, headers: { get: () => "application/pdf" }, arrayBuffer: async () => Buffer.from("pdf") }; },
      async put() {},
    },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "Studio", poweredBy: "", loaderName: "", forKey, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  });
}

async function ouvrir(query) {
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({ method: "GET", headers: {}, socket: {}, query }, res);
  return res;
}

beforeEach(() => { partageRendu = { ...PARTAGE }; });

describe("un document réservé sans greffon de mur : refus, jamais accès libre", () => {
  it("le GET rend la page de refus — la dégradation interdite est celle qui OUVRE", async () => {
    initialiser({ visitors: null });
    const res = await ouvrir({ slug: "lien-1" });
    expect(res.body).not.toContain("proposition.pdf");
    expect(res.body).toMatch(/indisponible|retiré|revoked|Accès/i);
  });
});

describe("visiteur sans jeton : le mur, et le fichier reste derrière", () => {
  const greffonMur = { currentVisitor: () => null, googleClientId: () => "gcid-1" };

  it("la page servie est le MUR (CSP One-Tap comprise), pas le lecteur", async () => {
    initialiser({ visitors: greffonMur });
    const res = await ouvrir({ slug: "lien-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Accès — Proposition");
    expect(res.headers["content-security-policy"]).toContain("accounts.google.com");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("?file=1 rend 401 et le fichier n'est PAS streamé — un mur qui laisse passer le PDF est un décor", async () => {
    initialiser({ visitors: greffonMur });
    const res = await ouvrir({ slug: "lien-1", file: "1" });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: "auth" });
    expect(lecturesFichier).toHaveLength(0);
  });

  it("intégré (?embed=1), le mur PRÉVIENT l'hôte : embed-denied part, avec le nonce de la page", async () => {
    initialiser({ visitors: greffonMur });
    const res = await ouvrir({ slug: "lien-1", embed: "1" });
    expect(res.body).toContain("3dd-doc-embed-denied");
    expect(res.body).toContain("auth-required");
    const nonce = (res.headers["content-security-policy"].match(/nonce-([^']+)'/) || [])[1];
    expect(res.body).toContain(`<script nonce="${nonce}">`);
  });

  it("le visiteur au jeton passe le mur : la page servie est le lecteur", async () => {
    initialiser({ visitors: { currentVisitor: () => ({ email: "v@client" }), googleClientId: () => "" } });
    const res = await ouvrir({ slug: "lien-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("Accès — Proposition");
    expect(res.body).toContain("proposition.pdf");
  });
});

describe("l'habillage est best-effort : rien de décoratif n'empêche de lire", () => {
  it("un profil d'agent qui explose laisse la page se servir avec l'identité par défaut", async () => {
    partageRendu = { ...PARTAGE, require_auth: false, bot_enabled: true, bot_profile_id: "p1" };
    initialiser({ bot: { getProfile: async () => { throw new Error("profil en panne"); }, getDocFiche: async () => null } });
    const res = await ouvrir({ slug: "lien-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("proposition.pdf");
  });

  it("une résolution de marque qui explose n'empêche pas de lire non plus", async () => {
    partageRendu = { ...PARTAGE, require_auth: false, brand_key: "acme" };
    initialiser({ forKey: async () => { throw new Error("registre en panne"); } });
    const res = await ouvrir({ slug: "lien-1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("proposition.pdf");
  });
});
