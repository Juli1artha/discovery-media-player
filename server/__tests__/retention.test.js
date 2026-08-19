// LE MODULE DE RÉTENTION, AU DOUBLE — les propriétés qui ne demandent pas une vraie base :
// les filtres émis, les comptes déclarés depuis les lignes RENDUES, la sonde de schéma qui coupe
// la purge des liens sans la colonne 0013, les pièces jointes retirées seulement si l'hôte sait,
// et le tick qui ne passe qu'une fois par fenêtre. La confrontation aux contraintes réelles vit
// dans base/retention.test.js + le recensement SQL de la forge.
const retention = require("../retention.js");
const schema = require("../schema.js");

function harnais({ colonneDate = true, remove = null, lignes = {} } = {}) {
  const appels = [];
  // Un pool par table de journal : la sélection sert un LOT, la suppression par id=in.() le vide —
  // le double reproduit le contrat en lots (P2 huitième audit), pas le DELETE-en-un-coup d'avant.
  const pools = {};
  for (const [prefixe, reponse] of Object.entries(lignes)) {
    if (Array.isArray(reponse) && reponse.length && reponse[0] && ("id" in reponse[0] || "session_id" in reponse[0] || "key" in reponse[0])) {
      pools[prefixe] = reponse.map((r) => ({ ...r }));
    }
  }
  const ctx = {
    db: {
      async request(chemin, opts = {}) {
        const methode = opts.method || "GET";
        appels.push({ chemin, methode });
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) {
          if (!colonneDate) throw new Error("400 column revoked_at does not exist");
          return [];
        }
        if (methode === "DELETE") {
          // Vider le pool des ids présents dans in.(…) ET RENDRE les lignes parties (le moteur
          // compte les lignes rendues par le DELETE, pas les ids présélectionnés).
          let rendues = [];
          for (const [prefixe, pool] of Object.entries(pools)) {
            const tablePrefixe = prefixe.split("?")[0];
            if (chemin.startsWith(tablePrefixe + "?") && chemin.includes("=in.(")) {
              const dedans = chemin.slice(chemin.indexOf("in.(") + 4, chemin.lastIndexOf(")"));
              const dedans2 = (r) => dedans.includes('"' + String(r.id ?? r.session_id ?? r.key) + '"');
              rendues = pool.filter(dedans2);
              pools[prefixe] = pool.filter((r) => !dedans2(r));
            }
          }
          return chemin.includes("select=") ? rendues : [];
        }
        // Sélection d'un lot (SELECT … limit N) : curseur keyset + limite.
        const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
        const gt = /[?&][a-z_]+=gt\.([^&]+)/.exec(chemin);
        for (const [prefixe, pool] of Object.entries(pools)) {
          if (chemin.startsWith(prefixe)) {
            const cle = "id" in (pool[0] || {}) ? "id" : ("session_id" in (pool[0] || {}) ? "session_id" : "key");
            let res = pool;
            if (gt) { const c = decodeURIComponent(gt[1]); res = res.filter((r) => String(r[cle]) > c); }
            return res.slice(0, lim);
          }
        }
        for (const [prefixe, reponse] of Object.entries(lignes)) {
          if (pools[prefixe]) continue;
          if (chemin.startsWith(prefixe)) return reponse;
        }
        return [];
      },
      async selectAll() { return []; },
    },
    storage: remove ? { remove } : {},
    limits: { async allow() { return true; } },
    errors: { capture() {} },
    config: { supabaseUrl: "https://x.supabase.co" },
  };
  retention.init(ctx);
  schema.init(ctx);
  require("../presentations.js").init(ctx);
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
    expect(r.efface.commercial_doc_views, "les deux lignes semées partent").toBe(2);
    expect(r.efface.doc_presentations).toBe(0);
    // Chaque SÉLECTION de journal est bornée par sa date ET par une limite (le lot).
    const selections = appels.filter((a) => a.methode === "GET" && /select=(id|session_id|key)&order=/.test(a.chemin));
    expect(selections.length, "une sélection par table de journal").toBeGreaterThanOrEqual(5);
    for (const sel of selections) expect(sel.chemin, "sélection bornée en date et en taille").toMatch(/[?&](at|last_at|expires_at|revoked_at)=lt\.[^&]+.*limit=\d+/);
    // La seule table peuplée (views) reçoit un DELETE par id ; les autres, aucune (pool vide).
    const suppressions = appels.filter((a) => a.methode === "DELETE");
    expect(suppressions.length, "un seul lot supprimé : celui des views").toBe(1);
    expect(suppressions[0].chemin, "suppression par identifiants, pas par filtre de date").toMatch(/id=in\.\(/);
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
        "doc_presentation_messages?slug=eq.morte": [
          { id: "m1", attachment: "https://x.supabase.co/storage/v1/object/public/present-attachments/morte/photo.png?v=1" },
          { id: "m2", attachment: "https://ailleurs.exemple.fr/pas-a-nous.png" },
          { id: "m3", attachment: "https://x.supabase.co/storage/v1/object/public/present-attachments/../autre-bucket/secret.pdf" },
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
      "doc_presentation_messages?slug=eq.morte": [{ id: 1 }],   // un message ancien à supprimer par lot
    } });
    const r = await retention.purgerRetention(Date.now());
    expect(r.efface.pieces_jointes).toBe(0);
    expect(appels.some((a) => a.methode === "DELETE" && a.chemin.startsWith("doc_presentation_messages")), "les messages partent même sans retrait de fichiers").toBe(true);
  });

  it("le tick est OPT-IN STRICT : sans balayage:true écrit par l'hôte, il ne demande MÊME PAS le verrou", async () => {
    // Le second hôte consomme le contexte autonome tel quel : une purge par défaut aurait agi
    // chez lui sans décision. Supprimer n'agit que là où un exploitant l'a écrit.
    let demandes = 0, suppressions = 0;
    const faire = (config) => {
      const ctx = {
        db: { async request(chemin, opts = {}) {
          const m = opts.method || "GET";
          if (m === "DELETE") { suppressions += 1; return []; }
          if (chemin.startsWith("commercial_doc_views?at=lt")) return [{ id: "v1" }];   // une vieille ligne → un lot à supprimer
          return [];
        }, async selectAll() { return []; } },
        storage: {}, errors: { capture() {} }, config,
        limits: { async allow() { demandes += 1; return true; } },
      };
      retention.init(ctx); schema.init(ctx);
      retention.tick();
      return new Promise((r) => setTimeout(r, 30));
    };
    await faire({});
    await faire({ retention: {} });
    await faire({ retention: { balayage: false } });
    expect(demandes, "sans opt-in, pas même une demande de verrou").toBe(0);
    expect(suppressions).toBe(0);
    await faire({ retention: { balayage: true } });
    expect(demandes).toBe(1);
    expect(suppressions, "opté : le balayage tourne").toBeGreaterThan(0);
  });

  it("le tick opté ne balaie qu'avec la permission du verrou partagé — au plus un par fenêtre", async () => {
    let demandes = 0, permis = false, balayages = 0;
    const ctx = {
      db: { async request(chemin, opts = {}) {
        const m = opts.method || "GET";
        if (m === "DELETE") { balayages += 1; return []; }
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
        if (chemin.startsWith("commercial_doc_views?at=lt")) return [{ id: "v1" }];
        return [];
      }, async selectAll() { return []; } },
      storage: {}, errors: { capture() {} }, config: { retention: { balayage: true } },
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
