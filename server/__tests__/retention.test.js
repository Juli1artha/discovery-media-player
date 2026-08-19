// LE MODULE DE RÉTENTION, AU DOUBLE — les propriétés qui ne demandent pas une vraie base :
// les filtres émis, les comptes déclarés depuis les lignes RENDUES, la sonde de schéma qui coupe
// la purge des liens sans la colonne 0013, les pièces jointes retirées seulement si l'hôte sait,
// et le tick qui ne passe qu'une fois par fenêtre. La confrontation aux contraintes réelles vit
// dans base/retention.test.js + le recensement SQL de la forge.
const retention = require("../retention.js");
const schema = require("../schema.js");

function harnais({ colonneDate = true, remove = null, lignes = {} } = {}) {
  const appels = [];
  const ctx = {
    db: {
      async request(chemin, opts = {}) {
        appels.push({ chemin, methode: opts.method || "GET" });
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) {
          if (!colonneDate) throw new Error("400 column revoked_at does not exist");
          return [];
        }
        for (const [prefixe, reponse] of Object.entries(lignes)) {
          if (chemin.startsWith(prefixe)) return reponse;
        }
        return [];
      },
      async selectAll() { return []; },
    },
    storage: remove ? { remove } : {},
    limits: { async allow() { return true; } },
    errors: { capture() {} },
    config: {},
  };
  retention.init(ctx);
  schema.init(ctx);
  return { ctx, appels };
}

describe("rétention au double", () => {
  it("les comptes déclarés viennent des lignes RENDUES par le DELETE, table par table", async () => {
    const { appels } = harnais({ lignes: {
      "commercial_doc_views?at=lt.": [{ id: 1 }, { id: 2 }],
      "doc_presentations?active=eq.false": [],
    } });
    const r = await retention.purgerRetention(Date.UTC(2026, 7, 19));
    expect(r.ok).toBe(true);
    expect(r.efface.commercial_doc_views).toBe(2);
    expect(r.efface.doc_presentations).toBe(0);
    const suppressions = appels.filter((a) => a.methode === "DELETE");
    expect(suppressions.length, "cinq journaux + liens révoqués — pas de présentation morte semée").toBe(6);
    for (const s of suppressions) expect(s.chemin, "chaque DELETE est borné par un filtre").toMatch(/[?&](at|last_at|expires_at|revoked_at)=lt\./);
  });

  it("sans la colonne 0013, la purge des liens révoqués se TAIT — elle n'invente pas de borne", async () => {
    const { appels } = harnais({ colonneDate: false });
    const r = await retention.purgerRetention(Date.now());
    expect(r.efface.commercial_doc_shares).toBe(0);
    expect(appels.some((a) => a.methode === "DELETE" && a.chemin.startsWith("commercial_doc_shares")), "aucun DELETE de liens sans la date").toBe(false);
  });

  it("les pièces jointes ne partent que si l'hôte sait retirer — et par leur CHEMIN de bucket", async () => {
    const retires = [];
    harnais({
      remove: async (bucket, chemin) => { retires.push({ bucket, chemin }); return true; },
      lignes: {
        "doc_presentations?active=eq.false": [{ slug: "morte" }],
        "doc_presentation_messages?slug=eq.morte&attachment": [
          { attachment: "https://x.supabase.co/storage/v1/object/public/present-attachments/morte/photo.png?v=1" },
          { attachment: "https://ailleurs.exemple.fr/pas-a-nous.png" },
        ],
      },
    });
    const r = await retention.purgerRetention(Date.now());
    expect(r.efface.pieces_jointes, "la pièce du bucket part, l'URL étrangère est ignorée").toBe(1);
    expect(retires).toEqual([{ bucket: "present-attachments", chemin: "morte/photo.png" }]);
  });

  it("sans storage.remove, les lignes partent quand même — la limite est dite, pas simulée", async () => {
    const { appels } = harnais({ lignes: {
      "doc_presentations?active=eq.false": [{ slug: "morte" }],
    } });
    const r = await retention.purgerRetention(Date.now());
    expect(r.efface.pieces_jointes).toBe(0);
    expect(appels.some((a) => a.methode === "DELETE" && a.chemin.startsWith("doc_presentation_messages")), "les messages partent même sans retrait de fichiers").toBe(true);
  });

  it("le tick ne balaie qu'avec la permission du verrou partagé — au plus un par fenêtre", async () => {
    let demandes = 0, permis = false, balayages = 0;
    const ctx = {
      db: { async request(chemin, opts = {}) { if ((opts.method || "GET") === "DELETE") balayages += 1; if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return []; return []; }, async selectAll() { return []; } },
      storage: {}, errors: { capture() {} }, config: {},
      limits: { async allow(cle, max, fenetre) { demandes += 1; expect(cle).toBe("retention:sweep"); expect(max).toBe(1); expect(fenetre).toBe(86400); return permis; } },
    };
    retention.init(ctx); schema.init(ctx);
    retention.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(demandes).toBe(1);
    expect(balayages, "refusé par le verrou : aucun DELETE").toBe(0);
    permis = true;
    retention.tick();
    await new Promise((r) => setTimeout(r, 40));
    expect(balayages, "permis : le balayage tourne").toBeGreaterThan(0);
  });
});
