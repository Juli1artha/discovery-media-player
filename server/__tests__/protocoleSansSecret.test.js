// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// SANS SECRET, LE PARTICIPANT NE DOIT PAS SE FAIRE REFUSER PAR SA PROPRE PRÉSENCE.
//
// ⚠️ P1 d'audit externe, et la composition que NOS tests ne voyaient pas : le banc client simulait
// toujours `{ok:true}` et le banc serveur un signataire fonctionnel. Aucun des deux n'exerçait l'état
// pourtant le plus banal — le client moderne déployé AVANT que l'hôte pose `PLAYER_PRESENCE_SECRET`.
//
// Ce qui se passait alors : le bootstrap était compté comme une preuve, la ligne devenait RÉCLAMÉE,
// aucun jeton n'était renvoyé (pas de secret), le battement suivant repartait en bootstrap, tombait sur
// sa propre ligne réclamée → 409 → le client faisait tourner sa clé → un participant de plus, à chaque
// battement, jusqu'au plafond de 325. Une protection qui produisait exactement ce qu'elle interdit.

const schema = require("../schema.js");

/** `avecSecret` pilote la seule chose qui distingue les deux mondes. */
function joueur({ avecSecret, strict = false } = {}) {
  const rpc = [];
  const reclamees = new Set();
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("doc_presentations?") && m === "GET") return [{ slug: "s", active: true, current_page: 1, control_hash: "h" }];
        if (chemin.startsWith("rpc/player_attendance_bump") && m === "POST") {
          rpc.push(o.body);
          if (o.body.p_only_if_unclaimed === true && reclamees.has(o.body.p_key)) {
            return [{ ok: false, created: false, capped: false, usurpe: true }];
          }
          // Fidèle à 0017/0018 : seul un battement PROUVÉ réclame la ligne.
          if (o.body.p_has_token === true) reclamees.add(o.body.p_key);
          return [{ ok: true, created: true, capped: false, usurpe: false }];
        }
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: {
      async verifyToken() { return null; },
      roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; },
      verifyPresenceToken: () => null,
      // ⚠️ LE POINT DU BANC : sans secret, les deux contextes réels rendent "" — pas une exception.
      signPresenceToken: (slug, key) => (avecSecret ? `JETON(${slug}|${key})` : ""),
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

async function battre(p, body) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body: { action: "present-attend", slug: "s", ...body } }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("protocole de présence sans PLAYER_PRESENCE_SECRET", () => {
  it("un client moderne bat INDÉFINIMENT sur la même clé, sans 409 ni rotation", async () => {
    const j = joueur({ avecSecret: false });
    for (let i = 0; i < 5; i += 1) {
      const r = await battre(j.p, { key: "anon-stable", wantToken: "1" });
      expect(r.statut, `battement ${i + 1} : refusé alors qu'il n'y a pas de secret`).toBe(200);
      expect(r.corps.usurpe, "aucune usurpation : c'est sa propre ligne").toBeUndefined();
      expect(r.corps.pt, "aucun jeton ne peut sortir sans secret").toBeUndefined();
    }
    const cles = new Set(j.rpc.map((b) => b.p_key));
    expect(cles.size, "un seul participant, pas un par battement").toBe(1);
  });

  it("sans secret, le battement compte comme SANS jeton (sansJeton ne retombera pas à zéro)", async () => {
    const j = joueur({ avecSecret: false });
    await battre(j.p, { key: "anon-k", wantToken: "1" });
    expect(j.rpc[0].p_has_token, "il ne porte aucune preuve, et n'en portera jamais").toBe(false);
    expect(j.rpc[0].p_only_if_unclaimed, "ce n'est pas un bootstrap : rien à durcir").toBeUndefined();
  });

  it("STRICT posé SANS secret est INERTE : on n'expulse pas 100 % des anonymes", async () => {
    const j = joueur({ avecSecret: false, strict: true });
    const r = await battre(j.p, { key: "anon-k" });
    expect(r.statut, "refuser ici serait une panne auto-infligée").toBe(200);
  });

  it("AVEC secret : le bootstrap crée une ligne LIBRE, le battement suivant la réclame", async () => {
    const j = joueur({ avecSecret: true });
    const un = await battre(j.p, { key: "anon-k", wantToken: "1" });
    expect(un.corps.pt).toMatch(/^JETON\(s\|/);
    expect(j.rpc[0].p_has_token, "un bootstrap ne réclame pas").toBeNull();
    expect(j.rpc[0].p_only_if_unclaimed, "mais il refuse de s'emparer d'une ligne déjà réclamée").toBe(true);
  });

  it("AVEC secret, STRICT : un legacy est refusé, un bootstrap passe", async () => {
    const j = joueur({ avecSecret: true, strict: true });
    expect((await battre(j.p, { key: "anon-k" })).statut, "legacy sous strict").toBe(403);
    expect((await battre(j.p, { key: "anon-k", wantToken: "1" })).statut, "bootstrap sous strict").toBe(200);
  });
});
