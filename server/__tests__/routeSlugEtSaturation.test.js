// LA ROUTE APPLIQUE LE CONTRAT DU SLUG, ET TRADUIT LA SATURATION EN 503 — PAS EN 500.
//
// ⚠️ Deux volets d'un même P1 d'audit externe. Le slug vient de l'URL ; non validé, il entrait tel
// quel dans une CLÉ DE CACHE et dans une requête base. C'est ce qui rendait l'admission du cache
// actionnable depuis l'extérieur : faire varier la clé suffisait à faire naître une entrée et une
// requête de plus. Valider APRÈS le cache n'aurait rien réglé — la clé était déjà créée.
//
// Et une saturation n'est pas une panne : « nous refusons d'admettre une demande de plus » se
// réessaie dans une seconde, « la base a échoué » ne se réessaie pas. Rendre 500 ferait renoncer un
// appelant que le battement suivant aurait servi.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");

let lectures = 0;
let bloquer = false;
require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
  ...vraies,
  getPresentation: async (slug) => {
    lectures++;
    if (bloquer) return new Promise(() => {});          // base lente : la demande reste en vol
    return { slug: String(slug), active: true, current_page: 1, chat_locked: false, presenter_name: "" };
  },
  listMessages: async () => [],
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

function lire(slug, query) {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  return player.handler({ method: "GET", headers: {}, socket: { remoteAddress: "198.51.100.7" }, query: { present: slug, state: "1", ...query } }, res)
    .then(() => ({ statut: res.statusCode, entetes: res.headers, corps: res.body }));
}

beforeEach(() => { lectures = 0; bloquer = false; });

// Des formes qu'un lecteur peut poster et que le contrat refuse. Chacune était, avant, une clé de
// cache valide et une requête base de plus.
const INVALIDES = [
  ["chemin", "../../etc/passwd"],
  ["espace", "slug avec espace"],
  ["trop long", "a".repeat(65)],
  ["vide", ""],
  ["unicode", "présentation"],
  ["point", "slug.json"],
];

describe("le contrat du slug s'applique AVANT le cache et AVANT la base", () => {
  it.each(INVALIDES)("« %s » : aucune interrogation de base", async (_nom, slug) => {
    const r = await lire(slug);
    expect(lectures, "un slug hors contrat ne doit produire AUCUNE requête base").toBe(0);
    expect(r.statut, "et il ne renvoie pas 200").not.toBe(200);
  });

  it("un slug VALIDE passe bien — sinon ce contrôle casserait le produit", async () => {
    const r = await lire("Ab3-_xYz9012");
    expect(r.statut).toBe(200);
    expect(lectures).toBe(1);
  });

  it("la borne est à 64 : 64 caractères passent, 65 non", async () => {
    await lire("b".repeat(64));
    expect(lectures, "64 est dans le contrat").toBe(1);
    lectures = 0;
    await lire("b".repeat(65));
    expect(lectures, "65 est hors contrat").toBe(0);
  });
});

describe("saturation du cache : 503 réessayable, pas 500", () => {
  it("au-delà du plafond d'admission, la route rend 503 avec Retry-After", async () => {
    bloquer = true;
    // On sature avec des clés distinctes valides ; la base ne répond jamais.
    const enVol = [];
    for (let i = 0; i < 200; i++) enVol.push(lire("sat" + String(i).padStart(6, "0")).catch(() => null));
    await new Promise((r) => setImmediate(r));
    const resultats = await Promise.all(enVol.map((p) => Promise.race([p, Promise.resolve(null)])));
    const satures = resultats.filter((r) => r && r.statut === 503);
    expect(satures.length, "le plafond doit avoir refusé quelque chose").toBeGreaterThan(0);
    expect(satures[0].entetes["retry-after"], "un 503 sans Retry-After ne dit pas quand revenir").toBe("1");
    expect(JSON.parse(satures[0].corps).error).toBe("busy");
    expect(lectures, "et les refusées n'ont pas touché la base").toBeLessThanOrEqual(128);
  });
});
