// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// `retention.run` PASSE SES OPTIONS À LA PURGE — dryRun COMPRIS.
//
// ⚠️ P1 DU NEUVIÈME AUDIT. La route recevait bien `dryRun:true` mais appelait
// `purgerRetention(Date.now())` sans le second argument : la purge retombait à `dryRun:false` et
// SUPPRIMAIT réellement. Et c'est le pire cas — `dryRun` est ce qu'un exploitant lance EN PREMIER,
// en croyant ne rien risquer. Même classe que la clé tronquée et le backfill : l'option existe,
// est documentée et validée, mais la route ne la passe pas.
//
// On éprouve la ROUTE HTTP complète, pas seulement la fonction ; et une mutation qui retire le
// second argument doit faire tomber cet essai.

const schema = require("../schema.js");

function joueur() {
  const supprimes = [];
  const lignes = [{ id: "v-vieille" }];   // une ligne ancienne, prête à être purgée
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        const m = (o && o.method) || "GET";
        if (chemin.includes("limit=0")) return [];
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
        if (m === "DELETE") { supprimes.push(chemin); return []; }
        if (chemin.startsWith("commercial_doc_views?at=lt")) return lignes.slice(0, Number(/limit=(\d+)/.exec(chemin)?.[1] || 999));
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; }, isTrustedHostCall: (h) => h["x-player-host-secret"] === "hote" },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js");
  p.init(ctx); schema.init(ctx);
  return { p, supprimes };
}

async function poster(p, body) {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json", "x-player-host-secret": "hote" }, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("retention.run — les options traversent la route", () => {
  it("dryRun:true ne supprime RIEN et le dit", async () => {
    const { p, supprimes } = joueur();
    const r = await poster(p, { action: "retention.run", dryRun: true });
    expect(r.statut).toBe(200);
    expect(r.corps.dryRun, "la route annonce le dry-run").toBe(true);
    expect(supprimes.length, "aucun DELETE en dry-run").toBe(0);
  });

  it("sans dryRun, la purge supprime pour de vrai (le mode par défaut agit)", async () => {
    const { p, supprimes } = joueur();
    const r = await poster(p, { action: "retention.run" });
    expect(r.corps.dryRun).toBe(false);
    expect(supprimes.length, "une vraie purge efface").toBeGreaterThan(0);
  });

  it("une option invalide est refusée AVANT tout DELETE (400), rien supprimé", async () => {
    for (const mauvais of [{ dryRun: "true" }, { taille: 0 }, { taille: 501 }, { plafond: 99999 }, { plafond: -1 }, { inconnu: 1 }]) {
      const { p, supprimes } = joueur();
      const r = await poster(p, { action: "retention.run", ...mauvais });
      expect(r.statut, `option ${JSON.stringify(mauvais)} → 400`).toBe(400);
      expect(supprimes.length, "aucune suppression sur une option douteuse").toBe(0);
    }
  });
});
