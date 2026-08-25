// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA POPULATION INTERNE ÉTAIT OUVERTE À TOUS.
//
// C'est celle que le produit promet de ne jamais mélanger aux prospects : « ce client a lu douze
// minutes » ne vaut que si un collègue relisant le document n'entre pas dans le même compte. Or
// cette route acceptait n'importe quel e-mail, n'importe quel document, n'importe quelle durée,
// sans jeton ni limite. On pouvait fabriquer « tel collègue a lu ce document trois heures ».
//
// ⚠️ POURQUOI PAS UN JWT. Le suivi part par `sendBeacon`, seul transport qui survive à la
// fermeture d'un onglet — et il ne sait pas porter d'en-tête. Exiger un JWT reviendrait à perdre
// la mesure au moment exact où elle compte le plus. La preuve voyage donc dans le CORPS, et vient
// de l'hôte : lui seul sait qui est son membre.
//
// Signalé par un audit externe (P1-2).

const crypto = require("node:crypto");

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

let ecrites = [];
const vraisShares = require("../shares.js");
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: {
    ...vraisShares,
    upsertInternalSession: async (p) => { ecrites.push(p); },
    getShareBySlug: async () => null,
    logShareEvent: async () => {},
  },
};

const player = require("../handler.js");

const SECRET = "un-secret-partage-de-32-caracteres-minimum";
const signer = (charge, secret = SECRET) => {
  const c = Buffer.from(JSON.stringify(charge)).toString("base64url");
  return c + "." + crypto.createHmac("sha256", secret).update(c).digest("base64url");
};
const dans10min = () => Math.floor(Date.now() / 1000) + 600;

let alertes = [];
let quotas = {};

function contexte({ strict = false } = {}) {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() { return null; } },
    identity: {
      async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false,
      async canManageShares() { return false; },
      verifyInternalToken(j) {
        const brut = String(j || ""); const sep = brut.lastIndexOf(".");
        if (sep <= 0) return null;
        const corps = brut.slice(0, sep);
        const attendue = crypto.createHmac("sha256", SECRET).update(corps).digest("base64url");
        if (attendue !== brut.slice(sep + 1)) return null;
        const d = JSON.parse(Buffer.from(corps, "base64url").toString("utf8"));
        if (!Number.isFinite(d.exp) || d.exp * 1000 < Date.now()) return null;
        return { email: String(d.email), name: d.name || "", docId: String(d.docId) };
      },
    },
    limits: { async allow(cle, max) { quotas[cle] = (quotas[cle] || 0) + 1; return quotas[cle] <= max; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture(e) { alertes.push(String(e && e.message)); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "", publicUrl: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], internalStrict: strict },
  };
}

async function ecrire(corps, opts = {}) {
  ecrites = []; alertes = []; quotas = {};
  player.init(contexte(opts));
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json" }, socket: { remoteAddress: "1.2.3.4" }, query: {},
      body: { internal: true, event: "session", sessionId: "s1", ...corps } },
    res,
  );
  return { statut: res.statusCode, ecrites, alertes };
}

