// L'ANALYTIQUE D'UN DOCUMENT EST BORNÉE, ET ELLE LE DIT.
//
// ⚠️ DEUX LECTURES DES MÊMES TABLES, DEUX RÈGLES — ET LA SECONDE N'ÉTAIT ÉCRITE NULLE PART.
// `overview()` bornait sa lecture à 24 mois glissants, avec la raison écrite au-dessus.
// `listSharesForDoc`, quarante lignes plus haut dans le même fichier, lisait TOUT l'historique d'un
// document. Rien ne signalait l'asymétrie : l'absence de borne ne s'écrit pas.
//
// ⚠️ ET LA BORNE EST TEMPORELLE, PAS EN NOMBRE DE LIGNES. PostgREST plafonne à 1 000 lignes sur ce
// déploiement — constaté par un incident dont le commentaire d'`overview()` garde la trace : tri
// ascendant + coupe silencieuse = c'est le RÉCENT qui disparaît, et le tableau de bord affichait
// « 0 ouverture » sur des documents lus la veille. Un `limit` de moins de 1 000 mordrait déjà sur
// notre pire document (662 lignes) ; un `limit` supérieur serait ramené à 1 000 sans le dire, donc
// un drapeau « tronqué » calculé sur la longueur serait FAUX. `selectAll` pagine par `Range` et met
// à l'abri du plafond ; la fenêtre borne le volume.

const shares = require("../shares.js");
const fc = require("fast-check");

/** Un faux qui RETIENT les chemins demandés — la borne se vérifie sur ce qui est demandé. */
function base(vues, liens = [{ slug: "s1", created_at: "2026-01-01T00:00:00Z" }]) {
  const chemins = [];
  const rendre = (c) => {
    chemins.push(c);
    if (c.startsWith("commercial_doc_shares")) return liens;
    if (c.startsWith("commercial_doc_views")) return vues;
    return [];
  };
  return { chemins, db: { async request(c) { return rendre(c); }, async selectAll(c) { return rendre(c); } } };
}

const vue = (at, extra = {}) => ({ slug: "s1", event: "open", page: 1, max_page: 1, seconds: 0, session_id: "x", at, ...extra });

describe("la lecture d'analytique d'un document est bornée dans le temps", () => {
  it("la requête porte une borne — l'historique entier n'est plus rapatrié", async () => {
    const b = base([vue("2026-08-01T10:00:00Z")]);
    shares.init({ db: b.db });
    await shares.listSharesForDoc("d1");
    const vues = b.chemins.find((c) => c.startsWith("commercial_doc_views"));
    expect(vues, "aucune lecture des vues : ce test ne mesure rien").toBeTruthy();
    expect(vues, "la lecture n'est pas bornée dans le temps").toMatch(/at=gte\./);
  });

  it("et la réponse DIT ce qu'elle couvre", async () => {
    shares.init({ db: base([vue("2026-08-01T10:00:00Z")]).db });
    const r = await shares.listSharesForDoc("d1");
    // ⚠️ Une analytique bornée qui ne l'annonce pas est indiscernable d'une analytique complète.
    expect(r.fenetreMois, "le lecteur ne peut pas déduire la couverture d'une absence").toBeGreaterThan(0);
  });
});

// ⚠️ LA PROPRIÉTÉ QUI AURAIT ATTRAPÉ LE COUPLAGE CACHÉ. `s.lastAt = v.at` — « la dernière ligne
// gagne » — n'était juste que TANT QUE la requête triait par `at.asc`. L'agrégation dépendait donc
// d'un `ORDER BY` situé trente lignes plus haut, et quiconque aurait inversé le tri (pour garder le
// récent en cas de coupe, par exemple) aurait transformé « dernière activité » en « première
// activité » sans qu'un seul test ne bouge.
//
// Un exemple choisi n'aurait rien prouvé : il aurait fallu penser à le donner à l'envers. La
// propriété, elle, dit ce qu'on veut vraiment — le résultat ne dépend pas de l'ordre d'arrivée.
describe("l'agrégation ne dépend plus de l'ORDRE des lignes", () => {
  const INSTANTS = [
    "2026-08-01T10:00:00Z", "2026-08-05T09:00:00Z", "2026-08-11T23:59:00Z",
    "2026-08-12T00:00:00Z", "2026-08-20T08:30:00Z",
  ];

  it("quelle que soit la permutation, le résultat est identique", async () => {
    const attendu = await (async () => {
      shares.init({ db: base(INSTANTS.map((t) => vue(t))).db });
      return shares.listSharesForDoc("d1");
    })();

    await fc.assert(fc.asyncProperty(fc.shuffledSubarray(INSTANTS, { minLength: INSTANTS.length }), async (melange) => {
      shares.init({ db: base(melange.map((t) => vue(t))).db });
      const r = await shares.listSharesForDoc("d1");
      expect(r.shares[0].lastAt).toBe(attendu.shares[0].lastAt);
      expect(r.total).toEqual(attendu.total);
      expect(r.funnel).toEqual(attendu.funnel);
    }), { numRuns: 60 });
  });

  // ⚠️ CONTRÔLE POSITIF DE L'ESSAI : sans lui, une propriété qui compare deux résultats TOUS DEUX
  // faux resterait verte. On exige la bonne VALEUR, pas seulement la stabilité.
  it("et « dernière activité » est bien la plus RÉCENTE, pas la dernière arrivée", async () => {
    shares.init({ db: base([...INSTANTS].reverse().map((t) => vue(t))).db });
    const r = await shares.listSharesForDoc("d1");
    expect(r.shares[0].lastAt, "les lignes arrivaient du plus récent au plus ancien")
      .toBe("2026-08-20T08:30:00Z");
  });
});
