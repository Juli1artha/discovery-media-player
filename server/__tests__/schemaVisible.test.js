// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ LA TRACE EXISTAIT À L'ENDROIT EXACT OÙ PERSONNE NE REGARDE.
//
// Une colonne absente était signalée par un `console.warn`, une fois par processus. Sur une
// fonction serverless, c'est une ligne perdue dans une sortie que personne n'ouvre tant que tout a
// l'air de marcher — et « tout a l'air de marcher » est précisément l'état d'un hôte dont trois
// protections dorment en silence. Remarque du second hôte, et elle était juste.
//
// L'état du schéma est donc rapporté par la carte d'identité, que les hôtes interrogent déjà.

const schema = require("../schema.js");

function contexte(repond) {
  return {
    plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
    db: { async request(chemin) { if (!repond(chemin)) throw new Error("400 column does not exist"); return []; } },
  };
}

const TOUT = () => true;
const SAUF_CLE = (chemin) => !chemin.includes("client_key");

describe("l'état du schéma se lit ailleurs que dans un journal", () => {
  it("⚠️ rien de sondé n'est PAS rien de manquant", async () => {
    schema.init(contexte(TOUT));
    const etat = schema.etatDuSchema();
    expect(etat.manquant).toEqual([]);
    // Sans ce compteur, un processus qui n'a rien demandé se lirait « tout va bien » — une absence
    // de résultat qui ressemble à un résultat.
    expect(etat.sondees, "rien ne distingue « aucun défaut » de « aucune question posée »").toBe(0);
    expect(etat.attendues).toBeGreaterThan(0);
  });

  it("une colonne absente apparaît, avec le fichier à appliquer et la fonction qui dort", async () => {
    schema.init(contexte(SAUF_CLE));
    expect(await schema.attendue("envoiUnique")).toBe(false);

    const etat = schema.etatDuSchema();
    expect(etat.sondees).toBe(1);
    expect(etat.manquant).toHaveLength(1);
    expect(etat.manquant[0].migration).toContain("0005-envoi-unique.sql");
    // ⚠️ Le nom du fichier SEUL renverrait l'exploitant lire du SQL pour savoir ce qu'il perd.
    expect(etat.manquant[0].fonction, "on dit quoi appliquer, jamais ce qu'on y gagne").toBeTruthy();
  });

  it("une colonne présente ne figure pas dans les manques", async () => {
    schema.init(contexte(TOUT));
    expect(await schema.attendue("envoiUnique")).toBe(true);
    const etat = schema.etatDuSchema();
    expect(etat.sondees).toBe(1);
    expect(etat.manquant).toEqual([]);
  });

  // ⚠️ La carte d'identité doit répondre QUAND LA BASE NE RÉPOND PLUS : c'est sa raison d'être.
  it("rapporter ne demande rien à la base", async () => {
    let appels = 0;
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request() { appels += 1; return []; } },
    });
    await schema.attendue("rangEcriture");
    const avant = appels;
    schema.etatDuSchema(); schema.etatDuSchema();
    expect(appels, "la carte sonde au lieu de rapporter : elle tombera avec la base").toBe(avant);
  });

  it("un nom d'attente inconnu est une faute de câblage, pas une dégradation", async () => {
    schema.init(contexte(TOUT));
    expect(() => schema.attendue("nExistePas")).toThrow(/inconnue/);
  });

  // ⚠️ L'inventaire est la SOURCE, pas une copie pour l'affichage : c'est ce qui empêche de refaire,
  // en plus petit, le défaut qui avait vidé init.sql de ses cinq migrations.
  it("chaque attente déclarée nomme un fichier de migration qui existe", () => {
    const fs = require("node:fs"), path = require("node:path");
    const racine = path.join(__dirname, "..", "..");
    for (const [nom, a] of Object.entries(schema.ATTENDUES)) {
      expect(fs.existsSync(path.join(racine, a.migration)), `${nom} → ${a.migration}`).toBe(true);
      expect(a.table && a.colonne && a.fonction, nom).toBeTruthy();
    }
  });
});

