// LE QUOTA DE SESSION NE DOIT PAS ÊTRE CONSOMMÉ PAR open/page — ET UN REFUS NE DOIT PAS LIRE LE LIEN.
//
// ⚠️ P1b audit CODEX 5.6. Le bucket `sess:${ip}` gardait TOUS les événements externes (open, page,
// session), alors que son quota est dérivé des seules ÉCRITURES DE SESSION. Résultat : 25 lecteurs
// derrière une IP dépassaient le quota par leurs open/page avant même leurs sessions, et le reste de
// la mesure était abandonné en silence (200). Deux corrections :
//   1. deux buckets — `sess:` pour la session (upsert), `view:` pour open/page/heartbeat (journal
//      léger) — chacun son quota dérivé de la cadence ;
//   2. le lien (`commercial_doc_shares`, une lecture base) n'est lu qu'APRÈS le quota : une requête
//      hors quota ne charge plus la base.

const schema = require("../schema.js");
const { VIEW_QUOTA_PER_HOUR } = require("../shared.generated.js");

function joueur() {
  const ecritures = [];
  let lecturesShare = 0;
  const quotas = { sess: true, view: true };
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("commercial_doc_shares?slug=eq.")) { lecturesShare += 1; return [{ slug: "pub", doc_id: "d", is_test: false, recipient_email: null }]; }
        if (m === "POST" && chemin.startsWith("commercial_doc_sessions")) ecritures.push({ ...o.body[0], _kind: "session" });
        if (m === "POST" && chemin.startsWith("commercial_doc_views")) ecritures.push({ ...o.body[0], _kind: "view" });
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: {
      async allow(cle) {
        if (cle.endsWith(":quota-avert") || cle.endsWith(":echec")) return true;
        if (cle.startsWith("sess:")) return quotas.sess;
        if (cle.startsWith("view:")) return quotas.view;
        return true;
      },
    },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  return { p, ecritures, quotas, lectures: () => lecturesShare };
}

async function track(p, body) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("télémétrie externe — buckets séparés session / vue", () => {
  it("le quota de VUE existe et diffère de celui de session", () => {
    expect(VIEW_QUOTA_PER_HOUR).toBeGreaterThan(0);
  });

  it("session épuisée, vue libre : un `open` s'écrit quand même", async () => {
    const j = joueur(); j.quotas.sess = false; j.quotas.view = true;
    const r = await track(j.p, { slug: "pub", event: "open", page: 1, sessionId: "s1" });
    expect(r.statut).toBe(200);
    expect(j.ecritures.filter((e) => e._kind === "view").length, "open ne dépend pas du quota de session").toBe(1);
  });

  it("session épuisée : la session n'écrit pas ET ne lit pas le lien", async () => {
    const j = joueur(); j.quotas.sess = false; j.quotas.view = true;
    const r = await track(j.p, { slug: "pub", event: "session", sessionId: "s2" });
    expect(r.statut, "une mesure ne 429 pas un lecteur").toBe(200);
    expect(j.ecritures.length, "rien d'écrit hors quota").toBe(0);
    expect(j.lectures(), "hors quota : le lien n'est pas lu (pas de charge base)").toBe(0);
  });

  it("vue épuisée : un `page` n'écrit rien, mais une `session` (bucket libre) passe", async () => {
    const j = joueur(); j.quotas.sess = true; j.quotas.view = false;
    const rp = await track(j.p, { slug: "pub", event: "page", page: 3, maxPage: 3, sessionId: "s3" });
    expect(rp.statut).toBe(200);
    expect(j.ecritures.filter((e) => e._kind === "view").length, "page bloquée par le quota de vue").toBe(0);
    const rs = await track(j.p, { slug: "pub", event: "session", sessionId: "s3" });
    expect(rs.statut).toBe(200);
    expect(j.ecritures.filter((e) => e._kind === "session").length, "la session ne dépend pas du quota de vue").toBe(1);
  });
});
