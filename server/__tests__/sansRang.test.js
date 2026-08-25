// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA CARTE REND UN COMPTEUR INTERPRÉTABLE POUR `mod_seq` NUL — GELÉ vs RATTRAPAGE INCOMPLET.
//
// ⚠️ Relevé par le second hôte sur la 0.1.91, puis affiné en trois passes (0.1.92→0.1.94). Le rattrapage
// de 0016 laisse DÉLIBÉRÉMENT sans rang les messages des présentations scellées — mais rien ne distingue
// « nul par décision » de « nul parce que le rattrapage n'a jamais tourné ». `?schema=1` rend donc
// `sansRang: { total, dontScellees, tronque }` :
//   • égaux et non tronqué ⇒ tout nul est un scellé attendu ;
//   • divergents ⇒ des lignes non scellées sont restées sans rang (anomalie) ;
//   • tronqué ⇒ la borne a été atteinte, l'égalité N'EST PLUS lisible comme « tout va bien ».
// Le compteur est BORNÉ (pas de selectAll sur une table potentiellement entière → maxDuration → carte
// qui tombe) et TRIÉ (`order=slug.asc` : sans tri, Range double/saute des lignes sur une base vivante).

const schema = require("../schema.js");

function joueur({ scellees = [], nuls = [] } = {}) {
  const requetes = [];
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin) {
        requetes.push(chemin);
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];                                  // sondes de colonnes
        if (/doc_presentations\?active=eq\.false&control_hash=is\.null/.test(chemin)) return scellees.map((slug) => ({ slug }));
        if (/doc_presentation_messages\?mod_seq=is\.null/.test(chemin)) return nuls.map((slug) => ({ slug }));
        return [];
      },
    },
  };
  schema.oublier();
  schema.init(ctx);
  return { requetes };
}

const mille = (slug) => Array.from({ length: 1000 }, () => slug);

describe("carte de schéma — sansRang pour mod_seq", () => {
  it("tous les nuls sont scellés : total === dontScellees, non tronqué (état normal)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: ["s-scellee", "s-scellee"] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang).toEqual({ total: 2, dontScellees: 2, tronque: false });
  });

  it("un nul NON scellé : les deux divergent (rattrapage incomplet)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: ["s-scellee", "s-vivante"] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang.total).toBe(2);
    expect(etat.sansRang.dontScellees, "s-vivante n'est pas scellée → anomalie").toBe(1);
  });

  it("aucun message sans rang : total 0 (le cas sain, comme en prod)", async () => {
    joueur({ scellees: ["s-scellee"], nuls: [] });
    const etat = await schema.sonderTout();
    expect(etat.sansRang).toEqual({ total: 0, dontScellees: 0, tronque: false });
  });

  it("borne atteinte : tronque=true, l'égalité n'est plus lisible comme « tout va bien »", async () => {
    // 1000 nuls, tous du même slug scellé : sans le drapeau, total===dontScellees dirait « normal ».
    joueur({ scellees: ["s-scellee"], nuls: mille("s-scellee") });
    const etat = await schema.sonderTout();
    expect(etat.sansRang.tronque, "la liste a atteint le plafond → borne signalée").toBe(true);
  });

  it("les deux requêtes sont TRIÉES et BORNÉES (order=slug.asc & limit)", async () => {
    const j = joueur({ scellees: ["s"], nuls: ["s"] });
    await schema.sonderTout();
    const dataReqs = j.requetes.filter((c) => /active=eq\.false|mod_seq=is\.null/.test(c));
    expect(dataReqs.length).toBe(2);
    for (const c of dataReqs) {
      expect(c, "sans order=, Range double ou saute des lignes sur une base vivante").toMatch(/order=slug\.asc/);
      expect(c, "sans borne, un backfill jamais passé pagine la table entière").toMatch(/limit=\d+/);
    }
  });
});