// ⚠️ « MANQUANT: [] » A QUATRE SENS, ET LE LECTEUR NE DOIT PAS AVOIR À LES RECONSTITUER.
//
// Rien demandé, tout vérifié, vérifié en partie, base muette. Croiser deux champs pour trancher,
// c'est laisser la faute au lecteur — condition posée par le second hôte avant même de voir le
// paramètre, et elle évitait de recréer, DANS le correctif, l'ambiguïté que `sondees` venait de
// tuer. Même défaut qu'init.sql reproduit dans sa propre correction.
describe("sonder à la demande dit ce qu'il a pu voir, et ce qu'il n'a pas pu", () => {
  const schema = require("../schema.js");

  function base({ temoin = true, absentes = [] }) {
    let requetes = 0;
    return {
      compte: () => requetes,
      ctx: {
        plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
        db: { async request(chemin) {
          requetes += 1;
          const estTemoin = chemin.startsWith(`${schema.TEMOIN.table}?select=${schema.TEMOIN.colonne}`);
          if (estTemoin && !temoin) throw new Error("base injoignable");
          if (!estTemoin && !temoin) throw new Error("base injoignable");
          if (absentes.some((c) => chemin.includes(c))) throw new Error("400 column does not exist");
          return [];
        } },
      },
    };
  }

  it("tout présent : verdict complet, et toutes les attentes sondées", async () => {
    const b = base({}); schema.init(b.ctx);
    const etat = await schema.sonderTout();
    expect(etat.verdict).toBe("complet");
    expect(etat.sondees).toBe(etat.attendues);
    expect(etat.manquant).toEqual([]);
  });

  it("une absente : verdict incomplet, et elle est nommée", async () => {
    const b = base({ absentes: ["client_key"] }); schema.init(b.ctx);
    const etat = await schema.sonderTout();
    expect(etat.verdict).toBe("incomplet");
    expect(etat.manquant.map((m) => m.migration).join()).toContain("0005");
  });

  // ⚠️ LE CŒUR DE LA CONDITION. Sans témoin, une base muette fait échouer les trois sondes et la
  // carte annonce trois migrations manquantes QUI EXISTENT — l'exploitant part appliquer ce qu'il a
  // déjà. Faux dans l'autre sens que redouté, faux quand même.
  it("base muette : verdict indetermine, et AUCUN manque inventé", async () => {
    const b = base({ temoin: false }); schema.init(b.ctx);
    const etat = await schema.sonderTout();
    expect(etat.verdict, "une base muette se lit comme trois migrations absentes").toBe("indetermine");
    expect(etat.manquant, "des manques inventés envoient appliquer ce qui est déjà là").toEqual([]);
  });

  // ⚠️ ET UN DIAGNOSTIC NE DOIT PAS ÉTEINDRE CE QU'IL DIAGNOSTIQUE. `aLaColonne` retient sa réponse
  // pour la vie du processus : sonder pendant un hoquet aurait mis « absente » en cache pour les
  // trois, désactivant l'ordre des écritures et l'idempotence jusqu'au prochain démarrage.
  it("base muette : rien n'est retenu, la fonction remarche dès que la base revient", async () => {
    // ⚠️ SANS `init()` ENTRE LA PANNE ET LA REPRISE. La première version de cet essai en appelait
    // un — qui vide précisément le cache : il prouvait une guérison qui n'existait pas. C'est le
    // troisième audit qui l'a vu. La base est donc COMMUTABLE : même processus, même contexte.
    let enPanne = true;
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request() { if (enPanne) throw new Error("base injoignable"); return []; } },
    });
    await schema.sonderTout();
    expect(schema.etatDuSchema().sondees, "le diagnostic a mis les attentes en cache à ABSENT").toBe(0);

    enPanne = false;                     // la base revient — le processus, lui, ne redémarre pas
    expect(await schema.attendue("envoiUnique"), "une panne passagère a éteint la fonction pour de bon").toBe(true);
  });

  // ⚠️ UN MANQUE TRANCHE SEUL, MÊME PARTIELLEMENT SONDÉ — et rien ne l'exigeait : une mutation qui
  // n'annonçait « incomplet » qu'une fois TOUT sondé a survécu à la première série. Le chemin
  // ordinaire ne sonde qu'une attente à la fois (le chat sonde la clé, jamais le rang) : sans cette
  // règle, une colonne constatée absente se serait affichée « partiel », c'est-à-dire rassurante.
  it("une seule attente sondée et absente : incomplet, jamais partiel", async () => {
    const b = base({ absentes: ["client_key"] }); schema.init(b.ctx);
    expect(await schema.attendue("envoiUnique")).toBe(false);

    const etat = schema.etatDuSchema();
    expect(etat.sondees).toBeLessThan(etat.attendues);
    expect(etat.verdict, "un manque constaté se dilue dans « partiel »").toBe("incomplet");
  });

  it("le témoin est demandé AVANT les attentes — sinon il n'arbitre rien", async () => {
    const chemins = [];
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request(c) { chemins.push(c); return []; } },
    });
    await schema.sonderTout();
    expect(chemins[0]).toContain(schema.TEMOIN.table);
    expect(chemins[0]).toContain(schema.TEMOIN.colonne);
  });
});

