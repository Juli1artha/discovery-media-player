// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'EMPREINTE D'IP EST SALÉE, LIÉE À LA PRÉSENTATION — ET LE CHEMIN SALÉ EST RÉELLEMENT EXERCÉ.
//
// ⚠️ P2 d'audit externe, et c'était une SURPROMESSE DE COMMENTAIRE : le code écrivait
// `sha256("att:" + ip)` avec la mention « sans conserver de donnée personnelle ». Faux — l'espace IPv4
// entier se recalcule en quelques minutes, donc l'empreinte se remonte à l'adresse. La CNIL considère
// une IP hachée comme PSEUDONYMISÉE, toujours soumise au RGPD. La description était plus forte que
// l'implémentation, la classe même qu'on traque ailleurs.
//
// ⚠️ ET CE BANC EXISTE AUTANT POUR LE CHEMIN QUE POUR LA PROPRIÉTÉ. Aucun double ne configurait de
// secret : la branche salée n'était donc JAMAIS exécutée par les tests, et une faute d'ordre de
// déclaration y est passée inaperçue — verte au banc, `ReferenceError` à chaque battement en
// production, où le secret EST posé. Un double qui ne configure jamais une option n'éprouve jamais le
// code que cette option active.

const schema = require("../schema.js");

function joueur({ sel = "" } = {}) {
  const rpc = [];
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("doc_presentations?") && m === "GET") return [{ slug: String(chemin.match(/slug=eq\.([^&]+)/)[1]), active: true, current_page: 1, control_hash: "h" }];
        if (chemin.startsWith("rpc/player_attendance_bump") && m === "POST") { rpc.push(o.body); return [{ ok: true, created: true, capped: false, usurpe: false }]; }
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; }, verifyPresenceToken: () => null, signPresenceToken: () => "" },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], ipHashSecret: sel },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  return { p, rpc };
}

async function battre(p, slug, ip) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, socket: { remoteAddress: ip }, query: {}, body: { action: "present-attend", slug, key: "anon-k" } }, res);
  return res.statusCode;
}

describe("empreinte d'IP", () => {
  it("AVEC SEL : le battement aboutit — le chemin salé est bien exécuté", async () => {
    const j = joueur({ sel: "un-sel-de-banc" });
    expect(await battre(j.p, "s1", "203.0.113.7"), "une faute sur ce chemin ne se voit qu'ici").toBe(200);
    expect(j.rpc[0].p_ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("AVEC SEL : deux PRÉSENTATIONS donnent des empreintes différentes pour la même IP", async () => {
    const j = joueur({ sel: "un-sel-de-banc" });
    await battre(j.p, "s1", "203.0.113.7");
    await battre(j.p, "s2", "203.0.113.7");
    expect(j.rpc[0].p_ip_hash).not.toBe(j.rpc[1].p_ip_hash);
  });

  it("AVEC SEL : l'empreinte dépend du sel (une base volée ne se recalcule pas sans lui)", async () => {
    const a = joueur({ sel: "sel-A" }); await battre(a.p, "s1", "203.0.113.7");
    const b = joueur({ sel: "sel-B" }); await battre(b.p, "s1", "203.0.113.7");
    expect(a.rpc[0].p_ip_hash).not.toBe(b.rpc[0].p_ip_hash);
  });

  it("SANS SEL : on retombe sur l'ancienne empreinte, la fonction marche (protection moindre, assumée)", async () => {
    const j = joueur({ sel: "" });
    expect(await battre(j.p, "s1", "203.0.113.7")).toBe(200);
    expect(j.rpc[0].p_ip_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("l'adresse elle-même ne part JAMAIS vers la base", async () => {
    const j = joueur({ sel: "un-sel-de-banc" });
    await battre(j.p, "s1", "203.0.113.7");
    expect(JSON.stringify(j.rpc[0])).not.toContain("203.0.113.7");
  });
});
