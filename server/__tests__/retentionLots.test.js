// LA PURGE AVANCE PAR LOTS BORNÉS, SE RÉPÈTE, ET SAIT NE RIEN FAIRE (dryRun).
//
// ⚠️ P2 DU HUITIÈME AUDIT. `return=representation` supprimait toutes les anciennes lignes d'un
// coup : réponse volumineuse, mémoire, WAL, verrous longs, timeout serverless. La purge
// sélectionne désormais un LOT d'identifiants (borné), les supprime par `id=in.(…)`, et
// recommence — jamais un DELETE non borné. Un rapport par table (examinées, supprimées, tronqué)
// remplace la liste d'identifiants. `dryRun` mesure sans rien effacer.

const retention = require("../retention.js");

function harnais({ vues = 0, dryRun = false, taille, plafond } = {}) {
  const selects = [];
  const deletes = [];
  let restantes = vues;
  const ctx = {
    db: {
      async request(chemin, opts = {}) {
        const m = (opts.method || "GET");
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
        if (chemin.includes("doc_presentations?active=eq.false")) return [];
        if (m === "DELETE") {
          deletes.push(chemin);
          const nb = (chemin.match(/,/g) || []).length + 1;   // nombre d'ids dans in.(…)
          restantes = Math.max(0, restantes - nb);
          return [];
        }
        if (chemin.startsWith("commercial_doc_views?at=lt")) {
          selects.push(chemin);
          const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 0);
          const n = Math.min(lim, restantes);
          return Array.from({ length: n }, (_, i) => ({ id: `v${restantes - i}` }));
        }
        return [];
      },
      async selectAll() { return []; },
    },
    storage: {}, limits: { async allow() { return true; } }, errors: { capture() {} },
    config: { supabaseUrl: "https://x.supabase.co", retention: {} },
  };
  retention.init(ctx);
  require("../schema.js").init(ctx);
  return { selects, deletes, resteReel: () => restantes, opts: { dryRun, taille, plafond } };
}

describe("purge par lots bornés", () => {
  it("250 vues anciennes, lots de 100 → aucun DELETE ne porte plus de 100 ids", async () => {
    const h = harnais({ vues: 250, taille: 100 });
    const r = await retention.purgerRetention(Date.now(), { taille: 100 });
    expect(r.ok).toBe(true);
    for (const d of h.deletes) {
      const nb = (d.match(/,/g) || []).length + 1;
      expect(nb, "un lot ne dépasse jamais la taille demandée").toBeLessThanOrEqual(100);
    }
    expect(r.rapport.commercial_doc_views.supprimees, "les 250 finissent par partir").toBe(250);
  });

  it("dryRun : mesure sans effacer — zéro DELETE, mais un rapport chiffré", async () => {
    const h = harnais({ vues: 120 });
    const r = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 50 });
    expect(h.deletes.length, "aucune suppression en dryRun").toBe(0);
    expect(r.rapport.commercial_doc_views.examinees, "il compte quand même").toBeGreaterThan(0);
    expect(r.rapport.commercial_doc_views.supprimees).toBe(0);
    expect(r.dryRun).toBe(true);
  });

  it("le plafond borne l'exécution et signale la troncature (reste à faire)", async () => {
    const h = harnais({ vues: 1000 });
    const r = await retention.purgerRetention(Date.now(), { taille: 100, plafond: 300 });
    const nbDeletes = h.deletes.length;
    expect(nbDeletes, "au plus plafond/taille lots").toBeLessThanOrEqual(3);
    expect(r.rapport.commercial_doc_views.tronque, "il reste à faire → tronqué").toBe(true);
  });

  it("le rapport porte la forme attendue par table", async () => {
    harnais({ vues: 10 });
    const r = await retention.purgerRetention(Date.now());
    const t = r.rapport.commercial_doc_views;
    for (const cle of ["examinees", "supprimees", "tronque"]) expect(t).toHaveProperty(cle);
  });
});
