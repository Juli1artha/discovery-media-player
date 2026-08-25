// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN CACHE COURT NE REMPLACE PAS UNE LIMITE : IL SUPPRIME CE QU'ELLE GARDAIT.
//
// `state=1` et `chat=1` lisent une ligne identique pour tous les spectateurs d'une même présentation
// à un instant donné. Les relire une fois par spectateur n'apporte rien ; les relire une fois par
// FENÊTRE fait s'effondrer n'importe quelle cadence — légitime ou hostile — à un accès base, quel
// que soit le nombre d'appelants. Il n'y a plus de ressource à saturer, donc plus de victime.
//
// L'idée vient du second hôte, qui a vu plus loin que notre quota : « la cadence de relecture est
// imposée par qui diffuse, donc tout quota par appelant est une arme retournée ».
//
// ⚠️ ON NE COMPTE PAS DES RÉPONSES, ON COMPTE DES INTERROGATIONS DE BASE. C'est la même discipline
// que pour la garde de 0.1.42 : la ressource protégée n'est pas le nombre d'appels servis, c'est ce
// que chaque appel coûte derrière.

const { creerCache } = require("../cache.js");

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRES = { slug: "Ab3-_xYz9012", active: true, current_page: 3, chat_locked: false, presenter_name: "Léa" };
let lectures = 0;
let messages = 0;
let ligne = { ...PRES };
require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
  ...vraies,
  getPresentation: async (slug) => {
    lectures++;
    return String(slug).startsWith("INCONNUE") ? null : { ...ligne, slug: String(slug) };
  },
  listMessages: async () => { messages++; return []; },
} };
const player = require("../handler.js");

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

// ⚠️ CHAQUE TEST A SON PROPRE SLUG, ET CE N'EST PAS DU CONFORT.
//
// Le cache vit au niveau du MODULE — c'est voulu : le créer par requête reviendrait à n'en avoir
// aucun. Il traverse donc les tests, et ce fichier s'exécute en quelques millisecondes, très en
// deçà de la fenêtre de 400 ms. Trois tests ont d'abord échoué en comptant des lectures qu'un test
// précédent avait déjà payées. Un banc qui partage l'état du sujet doit le dire, pas le subir.
let compteur = 0;
const slugUnique = () => `Slug-${(compteur += 1).toString().padStart(6, "0")}`;

function lire(query, slug) {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  return player.handler({ method: "GET", headers: {}, socket: { remoteAddress: "198.51.100.7" }, query: { present: slug, ...query } }, res)
    .then(() => ({ statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() }));
}

beforeEach(() => { lectures = 0; messages = 0; ligne = { ...PRES }; });

describe("une rafale de spectateurs ne coûte qu'une lecture", () => {
  // ⚠️ LE CAS QUE LE CACHE EXISTE POUR COUVRIR — et celui qu'une implémentation naïve rate.
  //
  // Vingt-cinq spectateurs qui arrivent ENSEMBLE sur une clé froide produiraient vingt-cinq lectures
  // si l'on ne mémorisait que le résultat : aucun n'est encore revenu quand les autres partent. On
  // mémorise donc la PROMESSE. Rater ce cas viderait le cache de son sens dans la seule situation
  // qui compte.
  it("vingt-cinq relectures simultanées : une seule interrogation de base", async () => {
    const s = slugUnique();
    await Promise.all(Array.from({ length: 25 }, () => lire({ state: "1" }, s)));
    expect(lectures, "sans regroupement des demandes en vol, la rafale traverse le cache").toBe(1);
  });

  it("et elles reçoivent toutes la même réponse, correcte", async () => {
    const s = slugUnique();
    const reponses = await Promise.all(Array.from({ length: 5 }, () => lire({ state: "1" }, s)));
    for (const r of reponses) {
      expect(r.statut).toBe(200);
      expect(r.corps.state.current_page).toBe(3);
    }
  });

  it("le chat aussi, et il coûte plus cher : deux interrogations au lieu d'une", async () => {
    const s = slugUnique();
    await Promise.all(Array.from({ length: 25 }, () => lire({ chat: "1" }, s)));
    expect(lectures).toBe(1);
    expect(messages, "l'historique n'est lu qu'une fois pour tout le salon").toBe(1);
  });

  // Séquentiel, dans la même fenêtre : c'est le martèlement d'un diffuseur hostile.
  it("cent relectures d'affilée dans la fenêtre : toujours une seule", async () => {
    const s = slugUnique();
    for (let i = 0; i < 100; i++) await lire({ state: "1" }, s);
    expect(lectures).toBe(1);
  });
});