// ⚠️ NOTRE ESSAI DE RÉCUPÉRATION PROUVAIT UNE GUÉRISON QUI N'EXISTAIT PAS.
//
// Il appelait `schema.init()` entre la panne et la reprise — or `init()` vide précisément le cache.
// En production, `init()` tourne au démarrage, pas après chaque retour de la base : une panne
// passagère pendant l'usage normal restait mémorisée « absente » pour la vie du processus, et la
// fonction restait éteinte. Trouvé par le troisième audit. Ces essais rejouent la guérison SANS
// init() — le seul chemin qui existe vraiment en production.
describe("un « non » n'a pas la même durée de vie qu'un « oui »", () => {
  const schema = require("../schema.js");

  function baseCommutable() {
    const etat = { enPanne: false, requetes: 0 };
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request(chemin) {
        etat.requetes += 1;
        if (etat.enPanne) throw new Error("base injoignable");
        void chemin;
        return [];
      } },
    });
    return etat;
  }

  it("panne pendant l'usage normal, puis sonderTout : la fonction revit — SANS init()", async () => {
    const b = baseCommutable();
    b.enPanne = true;
    expect(await schema.attendue("envoiUnique"), "pendant la panne, la sonde dit non").toBe(false);

    b.enPanne = false;                       // la base revient ; le processus, lui, ne redémarre pas
    const etat = await schema.sonderTout();

    expect(etat.verdict, "le diagnostic ressert la valeur d'un incident passé").toBe("complet");
    expect(await schema.attendue("envoiUnique"), "la fonction est restée éteinte après la guérison").toBe(true);
  });

  it("le « non » expire tout seul : passé le délai, la question est reposée", async () => {
    const b = baseCommutable();
    b.enPanne = true;
    const ici = Date.now();
    const horloge = vi.spyOn(Date, "now").mockReturnValue(ici);
    try {
      expect(await schema.attendue("envoiUnique")).toBe(false);

      b.enPanne = false;
      // Avant l'échéance : la réponse en cache sert encore — un hôte non migré ne paie pas une
      // sonde par écriture.
      const avant = b.requetes;
      expect(await schema.attendue("envoiUnique")).toBe(false);
      expect(b.requetes, "un non frais doit servir depuis le cache").toBe(avant);

      horloge.mockReturnValue(ici + 61 * 1000);
      expect(await schema.attendue("envoiUnique"), "le non a expiré, la base va bien : oui").toBe(true);
    } finally { horloge.mockRestore(); }
  });

  it("un « oui » ne périme pas : aucune re-sonde, même bien plus tard", async () => {
    const b = baseCommutable();
    const ici = Date.now();
    const horloge = vi.spyOn(Date, "now").mockReturnValue(ici);
    try {
      expect(await schema.attendue("envoiUnique")).toBe(true);
      const avant = b.requetes;
      horloge.mockReturnValue(ici + 3600 * 1000);
      await schema.attendue("envoiUnique");
      expect(b.requetes, "un oui stable a été re-sondé").toBe(avant);
    } finally { horloge.mockRestore(); }
  });

  it("sonderTout ne jette que les « non » : les « oui » ne coûtent pas une re-sonde", async () => {
    const b = baseCommutable();
    expect(await schema.attendue("envoiUnique")).toBe(true);   // un oui en cache
    b.enPanne = true;
    expect(await schema.attendue("rangEcriture")).toBe(false); // un non en cache
    b.enPanne = false;

    const avant = b.requetes;
    await schema.sonderTout();
    // Témoin (1) + toutes les attentes SAUF celle déjà positive. Dérivé de l'inventaire, pas
    // figé : un compte en dur avait rougi à la simple arrivée d'une quatrième attente — la garde
    // accusait alors l'inventaire d'avoir grandi, ce qui n'est pas un défaut.
    const couts = b.requetes - avant;
    // +6 = les bilans de données que sonderTout mesure AUSSI : `sansRang` (scellées + messages sans
    // rang, +2), `presence` (avecJeton + sansJeton + présentations actives, +3) et la sonde de
    // DURCISSEMENT (+1). Six requêtes fixes, indépendantes de l'inventaire des sondes de colonnes.
    //
    // ⚠️ Le +1 est assumé : 0018 remplace une FONCTION, aucune sonde de colonne ne peut la voir, et
    // `presenceDurcissement` est un rapport d'exécution qui rend « inconnu » sur toute instance au
    // repos. La question « la migration est-elle là ? » porte sur la BASE ; elle se pose à la base ou
    // pas du tout. Opt-in (`?schema=1`) et mutualisée 30 s.
    expect(couts, "un oui a été re-sondé, ou un non ne l'a pas été").toBe(1 + Object.keys(schema.ATTENDUES).length - 1 + 6);
  });
});

