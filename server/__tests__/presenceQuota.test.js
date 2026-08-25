// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE QUOTA DE PRÉSENCE COUVRE UNE VRAIE AUDIENCE DERRIÈRE UNE IP PARTAGÉE — pas 6 personnes.
//
// ⚠️ P1 PERFORMANCE : 1000 battements/h/IP en dur, alors qu'un participant en émet ~144 (toutes
// les 25 s) → le 7e derrière une IP partagée (bureau, Wi-Fi d'événement) prenait des 429. Le quota
// se dérive désormais des constantes de cadence en visant ATTENDEES_PER_EGRESS participants.
const schema = require("../schema.js");

function joueur() {
  const quotas = [];
  let lectures = 0;
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.startsWith("doc_presentations?slug=eq.") && m === "GET") { lectures += 1; return [{ slug: "s", active: true, current_page: 3, control_hash: "h" }]; }
        if (chemin.startsWith("doc_presentation_attendees?slug=eq.")) return [];
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow(cle, max, fenetre) { if (cle.startsWith("patt:")) quotas.push({ cle, max, fenetre }); return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  return { p, quotas, lectures: () => lectures };
}

async function battre(p) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body: { action: "present-attend", slug: "s", key: "k1", name: "A" } }, res);
  return { statut: res.statusCode };
}

describe("quota de présence dimensionné pour une audience", () => {
  it("le quota par IP couvre au moins 250 participants (pas 1000 en dur)", async () => {
    const j = joueur();
    await battre(j.p);
    expect(j.quotas.length).toBe(1);
    // 250 participants × ~144 battements/h = 36 000 ; le quota doit au moins les couvrir.
    expect(j.quotas[0].max, "le 7e participant ne doit plus prendre un 429").toBeGreaterThanOrEqual(250 * Math.floor(3600 / 25));
    expect(j.quotas[0].fenetre).toBe(3600);
  });

  it("un battement ne relit la présentation qu'UNE fois (route → recordAttendance)", async () => {
    const j = joueur();
    await battre(j.p);
    expect(j.lectures(), "la route la charge déjà ; recordAttendance ne la relit pas").toBe(1);
  });
});
