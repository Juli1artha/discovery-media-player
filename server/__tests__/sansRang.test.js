// LA CARTE REND UN COMPTEUR INTERPRÉTABLE POUR `mod_seq` NUL — GELÉ vs RATTRAPAGE INCOMPLET.
//
// ⚠️ Relevé par le second hôte sur la 0.1.91. Le rattrapage de 0016 laisse DÉLIBÉRÉMENT sans rang les
// messages des présentations scellées — mais rien ne distingue « nul par décision » de « nul parce que
// le rattrapage n'a jamais tourné ». `?schema=1` rend donc `sansRang: { total, dontScellees }` :
// égaux ⇒ tout nul est un scellé attendu ; divergents ⇒ des lignes non scellées sont restées sans rang.

const schema = require("../schema.js");

function joueur({ scellees = [], nuls = [] } = {}) {
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin) {
        // Toutes les sondes de colonnes (témoin + ATTENDUES) : présentes.
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
        // Présentations scellées.
        if (/doc_presentations\?active=eq\.false&control_hash=is\.null/.test(chemin)) return scellees.map((slug) => ({ slug }));
        // Messages sans rang.
        if (/doc_presentation_messages\?mod_seq=is\.null/.test(chemin)) return nuls.map((slug) => ({ slug }));
        return [];
      },
    },
  };
  schema.oublier();
  schema.init(ctx);
}

describe("carte de schéma — sansRang pour mod_seq", () => {
  it("tous les nuls sont scellés : total === dontScellees (état normal)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: ["s-scellee", "s-scellee"] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang).toEqual({ total: 2, dontScellees: 2 });
  });

  it("un nul NON scellé : les deux divergent (rattrapage incomplet)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: ["s-scellee", "s-vivante"] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang.total).toBe(2);
    expect(etat.sansRang.dontScellees, "s-vivante n'est pas scellée → anomalie").toBe(1);
    expect(etat.sansRang.total).not.toBe(etat.sansRang.dontScellees);
  });

  it("aucun message sans rang : total 0 (le cas sain, comme en prod)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: [] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang).toEqual({ total: 0, dontScellees: 0 });
  });
});