// ⚠️ LA SONDE EST PUBLIQUE — chaque appel coûtait des requêtes base, autant qu'on veut. La carte
// devenait un petit amplificateur : la ressource PARTAGÉE paie, jamais l'appelant.
describe("la sonde publique ne se laisse pas jouer en boucle", () => {
  const schema = require("../schema.js");

  function baseComptee() {
    const etat = { requetes: 0 };
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request() { etat.requetes += 1; return []; } },
    });
    return etat;
  }

  it("deux appels simultanés partagent UNE sonde", async () => {
    const b = baseComptee();
    await Promise.all([schema.sonderTout(), schema.sonderTout()]);
    // témoin + une sonde par attente + 6 (sansRang [+2], presence [+3], durcissement [+1]) — une
    // seule fois, pas deux : les appels simultanés partagent la sonde.
    expect(b.requetes).toBe(1 + Object.keys(schema.ATTENDUES).length + 6);
  });

  it("dans la fenêtre, le résultat resservi ne coûte RIEN à la base", async () => {
    const b = baseComptee();
    const ici = Date.now();
    const horloge = vi.spyOn(Date, "now").mockReturnValue(ici);
    try {
      await schema.sonderTout();
      const avant = b.requetes;
      await schema.sonderTout();
      expect(b.requetes, "chaque appel de la route publique touche la base").toBe(avant);

      horloge.mockReturnValue(ici + 31 * 1000);
      await schema.sonderTout();
      expect(b.requetes, "le cache ne doit pas être éternel : une migration appliquée doit se voir").toBeGreaterThan(avant);
    } finally { horloge.mockRestore(); }
  });
});

