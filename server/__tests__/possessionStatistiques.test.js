// UNE SESSION SUFFISAIT POUR LIRE LES PARTICIPANTS D'UNE PRÉSENTATION QUI N'ÉTAIT PAS LA SIENNE.
//
// `present-stats` et `present-doc-list` exigeaient un jeton, et rien de plus. Tout membre connaissant
// un slug — ou un identifiant de document — lisait donc les NOMS, les ADRESSES, le temps de présence
// et les pages vues des participants d'une présentation étrangère.
//
// ⚠️ Ces participants sont souvent des prospects. Ce ne sont pas des compteurs d'usage : ce sont des
// données commerciales sur des clients, et elles n'appartiennent pas à qui devine un slug.
//
// ⚠️ QUI Y A DROIT AU-DELÀ DU PROPRIÉTAIRE EST UNE RÈGLE DE L'HÔTE, PAS DU PLAYER. Une petite équipe
// où chacun voit tout est un choix défendable ; une instance à plusieurs populations ne peut pas se
// le permettre. Le player accorde donc ce qui est manifeste — propriétaire, administrateur — et
// demande le reste à l'hôte, par le crochet qui décide déjà qui peut diffuser un document.
//
// Signalé par deux audits (C-8, puis V-6).

const presentations = require("../presentations.js");

const PROPRIO = "proprio@ex.fr";
const LIGNE = { slug: "Ab3-_xYz9012", owner_email: PROPRIO, doc_id: "d1", active: true, current_page: 3, created_at: "2026-08-17T08:00:00.000Z" };

/** Une base en mémoire, et un journal de ce qui a réellement été interrogé. */
function base(lignes = [LIGNE]) {
  const interroge = [];
  presentations.init({
    db: { async request(chemin) {
      interroge.push(String(chemin));
      if (String(chemin).startsWith("doc_presentations?doc_id=")) return lignes.map((l) => ({ ...l }));
      if (String(chemin).startsWith("doc_presentations?")) return [{ ...lignes[0] }];
      return [];
    } },
    limits: { async allow() { return true; } }, errors: { capture() {} },
  });
  return { interroge };
}

