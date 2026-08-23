// LES GARDES DE L'ASSISTANT — LE PLUS GROS BLOC DE DÉCISIONS NON ÉPROUVÉES DU DÉPÔT.
//
// ⚠️ `server/routes-agent.js` portait 171 branches et 5,8 % de couverture : quatorze refus écrits
// à la main, dont trois de contrôle d'accès, qu'aucun banc ne touchait. Ce fichier n'éprouve PAS
// la plomberie (ElevenLabs, génération de script, appels au modèle) : il éprouve ce que la route
// REFUSE, parce que c'est là que vivent les propriétés et que le reste est du relais.
//
// ⚠️ DEUX D'ENTRE ELLES MÉRITENT D'ÊTRE NOMMÉES ICI, parce qu'elles ne se devinent pas en lisant
// le nom des actions :
//
//   1. UNE SESSION EST LIÉE À SON DOCUMENT. `sess.share_slug !== share.slug` refuse une session
//      obtenue sur le document A quand elle sert à agir sur le document B. Sans ce test, un
//      identifiant de session — qui voyage côté client — permettrait de noter, et de faire parler,
//      l'assistant d'un document qu'on n'a jamais reçu.
//
//   2. « constructor » N'EST PAS UNE LANGUE, et le dépôt le sait pour l'avoir vécu. Le commentaire
//      de la ligne le raconte : un objet littéral répond à `constructor`, donc sans `Object.hasOwn`
//      la chaîne passait la garde et finissait interpolée dans le prompt du modèle sous la forme
//      « function Object() { [native code] } ». C'est le geste du dépôt appliqué tel quel : un
//      commentaire qui raconte un incident est déjà l'intitulé d'un test.

const ID_SHARES = require.resolve("../shares.js");
const vraisShares = require("../shares.js");
let partageRendu = null;
require.cache[ID_SHARES] = {
  id: ID_SHARES, filename: ID_SHARES, loaded: true,
  exports: { ...vraisShares, getShareBySlug: async () => partageRendu },
};

const routes = require("../routes-agent.js");

function fauxRes() {
  return {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    end(s) { this.corps = s ? JSON.parse(s) : null; },
  };
}

const req = { socket: { remoteAddress: "203.0.113.9" }, headers: {} };
const PARTAGE = { slug: "Doc-A", doc_id: "d1", bot_enabled: true, bot_profile_id: "p1" };

/** Le greffon nominal. Chaque appel est enregistré pour qu'un test puisse dire ce qui est PASSÉ. */
function greffon(surcharges = {}) {
  const vus = [];
  return {
    vus,
    I18N_LANGS: { en: "English", es: "Español" },
    getSession: async (id) => (id === "sess-A" ? { share_slug: "Doc-A" } : id === "sess-B" ? { share_slug: "Doc-B" } : null),
    listMessages: async () => [{ role: "bot", text: "bonjour" }],
    botStart: async (share, pages, mobile, intent, blang) => { vus.push({ appel: "botStart", blang, pages, mobile }); return { sessionId: "s1" }; },
    botSay: async (id, share, text) => { vus.push({ appel: "botSay", text }); return { reply: "ok" }; },
    botNudge: async () => ({ reply: "n" }),
    bookSlot: async () => ({ booked: true }),
    contactLead: async () => ({ saved: true }),
    getProfile: async () => ({}),
    scriptedPayload: async () => ({ steps: [], voice: "", hook: "", closing: "" }),
    applyPron: (p) => p,
    ...surcharges,
  };
}

function contexte({ bot = greffon(), allow = async () => true } = {}) {
  const ecrits = [];
  routes.init({
    plugins: { bot },
    limits: { allow },
    db: { request: async (cible, opts) => { ecrits.push({ cible, corps: opts && opts.body }); } },
    errors: { capture: async () => {} },
  });
  return { bot, ecrits };
}

const appeler = async (body, ctx) => {
  const res = fauxRes();
  const rendu = await routes.traiter(req, res, body, "");
  return { res, rendu, ...ctx };
};

beforeEach(() => { partageRendu = { ...PARTAGE }; });