// ⚠️ « L'IDENTITÉ INTERNE VIENT-ELLE D'UN JETON, OU DU NAVIGATEUR ? » — la carte doit le dire.
// En mode transitoire, la route interne accepte docId/email/name déclarés par le client : un
// appelant peut fabriquer « tel collègue a consulté tel document ». Un cockpit ne peut refuser que
// ce qu'il peut mesurer. Cinquième audit, P1-4 — champ demandé par le second hôte.
describe("la carte dit si l'identité interne est signée", () => {
  async function carte(config, identity) {
    delete require.cache[require.resolve("../handler.js")];
    const player = require("../handler.js");
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } },
      mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; }, ...(identity || {}) },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture() {} },
      legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], ...config },
    });
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    return JSON.parse(res.body);
  }

  // ⚠️ UN RÉGLAGE QU'ON NE PEUT PAS OBSERVER EST UN RÉGLAGE QU'ON CROIT AVOIR FAIT. Après avoir posé
  // PLAYER_PRESENCE_SECRET, la carte affichait `presence: {0,0}` — exactement pareil que si la variable
  // avait été mal nommée, posée sur le mauvais environnement, ou non redéployée. Il a fallu monter une
  // présentation jetable EN PROD pour savoir. Ce booléen répond à la place, et il MESURE (il appelle la
  // fonction) au lieu de DÉCLARER (un `config.presenceJetons` que l'hôte annoncerait) : un fait en deux
  // exemplaires finirait par diverger, et c'est celui qu'on annonce qu'on croirait.
  it("presenceJetons MESURE l'émission : true si un jeton sort, false sinon", async () => {
    const avecSecret = await carte({}, { signPresenceToken: () => "un.jeton" });
    expect(avecSecret.presenceJetons, "un jeton sort → l'émission est en service").toBe(true);

    // Secret absent : le contexte rend "" (c'est ce que font les deux contextes réels sans secret).
    const sansSecret = await carte({}, { signPresenceToken: () => "" });
    expect(sansSecret.presenceJetons, "aucun jeton ne sort → l'exploitant doit le VOIR").toBe(false);

    // Hôte trop ancien pour connaître la fonction : false, jamais absent ni une exception.
    const vieilHote = await carte({});
    expect(vieilHote.presenceJetons).toBe(false);

    // Une fonction qui lève ne doit pas emporter la carte — elle doit répondre quand rien ne répond.
    const cassee = await carte({}, { signPresenceToken: () => { throw new Error("boum"); } });
    expect(cassee.presenceJetons).toBe(false);
    expect(cassee.contract, "la carte répond quand même").toBe(1);
  });

  // ⚠️ STRICT DÉCLARÉ MAIS INERTE NE DOIT PAS SE LIRE « FERMÉ ». Sans capacité d'émettre, le refuser
  // vraiment expulserait tous les anonymes : la porte reste ouverte, et la carte doit le dire — c'est
  // ce booléen qu'un cockpit lit pour décider.
  it("presenceStrict est EFFECTIF : posé sans capacité d'émettre, il se lit false", async () => {
    const inerte = await carte({ presenceStrict: true }, { signPresenceToken: () => "" });
    expect(inerte.presenceStrict, "annoncer fermé quand c'est ouvert est le pire des deux").toBe(false);
    expect(inerte.presenceJetons, "et la carte dit pourquoi").toBe(false);

    const arme = await carte({ presenceStrict: true }, { signPresenceToken: () => "j" });
    expect(arme.presenceStrict).toBe(true);
  });

  it("strict configuré : true — non configuré : false, jamais absent", async () => {
    expect((await carte({ internalStrict: true })).internalStrict).toBe(true);
    const nue = await carte({});
    expect(nue.internalStrict, "absent, un cockpit ne peut pas refuser — false doit être DIT").toBe(false);
  });
});