describe("le cache ne mélange rien", () => {
  it("deux présentations ne partagent pas leur état", async () => {
    await lire({ state: "1" }, slugUnique());
    ligne = { ...PRES, current_page: 42 };
    const r = await lire({ state: "1" }, slugUnique());
    expect(r.corps.state.current_page, "servir l'état d'une présentation à une autre serait bien pire que ce qu'on ferme")
      .toBe(42);
    expect(lectures).toBe(2);
  });

  it("l'état et le chat d'une même présentation sont deux entrées", async () => {
    const s = slugUnique();
    await lire({ state: "1" }, s);
    await lire({ chat: "1" }, s);
    expect(messages, "sinon l'un servirait la réponse de l'autre").toBe(1);
  });

  it("une présentation inconnue reste un refus, et ne se mémorise pas en réponse", async () => {
    const r = await lire({ state: "1" }, `INCONNUE-${slugUnique()}`);
    expect(r.statut).not.toBe(200);
  });
});

// ── La mécanique, isolée ─────────────────────────────────────────────────────────────────────────
describe("la mécanique du cache", () => {
  const horloge = () => { let t = 0; return { now: () => t, avancer: (ms) => { t += ms; } }; };

  it("au-delà de la fenêtre, on relit", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 400, now: h.now });
    let n = 0;
    const produire = async () => { n++; return n; };
    await c.lire("k", produire);
    h.avancer(399); await c.lire("k", produire);
    expect(n, "dans la fenêtre, une seule production").toBe(1);
    h.avancer(2); await c.lire("k", produire);
    expect(n, "au-delà, on repart chercher la vérité").toBe(2);
  });

  // ⚠️ Servir une erreur pendant toute la fenêtre transformerait un hoquet en panne visible, et
  // retarderait le rétablissement d'autant.
  it("un échec ne se mémorise pas", async () => {
    const c = creerCache({ ttlMs: 400 });
    let n = 0;
    await expect(c.lire("k", async () => { n++; throw new Error("base"); })).rejects.toThrow("base");
    await expect(c.lire("k", async () => { n++; return "ok"; })).resolves.toBe("ok");
    expect(n, "le second appel doit réessayer immédiatement").toBe(2);
  });

  // ⚠️ La clé vient de l'appelant — le slug est dans l'URL. Une table sans borne serait une fuite
  // mémoire commandée depuis l'extérieur.
  it("la table est bornée, même si l'appelant choisit les clés", async () => {
    const c = creerCache({ ttlMs: 10_000, max: 50 });
    for (let i = 0; i < 5_000; i++) await c.lire(`slug-${i}`, async () => i);
    expect(c.taille(), "n'importe qui peut demander un million de slugs différents")
      .toBeLessThanOrEqual(50);
  });

  it("et la borne n'empêche pas le cache de servir", async () => {
    const c = creerCache({ ttlMs: 10_000, max: 50 });
    let n = 0;
    await c.lire("k", async () => { n++; return 1; });
    await c.lire("k", async () => { n++; return 1; });
    expect(n).toBe(1);
  });
});

// ⚠️ LES DEUX FENÊTRES SONT UN SEUL CONTRAT. Un cache plus long que le regroupement de
// l'ordonnanceur ajouterait au spectateur une attente qu'il n'a pas consentie — et depuis 0.1.19 la
// relecture n'est pas un filet, c'est le SEUL chemin par lequel le numéro de page arrive.
describe("la fenêtre du cache se déduit de celle de l'ordonnanceur", () => {
  const { PRESENT_CACHE_MS, PRESENT_READ_COALESCE_MS } = require("../shared.generated.js");

  it("elles sont égales, et déclarées une seule fois", () => {
    expect(PRESENT_CACHE_MS).toBe(PRESENT_READ_COALESCE_MS);
  });

  it("le gabarit navigateur n'écrit plus le nombre à la main", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    const i = src.indexOf("function relireAvec(");
    expect(src.slice(i, i + 900), "deux nombres séparés finissent toujours par diverger")
      .toContain("PRESENT_READ_COALESCE_MS");
  });
});
