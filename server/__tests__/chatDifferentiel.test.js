// LE CHAT SE RELIT EN DIFFÉRENTIEL — CE QUI A CHANGÉ DEPUIS LE CURSEUR, PAS LES 300 DERNIERS.
//
// ⚠️ P « architecture scalable ». `listMessages(slug, { after })` ne rend que les lignes dont le
// `mod_seq` (bumpé à chaque écriture, migration 0016) dépasse le curseur — nouveaux messages ET anciens
// mutés. Et il DÉGRADE : sur un hôte sans la colonne, il ignore `after` et sert les 300 derniers, sans
// jamais mettre `mod_seq` au select (PostgREST rejetterait la requête entière sur une colonne inconnue).

const presentations = require("../presentations.js");
const schema = require("../schema.js");

const TOUS = [
  { id: 1, body: "a", created_at: "2026-08-20T10:00:00Z", mod_seq: 3, deleted: false },
  { id: 2, body: "b", created_at: "2026-08-20T10:01:00Z", mod_seq: 4, deleted: false },
  { id: 3, body: "c", created_at: "2026-08-20T10:02:00Z", mod_seq: 7, deleted: false }, // muté récemment
  { id: 4, body: "d", created_at: "2026-08-20T10:03:00Z", mod_seq: 8, deleted: false },
];

function joueur({ seqPresent = true } = {}) {
  const appels = [];
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin) {
        appels.push(chemin);
        // Sonde de schéma : présence de la colonne mod_seq.
        if (/select=mod_seq&limit=0/.test(chemin)) {
          if (!seqPresent) throw new Error('column "mod_seq" does not exist');
          return [];
        }
        // Témoin (clé primaire de la plus vieille table) : présent.
        if (/^doc_presentations\?.*select=slug/.test(chemin) || /select=slug&limit=0/.test(chemin)) return [{ slug: "s" }];
        // Différentiel : mod_seq > curseur, en ordre de mod_seq.
        const gt = /mod_seq=gt\.(\d+)/.exec(chemin);
        if (gt) {
          const n = Number(gt[1]);
          return TOUS.filter((m) => m.mod_seq > n).sort((a, b) => a.mod_seq - b.mod_seq);
        }
        // Charge complète : les 300 plus récents (created_at desc), rendus tels quels ici.
        if (/order=created_at\.desc/.test(chemin)) return TOUS.slice().sort((a, b) => b.id - a.id);
        return [];
      },
    },
  };
  presentations.init(ctx);
  schema.init(ctx);
  return { appels, dernierAppelData: () => appels.filter((c) => c.startsWith("doc_presentation_messages")).pop() };
}

describe("chat différentiel", () => {
  it("avec un curseur : ne rend que ce qui a un mod_seq supérieur", async () => {
    const j = joueur({ seqPresent: true });
    const out = await presentations.listMessages("s", { after: 4 });
    expect(out.map((m) => m.id), "mod_seq 3 et 4 sont ≤ curseur, exclus").toEqual([3, 4]);
    expect(j.dernierAppelData()).toMatch(/mod_seq=gt\.4/);
  });

  it("le curseur renvoie le mod_seq au client (pour qu'il l'avance)", async () => {
    joueur({ seqPresent: true });
    const out = await presentations.listMessages("s", { after: 0 });
    expect(out.every((m) => typeof m.mod_seq === "number"), "chaque message porte son mod_seq").toBe(true);
    expect(Math.max(...out.map((m) => m.mod_seq))).toBe(8);
  });

  it("sans curseur : charge complète, mais mod_seq présent l'amorce", async () => {
    const j = joueur({ seqPresent: true });
    const out = await presentations.listMessages("s");
    expect(j.dernierAppelData(), "pas de différentiel sans curseur").toMatch(/order=created_at\.desc/);
    expect(j.dernierAppelData(), "mais mod_seq est demandé pour amorcer le client").toMatch(/mod_seq/);
    expect(out.length).toBe(4);
  });

  it("DÉGRADE : colonne absente → curseur ignoré, 300 derniers, sans mod_seq au select", async () => {
    const j = joueur({ seqPresent: false });
    const out = await presentations.listMessages("s", { after: 4 });
    const appel = j.dernierAppelData();
    expect(appel, "pas de différentiel sur un hôte non migré").not.toMatch(/mod_seq=gt/);
    expect(appel, "mod_seq ne doit pas figurer au select — PostgREST rejetterait tout").not.toMatch(/mod_seq/);
    expect(appel).toMatch(/order=created_at\.desc/);
    expect(out.length).toBe(4);
  });
});