// ⚠️ 0018 EST UNE PROPRIÉTÉ DE LA BASE — ET NOTRE CONSIGNE DE PRÉ-VOL EXIGEAIT UNE RÉPONSE D'UN
// CHAMP CONSTRUIT POUR N'EN DONNER AUCUNE.
//
// Relevé par le second hôte : nous avions écrit « vérifiez presenceDurcissement avant de monter ;
// s'il rend degrade, appliquez 0018 ». Sur toute instance au repos il rend « inconnu » — jamais
// « degrade » — et un hôte suivant la consigne à la lettre aurait conclu « je peux monter », pour
// découvrir le refus à la première présentation. Nous avions bâti un champ qui refuse de se
// prononcer sans observation, puis placé ce champ au centre d'une procédure qui exige une réponse.
//
// La question porte sur la BASE : elle se pose à la base.
describe("la sonde de durcissement dit une propriété GLOBALE, pas une observation locale", () => {
  const schema = require("../schema.js");

  function joueur(reponseRpc) {
    const journal = [];
    schema.oublier();
    schema.init({
      plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
      errors: { capture(e) { journal.push(String(e && e.message)); } },
      limits: { async allow() { return true; } },
      db: {
        async request(chemin) {
          if (chemin.startsWith("rpc/player_attendance_bump")) return reponseRpc();
          return [];
        },
      },
    });
    return journal;
  }

  const PGRST202 = () => { throw Object.assign(new Error("Supabase"), { statusCode: 404, details: { code: "PGRST202" } }); };

  it("0018 en base → « applique », même sans aucune présentation", async () => {
    joueur(() => [{ ok: false, created: false, capped: true, usurpe: false }]);
    const etat = await schema.sonderTout();
    expect(etat.durcissementBase,
      "c'est LE champ qu'on lit avant un déploiement — il doit répondre au repos").toBe("applique");
  });

  it("0018 absente → « absente », et l'exploitant en est AVERTI sans attendre une présentation", async () => {
    const journal = joueur(PGRST202);
    const etat = await schema.sonderTout();
    expect(etat.durcissementBase).toBe("absente");
    expect(journal.join(" "), "sans ce journal, un hôte au repos ne saurait rien avant sa 1re présentation")
      .toMatch(/0018/);
  });

  it("une PANNE ne dit ni oui ni non : « indetermine »", async () => {
    joueur(() => { throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }); });
    const etat = await schema.sonderTout();
    expect(etat.durcissementBase,
      "compter une panne comme « absente » serait le défaut qu'on a mis trois versions à retirer ailleurs")
      .toBe("indetermine");
  });

  it("la sonde ne demande AUCUNE création : p_anon_cap vaut 0, la RPC rend avant son insert", async () => {
    let corps = null;
    schema.oublier();
    schema.init({
      plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
      errors: { capture() {} }, limits: { async allow() { return true; } },
      db: { async request(chemin, o) { if (chemin.startsWith("rpc/")) { corps = o.body; return []; } return []; } },
    });
    await schema.sonderTout();
    expect(corps.p_anon_cap, "avec un plafond nul, la branche « capped » rend AVANT l'insert").toBe(0);
    expect(corps.p_slug, "un slug de sonde qui ne peut pas être un slug réel (une espace)").toMatch(/\s/);
  });

  it("le champ dit sa PORTÉE, pour qu'on ne le confonde pas avec le rapport d'exécution", async () => {
    joueur(() => []);
    const etat = await schema.sonderTout();
    expect(etat.durcissementBaseCouvre).toMatch(/presenceDurcissement/);
  });
});