describe("les statistiques d'une présentation appartiennent à son propriétaire", () => {
  it("le propriétaire les lit", async () => {
    base();
    const r = await presentations.presentationStats(LIGNE.slug, PROPRIO, false, () => false);
    expect(r.ok).toBe(true);
  });

  it("un administrateur aussi", async () => {
    base();
    expect((await presentations.presentationStats(LIGNE.slug, "autre@ex.fr", true, () => false)).ok).toBe(true);
  });

  // ⚠️ LE DÉFAUT : un jeton valide et un slug suffisaient.
  it("un membre étranger, non : c'était la fuite", async () => {
    base();
    const r = await presentations.presentationStats(LIGNE.slug, "curieux@ex.fr", false, () => false);
    expect(r.ok, "connaître un slug ne donne aucun droit sur les participants d'un collègue").toBe(false);
    expect(r.status).toBe(403);
  });

  it("sauf si l'hôte l'autorise — c'est sa règle, pas la nôtre", async () => {
    base();
    const r = await presentations.presentationStats(LIGNE.slug, "collegue@ex.fr", false, () => true);
    expect(r.ok, "une équipe où chacun voit tout est un choix défendable").toBe(true);
  });

  // ⚠️ Une autorisation qui LÈVE vaut refus. C'est la posture du contrat : un droit qu'on ne sait pas
  // accorder ne s'accorde pas.
  it("une autorisation qui échoue vaut refus", async () => {
    base();
    const r = await presentations.presentationStats(LIGNE.slug, "collegue@ex.fr", false, () => { throw new Error("hôte injoignable"); });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  // ⚠️ ET ON NE PAIE PAS L'AUTORISATION QUAND ELLE EST INUTILE. Le propriétaire n'a pas à provoquer
  // un aller-retour vers l'hôte pour lire ce qui lui appartient déjà.
  it("le propriétaire ne déclenche aucune demande d'autorisation", async () => {
    base();
    let demandes = 0;
    await presentations.presentationStats(LIGNE.slug, PROPRIO, false, () => { demandes++; return true; });
    expect(demandes, "un aller-retour par lecture, pour rien").toBe(0);
  });

  it("la casse de l'adresse ne fait pas perdre sa propre présentation", async () => {
    base();
    expect((await presentations.presentationStats(LIGNE.slug, "  Proprio@Ex.FR ", false, () => false)).ok).toBe(true);
  });
});

// ── L'historique par document : on FILTRE, on ne refuse pas ──────────────────────────────────────
describe("l'historique d'un document ne montre que ce qui revient à l'appelant", () => {
  const MIENNE = { ...LIGNE, slug: "Mienne-00001", owner_email: PROPRIO };
  const AUTRE = { ...LIGNE, slug: "Autre-000001", owner_email: "quelquun@ailleurs.fr" };

  it("un membre voit les siennes, et seulement les siennes", async () => {
    base([MIENNE, AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", PROPRIO, false, () => false);
    expect(l.map((p) => p.slug)).toEqual(["Mienne-00001"]);
  });

  // ⚠️ FILTRER PLUTÔT QUE REFUSER, ET C'EST UN CHOIX. Refuser en bloc priverait un membre de SA
  // propre liste. Une liste qui montre moins n'est pas une panne ; une liste qui refuse tout en est
  // une.
  it("il n'est jamais privé de sa propre liste", async () => {
    base([MIENNE, AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", PROPRIO, false, () => false);
    expect(l.length, "refuser en bloc aurait rendu une liste vide à qui a bien présenté").toBe(1);
  });

  it("un administrateur voit tout", async () => {
    base([MIENNE, AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", "admin@ex.fr", true, () => false);
    expect(l).toHaveLength(2);
  });

  it("et l'hôte peut élargir", async () => {
    base([MIENNE, AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", "collegue@ex.fr", false, () => true);
    expect(l).toHaveLength(2);
  });

  it("un membre sans aucune présentation obtient une liste vide, pas une erreur", async () => {
    base([AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", "nouveau@ex.fr", false, () => false);
    expect(l).toEqual([]);
  });

  // ⚠️ L'adresse du propriétaire sert à filtrer — elle ne doit pas repartir dans la réponse.
  it("l'adresse qui a servi au filtrage ne fuit pas dans la réponse", async () => {
    base([MIENNE, AUTRE]);
    const l = await presentations.listPresentationsForDoc("d1", "admin@ex.fr", true, () => false);
    expect(JSON.stringify(l), "on n'expose pas les adresses en élargissant la vue")
      .not.toContain("@");
  });
});

// ── La route, qui est l'autre moitié ─────────────────────────────────────────────────────────────
//
// ⚠️ CE BLOC EXISTE PARCE QU'UNE MUTATION A SURVÉCU. Les tests ci-dessus exercent la FONCTION : ils
// passent l'identité eux-mêmes. Une route qui transmettrait « isAdmin: true » à tout le monde rendrait
// donc la garde inatteignable sans qu'aucun d'eux ne bronche — et c'est très exactement le motif
// « vérifier sans émettre » du jeton interne, où une moitié correcte ne ferme rien.
//
// On joue donc la route entière, avec un vrai jeton de membre étranger.
describe("la route ne contourne pas la garde qu'elle appelle", () => {
  const LIGNE_ROUTE = { slug: "Route-000001", owner_email: "proprio@ex.fr", doc_id: "d1", active: true, current_page: 1, created_at: "2026-08-17T08:00:00.000Z" };
  const player = require("../handler.js");

  function contexte(session, largeAutorise) {
    return {
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
      // ⚠️ La VRAIE fonction est appelée par la route : c'est tout l'objet du bloc. Elle lit donc sa
      // ligne par ce contexte-ci, et non par une substitution de module — sinon on testerait un
      // chemin que la production n'emprunte pas.
      db: { async request(chemin) {
        return String(chemin).startsWith("doc_presentations?") ? [{ ...LIGNE_ROUTE }] : [];
      }, async selectAll() { return []; } },
      mail: { async send() {} },
      identity: {
        async verifyToken(e) { return e && session ? { email: session } : null; },
        roleOf: () => "", isAdmin: () => false,
        async canManageShares() { return !!largeAutorise; },
      },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture() {} },
      legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "c", mapsKey: "", extraFrameAncestors: [] },
    };
  }

  async function poster(corps, session, large) {
    player.init(contexte(session, large));
    const res = { statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" }, socket: {}, query: {}, body: corps }, res);
    return { statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
  }

  it("un membre étranger reçoit 403 sur les statistiques", async () => {
    const r = await poster({ action: "present-stats", slug: LIGNE_ROUTE.slug }, "curieux@ex.fr", false);
    expect(r.statut, "la route doit transmettre l'identité RÉELLE, pas une identité complaisante")
      .toBe(403);
  });

  it("le propriétaire, lui, les obtient", async () => {
    const r = await poster({ action: "present-stats", slug: LIGNE_ROUTE.slug }, "proprio@ex.fr", false);
    expect(r.statut).toBe(200);
  });

  it("et l'hôte peut élargir depuis la route aussi", async () => {
    const r = await poster({ action: "present-stats", slug: LIGNE_ROUTE.slug }, "collegue@ex.fr", true);
    expect(r.statut).toBe(200);
  });

  // ⚠️ ET LA SECONDE ROUTE AUSSI. Ne couvrir que la première laissait survivre la mutation
  // symétrique : la route de l'historique déclarant, elle, tout le monde administrateur. Une garde
  // vérifiée sur un seul de ses deux appelants n'est vérifiée qu'à moitié.
  it("l'historique d'un document est filtré par la route, pas seulement par la fonction", async () => {
    const r = await poster({ action: "present-doc-list", docId: "d1" }, "curieux@ex.fr", false);
    expect(r.statut).toBe(200);
    expect(r.corps.presentations, "un membre étranger ne doit voir aucune présentation d'autrui")
      .toEqual([]);
  });

  it("et le propriétaire y retrouve la sienne", async () => {
    const r = await poster({ action: "present-doc-list", docId: "d1" }, "proprio@ex.fr", false);
    expect(r.corps.presentations.map((p) => p.slug)).toEqual(["Route-000001"]);
  });

  it("sans jeton, c'est toujours 401 — la possession ne remplace pas la session", async () => {
    const r = await poster({ action: "present-stats", slug: LIGNE_ROUTE.slug }, null, true);
    expect(r.statut).toBe(401);
  });
});
