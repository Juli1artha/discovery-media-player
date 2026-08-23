// LE CHEMIN ANALYTIQUE EXTERNE EST LIMITÉ PAR IP — au-delà du quota, on n'écrit plus (mais 200).
//
// ⚠️ P1 PERFORMANCE : un slug public permettait des écritures illimitées. Même quota dérivé de la
// cadence que la session interne. Dépassé → aucune écriture, réponse 200 (une mesure ne casse pas
// une lecture).
const schema = require("../schema.js");

function joueur() {
  const ecritures = [];
  let sousQuota = true;
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("commercial_doc_shares?slug=eq.")) return [{ slug: "pub", doc_id: "d", is_test: false, recipient_email: null }];
        if (m === "POST" && chemin.startsWith("commercial_doc_sessions")) ecritures.push(o.body[0]);
        if (m === "POST" && chemin.startsWith("commercial_doc_views")) ecritures.push(o.body[0]);
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow(cle) { return cle.startsWith("sess:") && cle !== "sess:quota-avert" ? sousQuota : true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  return { p, ecritures, setQuota: (v) => { sousQuota = v; } };
}

async function track(p, body) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("télémétrie externe limitée par IP", () => {
  it("sous quota : la session est écrite", async () => {
    const j = joueur();
    const r = await track(j.p, { slug: "pub", event: "session", sessionId: "s1" });
    expect(r.statut).toBe(200);
    expect(j.ecritures.length).toBe(1);
  });

  it("quota dépassé : rien n'est écrit, mais réponse 200 (la lecture n'est pas cassée)", async () => {
    const j = joueur(); j.setQuota(false);
    const r = await track(j.p, { slug: "pub", event: "session", sessionId: "s2" });
    expect(r.statut, "une mesure ne 429 pas un lecteur").toBe(200);
    expect(j.ecritures.length, "aucune écriture au-delà du quota").toBe(0);
  });
});