describe("qui décide de l'identité d'une session interne", () => {
  it("sans jeton : accepté, mais l'affirmation du client est utilisée — et signalée", async () => {
    const r = await ecrire({ docId: "d1", email: "usurpe@exemple.fr", totalSeconds: 60 });
    expect(r.statut).toBe(200);
    expect(r.ecrites[0].userEmail).toBe("usurpe@exemple.fr");
    expect(r.alertes.join(" "), "le trou doit se voir dans les journaux").toMatch(/PLAYER_INTERNAL_STRICT/);
  });

  // ⚠️ Le jeton fait foi : l'hôte se porte garant, l'appelant n'est plus cru.
  it("avec jeton : l'identité vient du jeton, pas du corps", async () => {
    const it = signer({ email: "vrai@exemple.fr", name: "Vrai", docId: "d-vrai", exp: dans10min() });
    const r = await ecrire({ it, docId: "d-forge", email: "usurpe@exemple.fr" });
    expect(r.ecrites[0].userEmail).toBe("vrai@exemple.fr");
    expect(r.ecrites[0].docId, "même le document vient du jeton").toBe("d-vrai");
    expect(r.alertes.join(" "), "rien à signaler quand la preuve est là").not.toMatch(/PLAYER_INTERNAL_STRICT/);
  });

  it.each([
    ["signé avec un autre secret", () => signer({ email: "a@b.fr", docId: "d1", exp: dans10min() }, "mauvais-secret")],
    ["expiré", () => signer({ email: "a@b.fr", docId: "d1", exp: Math.floor(Date.now() / 1000) - 10 })],
    ["charabia", () => "nimportequoi"],
  ])("un jeton %s ne fait pas foi", async (_nom, fabrique) => {
    const r = await ecrire({ it: fabrique(), docId: "d1", email: "usurpe@exemple.fr" });
    expect(r.ecrites[0].userEmail, "on retombe sur le corps, donc l'alerte doit sortir").toBe("usurpe@exemple.fr");
    expect(r.alertes.join(" ")).toMatch(/PLAYER_INTERNAL_STRICT/);
  });
});

// ⚠️ LA PORTE QU'UN HÔTE PEUT FERMER. Fermer par défaut casserait les instances en service ; ne
// rien offrir laisserait le trou ouvert pour toujours. Le verrou est fourni, la décision est à
// l'hôte — et elle est visible dans sa configuration, pas enfouie dans une note.
describe("PLAYER_INTERNAL_STRICT ferme la porte", () => {
  it("sans jeton : rien n'est écrit", async () => {
    const r = await ecrire({ docId: "d1", email: "usurpe@exemple.fr" }, { strict: true });
    expect(r.statut).toBe(403);
    expect(r.ecrites).toHaveLength(0);
  });

  it("avec jeton : la mesure continue normalement", async () => {
    const it = signer({ email: "vrai@exemple.fr", docId: "d1", exp: dans10min() });
    const r = await ecrire({ it, docId: "d1" }, { strict: true });
    expect(r.statut).toBe(200);
    expect(r.ecrites[0].userEmail).toBe("vrai@exemple.fr");
  });
});

describe("ce qu'une affirmation ne peut plus faire grossir", () => {
  const { upsertInternalSession } = vraisShares;
  let ligne = null;
  beforeEach(() => {
    ligne = null;
    vraisShares.init({ db: { async request(_c, o) { ligne = o.body[0]; return []; } } });
  });

  it("les durées et les pages sont bornées", async () => {
    await upsertInternalSession(
      { sessionId: "s1", docId: "d1", numPages: 9e9, maxPage: 9e9, totalSeconds: 9e9 }, { ip: "", ua: "" },
    );
    expect(ligne.num_pages).toBeLessThanOrEqual(10000);
    expect(ligne.total_seconds).toBeLessThanOrEqual(24 * 3600);
  });

  // Un objet libre venu du dehors : sans plafond, un seul appel écrit le JSON qu'il veut.
  it("le détail par page est plafonné et nettoyé", async () => {
    const enorme = {};
    for (let i = 0; i < 5000; i++) enorme[i] = 10;
    enorme["pas-un-nombre"] = 5;
    enorme["-3"] = 5;
    await upsertInternalSession({ sessionId: "s1", docId: "d1", pagesTime: enorme }, { ip: "", ua: "" });
    const cles = Object.keys(ligne.pages_time);
    expect(cles.length).toBeLessThanOrEqual(2000);
    expect(cles).not.toContain("pas-un-nombre");
    expect(cles).not.toContain("-3");
  });

  it("un tableau déguisé en objet ne passe pas", async () => {
    await upsertInternalSession({ sessionId: "s1", docId: "d1", pagesTime: [1, 2, 3] }, { ip: "", ua: "" });
    expect(ligne.pages_time).toEqual({});
  });
});
