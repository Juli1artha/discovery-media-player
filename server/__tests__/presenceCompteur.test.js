// LE COMPTEUR DE TRANSITION DU JETON DE PRÉSENCE — avecJeton / sansJeton, ENSEMBLES QUI SE RECOUVRENT.
//
// ⚠️ P1c étape 2. `?schema=1` rend `presence: { avecJeton, sansJeton, tronque }` sur 24 h. `sansJeton===0`
// ⇒ plus aucun client legacy ne bat → on peut poser PLAYER_PRESENCE_STRICT. Les deux ensembles se
// recouvrent VOLONTAIREMENT (un participant qui a battu des deux façons compte dans les deux) — c'est
// le cœur du correctif à deux champs. Borné-ordonné-parlant, comme sansRang.

const schema = require("../schema.js");

function joueur({ avec = [], sans = [], strict = false } = {}) {
  const ctx = {
    errors: { capture() {} },
    config: { presenceStrict: strict },
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
    expect(etat.presence).toMatchObject({ avecJeton: 3, sansJeton: 1, tronque: false });
    // ⚠️ Le nombre voyage avec ce qu'il COUVRE : `avecJeton` inclut les bootstraps auto-déclarés, donc
    // ce n'est pas une preuve. Sans ce mot collé au nombre, « avecJeton: 40 » se lira « 40 prouvés ».
    expect(etat.presence.couvre, "la portée est collée au nombre, pas seulement en commentaire").toMatch(/jauge-de-migration/);
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

  // ⚠️ LA PLUS SUBTILE DE LA SÉRIE : le TEMPS périme ce compteur, sans qu'aucun commit soit coupable.
  // La page d'audience n'est jamais mise en cache et le code client est interpolé dedans → tout nouveau
  // visiteur est moderne par construction → une fois les vieux onglets éteints, `sansJeton` ne peut plus
  // JAMAIS être non nul. Il vaudra 0 que le mécanisme marche ou qu'il soit cassé. Un compteur qui ne peut
  // plus varier a cessé de mesurer, même s'il affiche encore la bonne valeur. Le texte doit donc le DIRE,
  // et il ne peut le dire qu'en suivant l'état de la porte — que la carte connaît.
  it("le texte SUIT l'état de la porte : instrument de transition avant, périmé après", async () => {
    joueur({ avec: ["a"], sans: ["b"], strict: false });
    const avant = await schema.sonderTout();
    expect(avant.presence.couvre, "porte ouverte : sansJeton est l'instrument qui dit quand fermer").toMatch(/jauge-de-migration/);
    expect(avant.presence.couvre, "et on prévient déjà qu'il se périmera").toMatch(/après fermeture il vaudra 0/);

    joueur({ avec: ["a"], sans: [], strict: true });
    const apres = await schema.sonderTout();
    expect(apres.presence.couvre, "porte fermée : le compteur ne mesure plus").toMatch(/PÉRIMÉE/);
    expect(apres.presence.couvre, "et on nomme ce qui prend le relais").toMatch(/signe de vie est avecJeton/);
    expect(apres.presence.couvre).not.toMatch(/0 = on peut fermer/);
  });

  it("borne atteinte : tronque=true", async () => {
    joueur({ avec: mille(), sans: [] });
    const etat = await schema.sonderTout();
    expect(etat.presence.tronque).toBe(true);
  });
});