describe("le greffon absent ferme la porte", () => {
  for (const action of ["bot-tts", "bot-start", "bot-say", "bot-rate"]) {
    it(`« ${action} » rend 404 quand aucun assistant n'est branché`, async () => {
      const ctx = contexte({ bot: null });
      const { res, rendu } = await appeler({ action, slug: "Doc-A" }, ctx);
      expect(res.statusCode).toBe(404);
      expect(res.corps).toEqual({ ok: false, error: "disabled" });
      expect(rendu).not.toBe(false);
    });
  }
});

describe("l'assistant n'existe que si le document l'a activé", () => {
  it("refuse un document dont l'assistant n'est pas activé", async () => {
    // Le greffon peut être branché sur l'instance sans que CE document ait choisi de l'exposer.
    // C'est une décision par document, pas par instance.
    partageRendu = { ...PARTAGE, bot_enabled: false };
    const { res } = await appeler({ action: "bot-start", slug: "Doc-A" }, contexte());
    expect(res.statusCode).toBe(404);
    expect(res.corps).toEqual({ ok: false, error: "bot" });
  });

  it("refuse un lien introuvable sans dire qu'il est introuvable", async () => {
    // Même code, même corps que ci-dessus : distinguer « pas d'assistant » de « pas de document »
    // apprendrait à un visiteur quels slugs existent.
    partageRendu = null;
    const { res } = await appeler({ action: "bot-start", slug: "inconnu" }, contexte());
    expect(res.statusCode).toBe(404);
    expect(res.corps).toEqual({ ok: false, error: "bot" });
  });
});

describe("une session est liée à SON document", () => {
  // ⚠️ LE CONTRÔLE D'ACCÈS LE MOINS VISIBLE DU FICHIER. L'identifiant de session voyage côté
  // client : sans cette vérification, en réutiliser un obtenu ailleurs suffirait pour agir sur un
  // document qu'on n'a jamais reçu.
  it("refuse de noter avec une session ouverte sur un autre document", async () => {
    const { res } = await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "sess-B", rating: 5 }, contexte());
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "session" });
  });

  it("refuse de rejouer le script avec une session ouverte sur un autre document", async () => {
    const { res } = await appeler({ action: "bot-script", slug: "Doc-A", sessionId: "sess-B" }, contexte());
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "session" });
  });

  it("refuse une session inconnue", async () => {
    const { res } = await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "jamais-vue", rating: 5 }, contexte());
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "session" });
  });

  it("témoin : la bonne session note bien le document", async () => {
    // Sans ce témoin, les trois refus ci-dessus seraient satisfaits par une garde qui refuse TOUT.
    const ctx = contexte();
    const { res, ecrits } = await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "sess-A", rating: 4 }, ctx);
    expect(res.statusCode).toBe(200);
    expect(ecrits[0].corps).toMatchObject({ rating: 4 });
  });
});

describe("« constructor » n'est pas une langue", () => {
  // ⚠️ L'INCIDENT RACONTÉ PAR LE COMMENTAIRE DE LA LIGNE, retourné en test. Un objet littéral
  // répond à `constructor` : sans `Object.hasOwn`, la chaîne passait pour une langue connue et
  // finissait interpolée dans le prompt du modèle.
  it("une langue héritée du prototype est traitée comme inconnue", async () => {
    const ctx = contexte();
    await appeler({ action: "bot-start", slug: "Doc-A", lang: "constructor" }, ctx);
    expect(ctx.bot.vus[0].blang).toBeNull();
  });

  it("« toString » non plus", async () => {
    const ctx = contexte();
    await appeler({ action: "bot-start", slug: "Doc-A", lang: "toString" }, ctx);
    expect(ctx.bot.vus[0].blang).toBeNull();
  });

  it("témoin : une langue réellement déclarée passe", async () => {
    const ctx = contexte();
    await appeler({ action: "bot-start", slug: "Doc-A", lang: "ES" }, ctx);
    expect(ctx.bot.vus[0].blang).toBe("es"); // normalisée en minuscules au passage
  });
});

