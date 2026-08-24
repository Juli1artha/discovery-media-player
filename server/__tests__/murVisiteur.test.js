// LE MUR D'ACCÈS — LA PROPRIÉTÉ QUE TOUT LE RESTE DU DÉPÔT CITE, ET QUE RIEN NE VÉRIFIAIT.
//
// ⚠️ `SECURITY.md` l'énonce comme note de conception, `docs/THREAT-MODEL.md` la place en T1, et
// `docs/ARCHITECTURE.md` la répète : « le cœur échoue FERMÉ. Un document exigeant une
// authentification dont le greffon de mur d'accès est ABSENT rend 404 — il ne dégrade jamais en
// document librement lisible. » Trois documents l'affirment. Aucun banc ne la mesurait :
// `server/routes-visiteur.js` n'était cité par aucun test du dépôt.
//
// C'est la forme de trou la plus coûteuse qui soit, parce qu'elle est invisible : la propriété est
// écrite, donc chacun la croit tenue, et une refactorisation qui la casse ne fait rougir personne.
// Le refus est UNE ligne (`if (!V) return jv(404, …)`) ; la supprimer ne casse aucun autre test, et
// le player se met alors à répondre 200 là où il refusait — sur la route qui garde les documents
// dont l'accès est conditionné.
//
// ⚠️ LE SECOND CAS EST UN INCIDENT DÉJÀ ARRIVÉ, décrit dans le fichier lui-même : `recordUnlock`
// écrit en base et rattrape son échec en silence, « un journal ne doit jamais empêcher une
// lecture ». La garde de forge vérifie qu'une écriture rattrapée est signalée ; elle ne vérifie pas
// que le déverrouillage ABOUTIT quand même. Inverser ces deux-là — refuser l'accès parce que le
// journal est tombé — transformerait une panne de journalisation en panne de produit.

// ⚠️ LE POSTICHE AVANT LE REQUIRE, ET L'ORDRE N'EST PAS UN DÉTAIL. `routes-visiteur.js`
// DÉSTRUCTURE `getShareBySlug` au chargement : requis en premier, il capture la vraie fonction et
// le postiche posé ensuite ne sert plus à rien. C'est l'ordre qu'emploie déjà
// `originePublique.test.js` — les stubs d'abord, le module éprouvé ensuite.
const ID_SHARES = require.resolve("../shares.js");
const vraisShares = require("../shares.js");
let partageRendu = { doc_title: "Proposition commerciale" };
require.cache[ID_SHARES] = {
  id: ID_SHARES, filename: ID_SHARES, loaded: true,
  exports: { ...vraisShares, getShareBySlug: async () => partageRendu },
};

const routes = require("../routes-visiteur.js");

/** Un `res` postiche : on ne veut que ce que la route a DIT, pas comment elle l'a écrit. */
function fauxRes() {
  const r = {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    end(s) { this.corps = s ? JSON.parse(s) : null; },
  };
  return r;
}

const req = { socket: { remoteAddress: "203.0.113.7" }, headers: {} };

function contexte({ visitors = null, allow = async () => true, dbRequest = async () => {} } = {}) {
  const captures = [];
  const ecrits = [];
  routes.init({
    plugins: { visitors },
    limits: { allow },
    db: { request: async (table, opts) => { ecrits.push({ table, corps: opts && opts.body }); return dbRequest(table, opts); } },
    errors: { capture: (e) => captures.push(String(e && e.message)) },
  });
  return { captures, ecrits };
}

/** Le greffon nominal : accepte le code « bon », refuse le reste. */
const greffonOk = {
  requestCode: async (email, opts) => ({ ok: true, sent: email, titre: opts && opts.title }),
  verifyCode: async (email, code, name) =>
    code === "bon"
      ? { ok: true, setCookie: "pv=jeton; HttpOnly", visitor: { email, name } }
      : { ok: false, error: "code" },
  verifyGoogle: async (credential) =>
    credential === "bon"
      ? { ok: true, setCookie: "pv=jeton; HttpOnly", visitor: { email: "g@exemple.fr", name: "G" } }
      : { ok: false, error: "google" },
};