// ⚠️ 0019 : LA MÊME QUESTION, POSÉE À LA BASE. Sans ce champ, un hôte à qui la migration manque
// retombe en silence à trois allers-retours par battement — correct, deux fois plus cher sur le
// chemin le plus chaud, et rien ne le dirait. C'est la dégradation qu'on rend observable ici.
describe("« la fusion des battements est-elle en base ? » — posée à la base, pas au processus", () => {
  const PGRST202 = () => { throw Object.assign(new Error("Supabase"), { statusCode: 404, details: { code: "PGRST202" } }); };

  /** Le faux répond selon le contrat DEMANDÉ : c'est la seule façon de distinguer 0018 de 0019. */
  function joueurParContrat({ long, court }) {
    const journal = [];
    const corpsVus = [];
    schema.oublier();
    schema.init({
      plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
      errors: { capture(e) { journal.push(String(e && e.message)); } },
      limits: { async allow() { return true; } },
      db: {
        async request(chemin, o) {
          if (!chemin.startsWith("rpc/player_attendance_bump")) return [];
          corpsVus.push(o.body);
          return ("p_control_hash" in o.body ? long : court)();
        },
      },
    });
    return { journal, corpsVus };
  }

  it("0019 en base → « applique », et 0018 est prouvée du même coup — un seul appel", async () => {
    const { corpsVus } = joueurParContrat({ long: () => [{ ok: false, introuvable: true }], court: PGRST202 });
    const etat = await schema.sonderTout();
    expect(etat.fusionBase).toBe("applique");
    // ⚠️ 0019 reprend les arguments de 0018 : le contrat long ne peut pas exister sans elle. Le faux
    // refuserait le contrat court — si le verdict était « absente », c'est qu'on l'a redemandé.
    expect(etat.durcissementBase, "0019 succède à 0018 : la prouver, c'est les prouver toutes deux").toBe("applique");
    expect(corpsVus.length, "une question dont la réponse vient d'être prouvée ne se repose pas").toBe(1);
  });

  it("0019 absente mais 0018 là → « absente » / « applique », et l'exploitant est AVERTI du surcoût", async () => {
    const { journal, corpsVus } = joueurParContrat({ long: PGRST202, court: () => [{ ok: false, capped: true }] });
    const etat = await schema.sonderTout();
    expect(etat.fusionBase).toBe("absente");
    expect(etat.durcissementBase, "l'hôte en retard est justement celui à qui on doit une réponse précise").toBe("applique");
    expect(corpsVus.length, "le contrat court est reposé, et seulement dans ce cas").toBe(2);
    // ⚠️ LE MESSAGE DIT LA DÉGRADATION EXACTE, pas « ça ne marche pas » : personne ne décide d'une
    // migration sur « ça ne marche pas », et ici justement rien ne casse.
    expect(journal.join(" ")).toMatch(/0019/);
    expect(journal.join(" "), "le coût réel, sans quoi la migration ne se décide pas").toMatch(/3 allers-retours/);
  });

  it("les deux absentes → chacune le dit pour elle-même", async () => {
    const { journal } = joueurParContrat({ long: PGRST202, court: PGRST202 });
    const etat = await schema.sonderTout();
    expect(etat.fusionBase).toBe("absente");
    expect(etat.durcissementBase).toBe("absente");
    expect(journal.join(" "), "0018 est un problème de SÉCURITÉ, 0019 de coût : deux messages").toMatch(/0018/);
    expect(journal.join(" ")).toMatch(/0019/);
  });

  it("une PANNE ne dit ni oui ni non — et n'insiste pas sur une base en difficulté", async () => {
    const { corpsVus } = joueurParContrat({
      long: () => { throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }); },
      court: () => [{ ok: true }],
    });
    const etat = await schema.sonderTout();
    expect(etat.fusionBase).toBe("indetermine");
    expect(etat.durcissementBase, "une panne ne prouve rien pour l'une ni pour l'autre").toBe("indetermine");
    expect(corpsVus.length, "frapper deux fois une base qui ne répond pas n'apprend rien").toBe(1);
  });

  it("la sonde du contrat long n'écrit rien — DEUX raisons indépendantes", async () => {
    const { corpsVus } = joueurParContrat({ long: () => [{ ok: false, introuvable: true }], court: PGRST202 });
    await schema.sonderTout();
    const corps = corpsVus[0];
    expect(corps.p_page, "p_page null sur un slug absent : la branche « introuvable » rend avant l'insert").toBe(null);
    expect(corps.p_anon_cap, "et le plafond nul sortait déjà par la branche « capped »").toBe(0);
    expect(corps.p_slug, "un slug qui ne peut pas être un slug réel (une espace)").toMatch(/\s/);
  });

  it("le champ dit sa portée, pour qu'on ne le lise pas comme le rapport d'exécution", async () => {
    joueurParContrat({ long: () => [], court: () => [] });
    const etat = await schema.sonderTout();
    expect(etat.fusionBaseCouvre).toMatch(/presenceFusion/);
    expect(etat.fusionBaseCouvre, "et la dégradation exacte, pour qu'on sache ce qu'on perd").toMatch(/3 allers-retours/);
  });
});

// ⚠️ BASE ENTIÈREMENT MUETTE : le champ doit être LÀ, pas seulement le verdict (P2 audit externe).
//
// Le contrat annonce que `durcissementBase` vaut toujours applique / absente / indetermine. Le
// retour anticipé — quand la requête témoin elle-même échoue — le faisait disparaître. Un hôte qui
// teste `durcissementBase !== "applique"` avant de déployer lisait alors `undefined !== "applique"`,
// vrai par accident. Un champ ABSENT est plus dangereux qu'un champ prudent : il ne se distingue pas
// d'un player plus ancien qui ne le rendrait pas du tout.
describe("base totalement muette", () => {
  const schema = require("../schema.js");

  it("rend quand même durcissementBase — et sa portée avec", async () => {
    schema.oublier();
    schema.init({
      plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
      errors: { capture() {} }, limits: { async allow() { return true; } },
      db: { async request() { throw new Error("base injoignable"); } },
    });
    const etat = await schema.sonderTout();
    expect(etat.verdict).toBe("indetermine");
    expect(Object.hasOwn(etat, "durcissementBase"),
      "le champ a DISPARU : indiscernable d'un player plus ancien qui ne le rend pas").toBe(true);
    expect(etat.durcissementBase, "on n'a rien pu demander : ni oui ni non").toBe("indetermine");
    expect(etat.durcissementBaseCouvre, "la portée voyage avec le champ, ici aussi").toMatch(/BASE/);
  });
});
