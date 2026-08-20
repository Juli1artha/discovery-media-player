// LE COMPTEUR DE TRANSITION DU JETON DE PRÉSENCE — avecJeton / sansJeton, ENSEMBLES QUI SE RECOUVRENT.
//
// ⚠️ P1c étape 2. `?schema=1` rend `presence: { avecJeton, sansJeton, tronque }` sur 24 h. `sansJeton===0`
// ⇒ plus aucun client legacy ne bat → on peut poser PLAYER_PRESENCE_STRICT. Les deux ensembles se
// recouvrent VOLONTAIREMENT (un participant qui a battu des deux façons compte dans les deux) — c'est
// le cœur du correctif à deux champs. Borné-ordonné-parlant, comme sansRang.

const schema = require("../schema.js");

function joueur({ avec = [], sans = [], strict = false, actives = [] } = {}) {
  const ctx = {
    errors: { capture() {} },
    config: { presenceStrict: strict },
    db: {
      async request(chemin) {
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];                       // sondes de colonnes présentes
        if (/last_token_at=gt\./.test(chemin)) return avec.map((slug) => ({ slug }));
        if (/last_no_token_at=gt\./.test(chemin)) return sans.map((slug) => ({ slug }));
        if (/doc_presentations\?active=eq\.true/.test(chemin)) return actives.map((slug) => ({ slug }));
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

  // ⚠️ LE RELAIS NE SE LIT PAS SEUL. Porte fermée, `avecJeton` devient le signe de vie — mais il vaut
  // zéro LÉGITIMEMENT hors présentation, l'état permanent d'une instance au repos. Sans le nombre de
  // présentations actives, « avecJeton: 0 » est indécidable, et le lecteur pressé saute le mot
  // « pendant ». On adjoint donc le nombre qui tranche, comme dontScellees l'a fait pour sansRang.
  it("presentationsActives rend avecJeton interprétable seul", async () => {
    joueur({ avec: [], sans: [], actives: [], strict: true });
    const repos = await schema.sonderTout();
    expect(repos.presence.presentationsActives, "rien ne tourne : 0 avecJeton est NORMAL").toBe(0);
    expect(repos.presence.couvre, "au repos, le texte dit REPOS").toMatch(/repos NORMAL/);

    joueur({ avec: [], sans: [], actives: ["p1", "p2"], strict: true });
    const anomalie = await schema.sonderTout();
    expect(anomalie.presence.presentationsActives, "deux présentations tournent…").toBe(2);
    expect(anomalie.presence.avecJeton, "…et personne n'est enregistré : ANOMALIE").toBe(0);
    expect(anomalie.presence.couvre, "le texte nomme l'anomalie du moment").toMatch(/ANOMALIE/);

    joueur({ avec: ["a", "b"], sans: [], actives: ["p1"], strict: true });
    const sain = await schema.sonderTout();
    expect(sain.presence.couvre, "présentation en cours ET des présences : rien d'anormal").toMatch(/les présences s'enregistrent/);
    expect(sain.presence.couvre).not.toMatch(/ANOMALIE/);
  });

  // ⚠️ LA GARDE QUI COMPTE, ET ELLE EST NÉE D'UNE VRAIE FAUTE. Une première version injectait
  // `presentationsActives` dans une phrase écrite pour N > 0, et rendait à N = 0 : « 0 active et 0
  // avecJeton = ANOMALIE ; 0 active et 0 avecJeton = repos normal » — les deux dans la même ligne.
  // Formellement construite, FAUSSE dans le cas du moment. Une phrase de diagnostic ne doit jamais
  // pouvoir affirmer une chose et son contraire : ce test l'interdit dans les trois régimes.
  it("le texte ne se CONTREDIT jamais : anomalie et repos ne coexistent pas", async () => {
    for (const cas of [
      { avec: [], sans: [], actives: [] },
      { avec: [], sans: [], actives: ["p1"] },
      { avec: ["a"], sans: [], actives: ["p1"] },
      { avec: ["a"], sans: ["b"], actives: ["p1", "p2"] },
    ]) {
      joueur({ ...cas, strict: true });
      const t = (await schema.sonderTout()).presence.couvre;
      const diagnostiqueUneAnomalie = /ANOMALIE/.test(t);
      const diagnostiqueUnRepos = /repos NORMAL/.test(t);
      expect(diagnostiqueUneAnomalie && diagnostiqueUnRepos,
        `le texte affirme À LA FOIS une anomalie et un repos : « ${t} »`).toBe(false);
    }
  });

  it("porte ouverte : le texte annonce déjà le relais à venir", async () => {
    joueur({ avec: ["a"], sans: ["b"], actives: ["p1"], strict: false });
    const etat = await schema.sonderTout();
    expect(etat.presence.couvre).toMatch(/relais sera avecJeton croisé avec presentationsActives/);
    expect(etat.presence.presentationsActives).toBe(1);
  });

  it("borne atteinte : tronque=true", async () => {
    joueur({ avec: mille(), sans: [] });
    const etat = await schema.sonderTout();
    expect(etat.presence.tronque).toBe(true);
  });
});