const appeler = async (body, ctx) => {
  const res = fauxRes();
  const rendu = await routes.traiter(req, res, body, "");
  return { res, rendu, ...ctx };
};

describe("le greffon absent ferme la porte, il ne l'ouvre pas", () => {
  // ⚠️ LES TROIS ACTIONS, PAS UNE SEULE. Le refus est en tête du bloc et couvre les trois ; le
  // vérifier sur une seule laisserait passer une refactorisation qui déplace le test à l'intérieur
  // d'une des branches — chacune répondrait alors selon ses propres moyens, dont 200.
  for (const action of ["visitor-request", "visitor-verify", "visitor-google"]) {
    it(`« ${action} » rend 404 quand aucun mur n'est branché`, async () => {
      const ctx = contexte({ visitors: null });
      const { res, rendu } = await appeler({ action, email: "a@b.fr", code: "bon", slug: "S" }, ctx);
      expect(res.statusCode).toBe(404);
      expect(res.corps).toEqual({ ok: false, error: "disabled" });
      // Et surtout : pas de cookie. Un 404 qui poserait quand même le jeton serait pire qu'un 200.
      expect(res.entetes["set-cookie"]).toBeUndefined();
      expect(rendu).not.toBe(false); // la route a RÉPONDU : le dispatch ne doit pas continuer
    });
  }
});

describe("la demande de code", () => {
  it("est plafonnée par adresse — un envoi d'emails à volonté n'est pas un service", async () => {
    // 20 par heure et par IP : au-delà, 429. Sans ce plafond, la route est un relais d'envoi
    // gratuit vers n'importe quelle adresse, signé par la réputation d'expéditeur de l'hôte.
    const ctx = contexte({ visitors: greffonOk, allow: async () => false });
    const { res } = await appeler({ action: "visitor-request", email: "a@b.fr", slug: "S" }, ctx);
    expect(res.statusCode).toBe(429);
    expect(res.corps).toEqual({ ok: false, error: "rate" });
  });

  it("passe le titre du document au greffon, pour que l'email dise de quoi il parle", async () => {
    partageRendu = { doc_title: "Proposition commerciale" };
    const ctx = contexte({ visitors: greffonOk });
    const { res } = await appeler({ action: "visitor-request", email: "a@b.fr", slug: "S" }, ctx);
    expect(res.statusCode).toBe(200);
    expect(res.corps.titre).toBe("Proposition commerciale");
  });

  it("reste utilisable quand le lien est introuvable — l'email part sans titre", async () => {
    // `getShareBySlug` rendant `null`, le `sh && sh.doc_title` retombe sur `undefined`. Le code
    // doit partir quand même : refuser ici apprendrait à l'attaquant quels slugs existent.
    partageRendu = null;
    const ctx = contexte({ visitors: greffonOk });
    const { res } = await appeler({ action: "visitor-request", email: "a@b.fr", slug: "inconnu" }, ctx);
    expect(res.statusCode).toBe(200);
    partageRendu = { doc_title: "Proposition commerciale" };
  });
});