describe("les bornes des valeurs venues du client", () => {
  it("plafonne le nombre de pages annoncé", async () => {
    // `pages` arrive du navigateur et sert à dimensionner le contexte envoyé au modèle. Non borné,
    // il ferait payer un prompt arbitrairement long à l'hôte.
    const ctx = contexte();
    await appeler({ action: "bot-start", slug: "Doc-A", pages: 99999 }, ctx);
    expect(ctx.bot.vus[0].pages).toBe(500);
  });

  it("ramène une note au-dessus du barème à 5", async () => {
    const ctx = contexte();
    await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "sess-A", rating: 42 }, ctx);
    expect(ctx.ecrits[0].corps).toMatchObject({ rating: 5 });
  });

  it("arrondit une note fractionnaire — la colonne est un smallint", async () => {
    // `3.7` traversait la garde intact et partait tel quel vers PostgREST : l'arrondi se décidait
    // en aval, hors de vue, et pouvait varier avec la version du serveur.
    const ctx = contexte();
    await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "sess-A", rating: 3.7 }, ctx);
    expect(ctx.ecrits[0].corps).toMatchObject({ rating: 4 });
  });

  // ⚠️ LE REFUS QUI N'ÉTAIT PAS ATTEIGNABLE, et le seul test de ce fichier écrit AVANT son
  // correctif. `const note = Math.max(1, …)` posait un plancher à 1 : `note` valait toujours au
  // moins 1, `!note` n'était jamais vrai, et la ligne de refus juste en dessous ne s'exécutait
  // jamais. Une notation sans note enregistrait **1 étoile** — la pire du barème — au lieu d'être
  // refusée, et la satisfaction mesurée baissait d'elle-même à chaque appel malformé.
  //
  // Une note absente n'est pas une mauvaise note : c'est une absence. Les quatre formes qu'elle
  // prend sont éprouvées ensemble, parce que c'est la MÊME absence vue de quatre clients
  // différents — champ oublié, champ vidé, champ mal typé, double envoi.
  for (const [nom, rating] of [["absente", undefined], ["nulle", null], ["non numérique", "abc"], ["à zéro", 0], ["négative", -3]]) {
    it(`refuse une note ${nom} au lieu de l'enregistrer comme 1 étoile`, async () => {
      const ctx = contexte();
      const { res } = await appeler({ action: "bot-rate", slug: "Doc-A", sessionId: "sess-A", rating }, ctx);
      expect(res.statusCode).toBe(400);
      expect(res.corps).toEqual({ ok: false, error: "rating" });
      expect(ctx.ecrits, "une note refusée ne doit RIEN écrire en base").toHaveLength(0);
    });
  }

  it("refuse un message vide", async () => {
    const { res } = await appeler({ action: "bot-say", slug: "Doc-A", sessionId: "sess-A", text: "   " }, contexte());
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "empty" });
  });

  it("tronque un message trop long au lieu de le relayer entier", async () => {
    const ctx = contexte();
    await appeler({ action: "bot-say", slug: "Doc-A", sessionId: "sess-A", text: "a".repeat(5000) }, ctx);
    expect(ctx.bot.vus.find((v) => v.appel === "botSay").text).toHaveLength(1000);
  });
});

describe("une panne interne ne fuit pas", () => {
  it("rend 500 sans détail quand le greffon lève", async () => {
    // Le message d'une exception peut contenir une URL interne, un identifiant, une clé. Le bloc
    // est enveloppé pour que le visiteur reçoive un refus, pas un diagnostic.
    const ctx = contexte({ bot: greffon({ botStart: async () => { throw new Error("clé ELEVENLABS_… invalide"); } }) });
    const { res } = await appeler({ action: "bot-start", slug: "Doc-A" }, ctx);
    expect(res.statusCode).toBe(500);
    expect(res.corps).toEqual({ ok: false });
    expect(JSON.stringify(res.corps)).not.toMatch(/ELEVENLABS/);
  });
});

describe("le plafond et le marqueur du dispatch", () => {
  it("plafonne les échanges par adresse", async () => {
    const { res } = await appeler({ action: "bot-say", slug: "Doc-A", text: "salut" }, contexte({ allow: async () => false }));
    expect(res.statusCode).toBe(429);
    expect(res.corps).toEqual({ ok: false, error: "rate" });
  });

  it("une action étrangère rend `false` pour que le dispatch continue", async () => {
    const { res, rendu } = await appeler({ action: "track" }, contexte());
    expect(rendu).toBe(false);
    expect(res.statusCode).toBe(0);
  });
});
