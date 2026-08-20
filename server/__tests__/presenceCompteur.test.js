// LE COMPTEUR DE TRANSITION DU JETON DE PRÉSENCE — avecJeton / sansJeton, ENSEMBLES QUI SE RECOUVRENT.
//
// ⚠️ P1c étape 2. `?schema=1` rend `presence: { avecJeton, sansJeton, tronque }` sur 24 h. `sansJeton===0`
// ⇒ plus aucun client legacy ne bat → on peut poser PLAYER_PRESENCE_STRICT. Les deux ensembles se
// recouvrent VOLONTAIREMENT (un participant qui a battu des deux façons compte dans les deux) — c'est
// le cœur du correctif à deux champs. Borné-ordonné-parlant, comme sansRang.

const schema = require("../schema.js");

function joueur({ avec = [], sans = [] } = {}) {
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin) {
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];                       // sondes de colonnes présentes
        if (/last_token_at=gt\./.test(chemin)) return avec.map((slug) => ({ slug }));
        if (/last_no_token_at=gt\./.test(chemin)) return sans.map((slug) => ({ slug }));
        return [];
      },
    },
  };
  schema.oublier();
  schema.init(ctx);
}

const mille = () => Array.from({ length: 1000 }, (_, i) => "s" + i);

describe("compteur de présence (transition du jeton)", () => {
  it("compte séparément avecJeton et sansJeton", async () => {
    joueur({ avec: ["a", "b", "c"], sans: ["x"] });
    const etat = await schema.sonderTout();
    expect(etat.presence).toEqual({ avecJeton: 3, sansJeton: 1, tronque: false });
  });

  it("sansJeton === 0 : la porte peut se fermer", async () => {
    joueur({ avec: ["a", "b"], sans: [] });
    const etat = await schema.sonderTout();
    expect(etat.presence.sansJeton).toBe(0);
  });

  it("les deux ensembles PEUVENT se recouvrir (même slug dans les deux)", async () => {
    // Un participant qui a battu avec ET sans jeton dans la fenêtre : compté des deux côtés, à dessein.
    joueur({ avec: ["s-mixte"], sans: ["s-mixte"] });
    const etat = await schema.sonderTout();
    expect(etat.presence.avecJeton).toBe(1);
    expect(etat.presence.sansJeton, "le recouvrement est voulu — sansJeton reste vrai").toBe(1);
  });

  it("borne atteinte : tronque=true", async () => {
    joueur({ avec: mille(), sans: [] });
    const etat = await schema.sonderTout();
    expect(etat.presence.tronque).toBe(true);
  });
});
