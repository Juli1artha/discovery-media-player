// LE PROTOCOLE DU JETON DE PRÉSENCE SUR LA ROUTE present-attend (P1c étape 2).
//
// ⚠️ LE CŒUR SÉCURITÉ : la clé de la ligne d'un anonyme vient du jeton PROUVÉ (émis par l'hôte), pas du
// corps — un tiers ne peut donc plus poster la clé d'autrui pour écraser sa présence. La route émet un
// jeton pour l'anonyme (il le renverra), et sous PLAYER_PRESENCE_STRICT elle refuse un battement legacy.

const schema = require("../schema.js");

function joueur({ strict = false, jetonEntrant = null } = {}) {
  const rpc = [];
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("doc_presentations?") && m === "GET") return [{ slug: "s", active: true, current_page: 1, control_hash: "h" }];
        if (chemin.startsWith("rpc/player_attendance_bump") && m === "POST") { rpc.push(o.body); return [{ ok: true, created: true, capped: false }]; }
        if (chemin.startsWith("doc_presentation_attendees")) return [];
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: {
      async verifyToken() { return null; },                       // anonyme
      roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; },
      verifyPresenceToken: () => jetonEntrant,                    // {slug,key} ou null
      signPresenceToken: (slug, key) => `JETON(${slug}|${key})`,  // marqueur lisible
    },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], presenceStrict: strict },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  return { p, rpc };
}

async function attendre(p, body) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body: { action: "present-attend", slug: "s", ...body } }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("present-attend — protocole du jeton de présence", () => {
  it("jeton valide : la clé de la ligne vient du jeton PROUVÉ, pas du corps", async () => {
    const j = joueur({ jetonEntrant: { slug: "s", key: "anon-prouve" } });
    const r = await attendre(j.p, { key: "anon-usurpateur", pt: "peu-importe" });
    expect(r.statut).toBe(200);
    expect(j.rpc[0].p_key, "un tiers ne peut pas imposer sa clé quand un jeton prouve l'autre").toBe("anon-prouve");
    expect(j.rpc[0].p_has_token).toBe(true);
  });

  it("émission : un anonyme reçoit un jeton à renvoyer ensuite", async () => {
    const j = joueur();
    const r = await attendre(j.p, { key: "k", wantToken: "1" });
    expect(r.corps.pt, "le jeton émis est renvoyé au client").toMatch(/^JETON\(s\|/);
    expect(j.rpc[0].p_has_token, "bootstrap = moderne, compte avecJeton").toBe(true);
  });

  it("legacy (ni jeton ni wantToken), strict OFF : enregistré, compté sansJeton", async () => {
    const j = joueur({ strict: false });
    const r = await attendre(j.p, { key: "k" });
    expect(r.statut).toBe(200);
    expect(j.rpc[0].p_has_token, "legacy → last_no_token_at").toBe(false);
  });

  it("legacy, strict ON : refusé (la porte est fermée)", async () => {
    const j = joueur({ strict: true });
    const r = await attendre(j.p, { key: "k" });
    expect(r.statut).toBe(403);
    expect(j.rpc.length, "aucune écriture pour un battement legacy refusé").toBe(0);
  });

  it("jeton valide, strict ON : passe (identité prouvée)", async () => {
    const j = joueur({ strict: true, jetonEntrant: { slug: "s", key: "anon-prouve" } });
    const r = await attendre(j.p, { key: "k", pt: "peu-importe" });
    expect(r.statut).toBe(200);
    expect(j.rpc[0].p_key).toBe("anon-prouve");
  });

  it("jeton d'un AUTRE slug : ignoré (le battement retombe en legacy)", async () => {
    const j = joueur({ strict: true, jetonEntrant: { slug: "autre", key: "anon-prouve" } });
    const r = await attendre(j.p, { key: "k", pt: "peu-importe" });
    expect(r.statut, "un jeton lié à un autre slug ne prouve rien ici → legacy → refusé sous strict").toBe(403);
  });
});
