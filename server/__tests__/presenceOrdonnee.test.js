// LE DERNIER LIRE-MODIFIER-RÉÉCRIRE DU DÉPÔT.
//
// Deux onglets du même participant battent dans la même seconde : les deux lisent la même ligne,
// la seconde réécriture emporte la première — une page vue disparaît des statistiques, sans erreur
// nulle part. Et deux PREMIERS battements simultanés : la clé primaire refusait le second en 409
// que personne ne rattrapait — un battement en 500, bénin mais faux.
//
// Fermé SANS migration : `last_seen` change à chaque battement accepté — un verrou optimiste
// gratuit. L'écriture est conditionnée à la valeur LUE ; zéro ligne = on relit et on rejoue.
//
// ⚠️ LE HARNAIS ÉVALUE LA CONDITION CONTRE LA LIGNE COURANTE, jamais contre celle qui a été lue.

const presentations = require("../presentations.js");

function table({ pageDeLaPresentation = () => 3, refusInsert = 0 } = {}) {
  const etat = { ligne: null, patches: 0, inserts: 0, refusRestants: refusInsert, benins: [] };
  presentations.init({
    errors: { capture(e, ctx) { if (ctx && ctx.benin) etat.benins.push(String(e.message)); } },
    db: {
      async request(chemin, o) {
        if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h", current_page: pageDeLaPresentation() }];
        if (!o || !o.method) return etat.ligne ? [{ ...etat.ligne, pages: etat.ligne.pages.slice() }] : [];
        if (o.method === "POST") {
          etat.inserts += 1;
          if (etat.refusRestants > 0) {
            etat.refusRestants -= 1;
            // L'autre onglet a gagné la clé primaire : SA ligne existe au moment où le nôtre
            // apprend le conflit — c'est elle que la relecture doit trouver.
            etat.ligne = { slug: "s", attendee_key: "onglet", last_seen: new Date(Date.now() - 5000).toISOString(), total_ms: 0, pages: [1], name: "Visiteur", avatar: null, is_member: false, is_presenter: false };
            throw new Error("Supabase POST → 409 duplicate key");
          }
          if (etat.ligne) throw new Error("Supabase POST → 409 duplicate key");
          etat.ligne = { ...o.body[0] };
          return [];
        }
        if (o.method === "PATCH") {
          etat.patches += 1;
          const m = /last_seen=eq\.([^&]+)/.exec(chemin);
          if (m && (!etat.ligne || decodeURIComponent(m[1]) !== etat.ligne.last_seen)) return [];
          Object.assign(etat.ligne, o.body);
          return [{ ...etat.ligne }];
        }
        return [];
      },
    },
  });
  return etat;
}

const battre = (page) => presentations.recordAttendance("s", null, { key: "onglet", name: "Visiteur" });

describe("deux battements simultanés du même participant survivent tous les deux", () => {
  it("la page vue par le perdant du verrou n'est pas perdue", async () => {
    // ⚠️ L'HORLOGE EST FIGÉE, ET C'EST LE CŒUR DE L'ESSAI. Deux battements dans la MÊME
    // milliseconde écrivent le même last_seen : sans le « strictement croissant », la condition du
    // second matche encore et l'écrasement revient par la fenêtre fermée. Horloge libre, la rafale
    // n'existe que par chance — la mutation qui retirait le +1 a survécu à la première série.
    const horloge = vi.spyOn(Date, "now").mockReturnValue(1755525600000);
    try {
    let page = 3;
    const t = table({ pageDeLaPresentation: () => page });
    await battre();                                        // la ligne existe, pages: [3]
    page = 5;
    // Deux battements « en même temps » : les lectures se font sur le même état, les écritures
    // se départagent au verrou. Le perdant doit relire et rejouer — pas écraser.
    page = 5; const a = battre();
    page = 7; const b = battre();
    await Promise.all([a, b]);

    expect(t.ligne.pages.slice().sort(), "une page vue a été écrasée par l'autre onglet").toEqual([3, 5, 7]);
    } finally { horloge.mockRestore(); }
  });

  it("deux PREMIERS battements : le second rattrape le 409 et devient une mise à jour", async () => {
    const t = table({ refusInsert: 1 });
    const r = await battre();
    expect(r.ok, "un battement en 500 pour un conflit de clé primaire").toBe(true);
    expect(t.ligne.pages).toContain(3);
    expect(t.benins.length, "le conflit rattrapé doit parler — la garde des écritures muettes l'exige").toBe(1);
  });

  it("un autre échec d'insertion REMONTE — le rattrapage ne vaut que pour le conflit", async () => {
    const etat = { };
    presentations.init({
      errors: { capture() {} },
      db: { async request(chemin, o) {
        if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h", current_page: 1 }];
        if (!o || !o.method) return [];
        if (o.method === "POST") throw new Error("Supabase POST → 500 base en feu");
        return [];
      } },
    });
    void etat;
    await expect(battre()).rejects.toThrow(/500/);
  });

  it("le chemin ordinaire : un battement seul écrit temps et page, une fois", async () => {
    const t = table();
    await battre();
    expect(t.inserts).toBe(1);
    await battre();
    expect(t.patches).toBe(1);
    expect(t.ligne.pages).toEqual([3]);
  });
});
