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
    const muette = base({ temoin: false }); schema.init(muette.ctx);
    await schema.sonderTout();
    expect(schema.etatDuSchema().sondees, "le diagnostic a mis les attentes en cache à ABSENT").toBe(0);

    // La base revient — sans redémarrer le processus.
    const vivante = base({});
    schema.init(vivante.ctx);            // `init` seul remettrait le contexte ; le cache DOIT être vide
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
