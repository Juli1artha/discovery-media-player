// UNE FENÊTRE DE RÉTENTION INVALIDE NE SUPPRIME RIEN — ELLE REFUSE.
//
// ⚠️ P2 HAUTE DU HUITIÈME AUDIT. `config.retention` était fusionné sans validation :
//   • `journauxMois: -1` calcule une borne FUTURE → presque tout devient éligible à la
//     suppression (une faute de config = perte massive) ;
//   • `Date.setMonth(-1)` depuis le 31 mars donne le 3 mars, pas le 28 février (débordement) ;
//   • l'heure locale + le changement d'heure décalaient la borne.
// La borne se calcule donc en UTC, rabattue au dernier jour du mois cible ; et toute fenêtre non
// entière, hors [1,120], NaN, Infinity, négative ou nulle fait ÉCHOUER la purge AVANT le premier
// DELETE — jamais une suppression sur une config douteuse.

const retention = require("../retention.js");

function harnais(retentionCfg) {
  const suppressions = [];
  const ctx = {
    db: {
      async request(chemin, opts = {}) {
        if ((opts.method || "GET") === "DELETE") { suppressions.push(chemin); return []; }
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
        return [];
      },
      async selectAll() { return []; },
    },
    storage: {}, limits: { async allow() { return true; } }, errors: { capture() {} },
    config: { supabaseUrl: "https://x.supabase.co", retention: retentionCfg },
  };
  retention.init(ctx);
  require("../schema.js").init(ctx);
  return { suppressions };
}

describe("les fenêtres de rétention sont validées avant tout DELETE", () => {
  const AVRIL = Date.UTC(2026, 3, 15); // 15 avril 2026

  it("bornes calculées en UTC, à l'ISO — 13 mois avant avril 2026 = mars 2025", () => {
    expect(retention.borne(AVRIL, 13)).toBe(new Date(Date.UTC(2025, 2, 15)).toISOString());
  });

  it("débordement de fin de mois RABATTU : 31 mars − 1 mois = 28 février, jamais le 3 mars", () => {
    const MARS31 = Date.UTC(2026, 2, 31);
    const b = new Date(retention.borne(MARS31, 1));
    expect(b.getUTCMonth(), "février = mois 1").toBe(1);
    expect(b.getUTCDate(), "28 février 2026 (non bissextile)").toBe(28);
  });

  it("année bissextile : 31 mars 2028 − 1 mois = 29 février", () => {
    const b = new Date(retention.borne(Date.UTC(2028, 2, 31), 1));
    expect(b.getUTCMonth()).toBe(1);
    expect(b.getUTCDate()).toBe(29);
  });

  for (const [nom, cfg] of [
    ["négative", { journauxMois: -1 }],
    ["nulle", { journauxMois: 0 }],
    ["non entière", { journauxMois: 6.5 }],
    ["hors plage haute", { journauxMois: 121 }],
    ["NaN", { journauxMois: NaN }],
    ["Infinity", { presentationsMois: Infinity }],
    ["chaîne", { liensRevoquesMois: "12" }],
  ]) {
    it(`une fenêtre ${nom} fait ÉCHOUER la purge SANS aucun DELETE`, async () => {
      const { suppressions } = harnais(cfg);
      const r = await retention.purgerRetention(Date.now());
      expect(r.ok, "config invalide → refus").toBe(false);
      expect(r.error).toBeTruthy();
      expect(suppressions.length, "aucune suppression sur une config douteuse").toBe(0);
    });
  }

  it("une config VALIDE (entiers 1–120) laisse la purge tourner", async () => {
    const { suppressions } = harnais({ journauxMois: 13, presentationsMois: 12, liensRevoquesMois: 13 });
    const r = await retention.purgerRetention(Date.now());
    expect(r.ok).toBe(true);
    expect(suppressions.length).toBeGreaterThan(0);
  });
});