describe("la vérification pose le jeton, ou ne pose rien", () => {
  it("un bon code rend 200 et pose le cookie", async () => {
    const ctx = contexte({ visitors: greffonOk });
    const { res } = await appeler({ action: "visitor-verify", email: "a@b.fr", code: "bon", slug: "S" }, ctx);
    expect(res.statusCode).toBe(200);
    expect(res.corps).toEqual({ ok: true });
    expect(res.entetes["set-cookie"]).toBe("pv=jeton; HttpOnly");
  });

  it("un mauvais code rend 400 SANS cookie", async () => {
    // Le cas qui compte : un refus qui poserait quand même le jeton déverrouillerait le document
    // pour quelqu'un qui a échoué à prouver son adresse.
    const ctx = contexte({ visitors: greffonOk });
    const { res } = await appeler({ action: "visitor-verify", email: "a@b.fr", code: "faux", slug: "S" }, ctx);
    expect(res.statusCode).toBe(400);
    expect(res.entetes["set-cookie"]).toBeUndefined();
  });

  it("Google suit exactement la même règle", async () => {
    const ctx = contexte({ visitors: greffonOk });
    const bon = await appeler({ action: "visitor-google", credential: "bon", slug: "S" }, ctx);
    expect(bon.res.statusCode).toBe(200);
    expect(bon.res.entetes["set-cookie"]).toBe("pv=jeton; HttpOnly");

    const mauvais = await appeler({ action: "visitor-google", credential: "faux", slug: "S" }, contexte({ visitors: greffonOk }));
    expect(mauvais.res.statusCode).toBe(400);
    expect(mauvais.res.entetes["set-cookie"]).toBeUndefined();
  });
});

describe("le journal de déverrouillage", () => {
  it("enregistre qui a ouvert quoi, et par quel moyen", async () => {
    const ctx = contexte({ visitors: greffonOk });
    const { ecrits } = await appeler({ action: "visitor-verify", email: "a@b.fr", code: "bon", name: "A", slug: "S" }, ctx);
    expect(ecrits).toHaveLength(1);
    expect(ecrits[0].table).toBe("xp_visitor_unlocks");
    expect(ecrits[0].corps[0]).toMatchObject({ doc_slug: "S", email: "a@b.fr", name: "A", method: "email" });
  });

  it("distingue le moyen : Google est journalisé comme tel", async () => {
    const ctx = contexte({ visitors: greffonOk });
    const { ecrits } = await appeler({ action: "visitor-google", credential: "bon", slug: "S" }, ctx);
    expect(ecrits[0].corps[0]).toMatchObject({ method: "google", email: "g@exemple.fr" });
  });

  // ⚠️ L'INVERSION QUI COÛTERAIT UN PRODUIT. Le fichier le dit : « un journal ne doit jamais
  // empêcher une lecture ». Si l'écriture en base tombe — base saturée, migration en cours — le
  // visiteur qui vient de prouver son adresse doit quand même entrer. Une panne de journalisation
  // deviendrait sinon une panne de produit, pour tous les visiteurs à la fois.
  it("une écriture qui échoue n'empêche PAS le déverrouillage — elle est seulement signalée", async () => {
    const ctx = contexte({
      visitors: greffonOk,
      dbRequest: async () => { throw new Error("base indisponible"); },
    });
    const { res, captures } = await appeler({ action: "visitor-verify", email: "a@b.fr", code: "bon", slug: "S" }, ctx);
    expect(res.statusCode).toBe(200);
    expect(res.entetes["set-cookie"]).toBe("pv=jeton; HttpOnly");
    expect(captures.join(" ")).toMatch(/non journalisé/);
  });

  it("n'écrit rien quand il n'y a pas de lien à rattacher", async () => {
    // Sans slug, la ligne n'aurait aucun sens : `doc_slug` vide n'identifie pas un document.
    const ctx = contexte({ visitors: greffonOk });
    const { res, ecrits } = await appeler({ action: "visitor-verify", email: "a@b.fr", code: "bon" }, ctx);
    expect(res.statusCode).toBe(200);
    expect(ecrits).toHaveLength(0);
  });
});

describe("le marqueur du dispatch", () => {
  it("une action étrangère rend `false` pour que le dispatch continue", async () => {
    // Le fichier ne duplique aucune liste d'actions : c'est la chute au bout qui rend la main.
    // Rendre autre chose que `false` ici avalerait toutes les autres routes du player.
    const ctx = contexte({ visitors: greffonOk });
    const { res, rendu } = await appeler({ action: "track" }, ctx);
    expect(rendu).toBe(false);
    expect(res.statusCode).toBe(0); // rien n'a été répondu
  });
});
