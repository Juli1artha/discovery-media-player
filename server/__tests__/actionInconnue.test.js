// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE ACTION POST INCONNUE N'EST PAS UN SUCCÈS.
//
// ⚠️ P2 DU HUITIÈME AUDIT. Toute action POST qu'aucune famille ne reconnaît tombait dans le repli
// analytique, qui répond `{"ok":true}` — et avec un slug valide, une FAUTE DE FRAPPE comme
// `present-pgae` pouvait même être journalisée comme une ouverture. Un succès pour un geste qui
// n'a rien fait est pire qu'une erreur : personne ne cherche la cause d'un `ok:true`.
//
// Désormais : un `action` présent mais inconnu → `400 unknown-action` ; sans `action`, il faut un
// `event` analytique autorisé (open/page/heartbeat/session) — jamais un événement absent ou
// invalide transformé en ouverture.

const schema = require("../schema.js");

function player() {
  const journaux = [];
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.includes("limit=0")) return [];
        if (m === "GET" && chemin.startsWith("commercial_doc_shares?slug=eq.")) return [{ slug: "s1", is_test: false }];
        if (m === "POST" && chemin.startsWith("commercial_doc_views")) { journaux.push(o.body); return []; }
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return { email: "m@x.fr" }; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return true; }, isTrustedHostCall: () => false },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js");
  p.init(ctx); schema.init(ctx);
  return { p, journaux };
}

async function poster(p, body) {
  const res = { statusCode: 0, headers: {}, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("une action POST inconnue est refusée, pas déclarée réussie", () => {
  it("une faute de frappe (`present-pgae`) répond 400 unknown-action et ne journalise rien", async () => {
    const { p, journaux } = player();
    const r = await poster(p, { action: "present-pgae", slug: "s1", event: "page", page: 3 });
    expect(r.statut, "un geste qui n'a rien fait n'est pas un succès").toBe(400);
    expect(r.corps.error).toBe("unknown-action");
    expect(journaux.length, "aucun événement analytique inventé").toBe(0);
  });

  it("sans `action` ni `event` autorisé : 400, rien journalisé", async () => {
    const { p, journaux } = player();
    const r = await poster(p, { slug: "s1" });
    expect(r.statut).toBe(400);
    expect(journaux.length).toBe(0);
  });

  it("un `event` analytique valide passe toujours (open/page/heartbeat/session)", async () => {
    const { p, journaux } = player();
    const r = await poster(p, { slug: "s1", event: "page", page: 2 });
    expect(r.corps.ok).toBe(true);
    expect(journaux.length, "une vraie mesure est bien journalisée").toBe(1);
  });
});
