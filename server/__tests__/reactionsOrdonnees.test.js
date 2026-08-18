// DEUX RÉACTIONS SIMULTANÉES S'ÉCRASAIENT.
//
// Lire le JSON, le modifier en mémoire, le réécrire en entier : deux participants qui réagissent
// au même message dans la même seconde lisent le même état, et la seconde écriture emporte la
// première — une réaction disparaît, sans erreur nulle part. Constat du troisième audit.
//
// Même remède que le pilotage (0002) : l'écriture porte le rang qu'elle a LU, la base ne
// l'accepte que s'il n'a pas bougé, sinon on relit et on rejoue.
//
// ⚠️ LE HARNAIS ÉVALUE LA CONDITION CONTRE LA LIGNE COURANTE — un harnais qui rend toujours
// « une ligne modifiée » validerait aussi l'ancien code, c'est toute la différence.

const presentations = require("../presentations.js");
const schema = require("../schema.js");

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";

function table({ colonne = true, patchsRefuses = 0 } = {}) {
  const etat = { reactions: {}, seq: 0, lectures: 0, patches: 0, refusRestants: patchsRefuses };
  const ctx = {
    errors: { capture() {} }, plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
    db: {
      async request(chemin, o) {
        if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h" }];
        if (chemin.includes("select=reactions_seq&limit=0")) {
          // la sonde de schéma — et ELLE SEULE : un motif plus large avalait aussi les lectures
          // du message (`select=reactions,reactions_seq`) et rendait des lignes vides au rejeu.
          if (!colonne) throw new Error("400 column does not exist");
          return [];
        }
        if (!o || !o.method) {
          etat.lectures += 1;
          if (chemin.includes("reactions_seq") && !colonne) throw new Error("400 column does not exist");
          return [{ id: 1, reactions: { ...etat.reactions }, reactions_seq: etat.seq }];
        }
        if (o.method === "PATCH") {
          etat.patches += 1;
          const m = /reactions_seq=eq\.(\d+)/.exec(chemin);
          if (m) {
            if (etat.refusRestants > 0) { etat.refusRestants -= 1; return []; }
            if (Number(m[1]) !== etat.seq) return [];       // rang dépassé : PostgREST ne modifie rien
          }
          etat.reactions = o.body.reactions;
          if (o.body.reactions_seq !== undefined) etat.seq = o.body.reactions_seq;
          return [{ id: 1, reactions: { ...etat.reactions }, author_hash: "x" }];
        }
        return [];
      },
    },
  };
  presentations.init(ctx);
  schema.init(ctx);
  return etat;
}

describe("deux réactions simultanées survivent toutes les deux", () => {
  it("le perdant du rang relit et rejoue : aucune réaction perdue", async () => {
    const t = table();
    await Promise.all([
      presentations.toggleReaction("s", 1, "👍", A, true),
      presentations.toggleReaction("s", 1, "👍", B, true),
    ]);
    const qui = (t.reactions["👍"] || []).slice().sort();
    expect(qui, "une des deux réactions simultanées a été écrasée").toEqual([A, B]);
  });

  it("chez un hôte non migré : pas de rang, mais les réactions marchent — dernier écrivain gagne, comme avant", async () => {
    const t = table({ colonne: false });
    const r = await presentations.toggleReaction("s", 1, "👍", A, true);
    expect(r.ok).toBe(true);
    expect(t.reactions["👍"]).toEqual([A]);
  });

  it("quatre tours perdus : 409 — refuser net vaut mieux qu'écraser les gagnants", async () => {
    const t = table({ patchsRefuses: 99 });
    const r = await presentations.toggleReaction("s", 1, "👍", A, true);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(t.patches, "le rejeu doit être borné").toBe(4);
  });
});
