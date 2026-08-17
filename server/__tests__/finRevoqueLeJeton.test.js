// « TERMINER » NE TERMINAIT RIEN DE DÉFINITIF.
//
// Les fonctions de pilotage écrivent `active: true` — c'est voulu — et le jeton de contrôle
// survivait à la clôture. Un second onglet resté ouvert remettait donc la présentation en ligne pour
// l'audience alors que le présentateur la croyait close. Le jeton est persisté en localStorage : ce
// n'était pas une course étroite, c'était une porte ouverte à volonté.
//
// Signalé par la vérification d'audit qui a suivi 0.1.43.
//
// ⚠️ MAIS LA RÈGLE PROPOSÉE — « refuser toute écriture si active=false » — AURAIT CASSÉ UNE REPRISE.
//
// `active:false` recouvre DEUX situations qui n'ont rien à voir :
//
//   1. une fin DÉCIDÉE : plus rien ne doit piloter ;
//   2. une péremption CONSTATÉE (3 min sans battement) : le portable du présentateur a dormi, et sa
//      page suivante doit le remettre en ligne. La « résurrection » EST la reprise.
//
// Refuser les deux condamnerait un présentateur ANONYME à ne jamais revenir : `present-reclaim`
// exige la propriété, et `present-start` n'exige aucune session. On distingue donc les deux cas par
// ce qui les sépare vraiment — la décision — plutôt que par l'état qu'ils partagent : terminer
// RÉVOQUE le jeton, la péremption le laisse intact.
//
// ⚠️ Ce fichier teste autant ce qui doit continuer de marcher que ce qui doit se fermer. Une garde
// qui ferme trop est un défaut au même titre qu'une garde qui ne ferme rien.

const crypto = require("node:crypto");
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");

const CONTROL = "jeton-de-controle-du-presentateur";
const presentations = require("../presentations.js");

/** Une base en mémoire : on veut voir ce que chaque appel ÉCRIT, pas seulement ce qu'il rend. */
function base(ligne) {
  const etat = { ...ligne };
  const ecritures = [];
  presentations.init({
    db: { async request(chemin, o) {
      if (o && o.method === "PATCH") { const t = lignesTouchees(chemin, etat); if (!t.length) return []; ecritures.push(o.body); Object.assign(etat, o.body); return [{ ...etat }]; }
      if (o && o.method === "POST") { ecritures.push(o.body); return []; }
      return etat.__absente ? [] : [{ ...etat }];
    } },
    limits: { async allow() { return true; } }, errors: { capture() {} },
  });
  return { etat, ecritures };
}

const LIGNE = {
  slug: "Ab3-_xYz9012", control_hash: sha(CONTROL), owner_email: "proprio@ex.fr",
  active: true, current_page: 1, last_seen: new Date().toISOString(),
};
const CARTE = { kind: "map", lat: 43.5, lon: -1.5, zoom: 14 };

// ⚠️ MODÉLISE LA CONDITION, PAS SEULEMENT LE SUCCÈS. Le pilotage écrit désormais sous condition
// (`&control_hash=eq.…`, `&active=eq.true`, `&write_seq=lt.…`) et PostgREST répond par les lignes
// TOUCHÉES : zéro ligne = refus. Une doublure qui rendrait toujours une ligne ferait passer les
// essais même si la condition disparaissait du code.
function lignesTouchees(chemin, etat) {
  const cond = String(chemin).split("&").slice(1);
  for (const c of cond) {
    const [champ, valeur] = c.split("=");
    if (champ === "control_hash" && valeur !== "eq." + require("crypto").createHash("sha256").update(String(etat.control_hash_source || "")).digest("hex")) {
      if (valeur !== "eq." + String(etat.control_hash || "")) return [];
    } else if (champ === "active" && valeur === "eq.true" && etat.active === false) {
      return [];
    } else if (champ === "write_seq" && valeur.startsWith("lt.") && Number(etat.write_seq || 0) >= Number(valeur.slice(3))) {
      return [];
    }
  }
  return [{ ...etat }];
}

describe("terminer révoque le jeton de contrôle", () => {
  it.each([
    ["par le présentateur", (b) => presentations.endPresentation(LIGNE.slug, CONTROL), void 0],
    ["par le propriétaire", (b) => presentations.endPresentationByOwner(LIGNE.slug, "proprio@ex.fr", false), void 0],
  ])("%s : la ligne est close ET le jeton effacé", async (_nom, terminer) => {
    const b = base(LIGNE);
    const r = await terminer(b);
    expect(r.ok).toBe(true);
    expect(b.etat.active, "la présentation est close").toBe(false);
    expect(b.etat.control_hash, "sans ça, le jeton d'un onglet resté ouvert la rouvre").toBeNull();
  });

  it("après quoi le même jeton ne tourne plus une page", async () => {
    const b = base(LIGNE);
    await presentations.endPresentation(LIGNE.slug, CONTROL);
    b.ecritures.length = 0;
    const r = await presentations.setPage(LIGNE.slug, CONTROL, 7);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(b.ecritures, "un refus n'écrit rien — et surtout pas active:true").toEqual([]);
    expect(b.etat.active, "c'était ça, la résurrection").toBe(false);
  });

  it("ni ne déplace la carte", async () => {
    const b = base(LIGNE);
    await presentations.endPresentation(LIGNE.slug, CONTROL);
    b.ecritures.length = 0;
    const r = await presentations.setPresentationContent(LIGNE.slug, "", false, CARTE, CONTROL);
    expect(r.ok).toBe(false);
    expect(b.etat.active).toBe(false);
  });
});

// ⚠️ L'AUTRE MOITIÉ : le propriétaire n'a pas besoin de jeton, la révocation ne l'arrête donc pas.
describe("une présentation close ne se pilote plus non plus par le chemin propriétaire", () => {
  const CLOSE = { ...LIGNE, active: false, control_hash: null };

  it("le propriétaire ne la rouvre pas en déplaçant une carte", async () => {
    const b = base(CLOSE);
    const r = await presentations.setPresentationContent(CLOSE.slug, "proprio@ex.fr", false, CARTE, "");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(b.etat.active, "celui qui vient de terminer la remettrait en ligne sans le vouloir").toBe(false);
  });

  it("ni un administrateur", async () => {
    const b = base(CLOSE);
    expect((await presentations.setPresentationContent(CLOSE.slug, "autre@ex.fr", true, CARTE, "")).status).toBe(409);
    expect(b.etat.active).toBe(false);
  });

  it("ni en changeant le document montré", async () => {
    const b = base(CLOSE);
    const r = await presentations.switchPresentationDoc(CLOSE.slug, "proprio@ex.fr", false, {
      fileUrl: "https://exemple.supabase.co/x.pdf", fileName: "x.pdf", docTitle: "X", docId: "d2",
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
  });

  // La reprise reste la porte prévue pour rouvrir : c'est une décision, et elle regénère un jeton.
  it("mais « reprendre » rouvre bel et bien, avec un jeton frais", async () => {
    const b = base(CLOSE);
    const r = await presentations.reclaimPresentation(CLOSE.slug, "proprio@ex.fr");
    expect(r.ok).toBe(true);
    expect(r.control, "un jeton neuf, pas l'ancien").toBeTruthy();
    expect(r.control).not.toBe(CONTROL);
    expect(b.etat.active).toBe(true);
  });
});

// ⚠️ CE QUI DOIT CONTINUER DE MARCHER, ET QUE LA RÈGLE GÉNÉRALE AURAIT CASSÉ.
describe("une présentation seulement PÉRIMÉE se reprend toute seule", () => {
  // La péremption marque `active:false` en laissant le jeton : c'est la différence, et c'est elle
  // qui distingue « on a décidé » de « on a constaté ».
  const PERIMEE = { ...LIGNE, active: false };

  it("le présentateur qui revient tourne une page et repasse en ligne", async () => {
    const b = base(PERIMEE);
    const r = await presentations.setPage(PERIMEE.slug, CONTROL, 4);
    expect(r.ok, "sans ça, un présentateur ANONYME ne pourrait jamais revenir : la reprise exige la propriété")
      .toBe(true);
    expect(b.etat.active, "la remise en ligne est le comportement voulu ici").toBe(true);
    expect(b.etat.current_page).toBe(4);
  });

  it("et il retrouve aussi sa carte", async () => {
    const b = base(PERIMEE);
    const r = await presentations.setPresentationContent(PERIMEE.slug, "", false, CARTE, CONTROL);
    expect(r.ok).toBe(true);
    expect(b.etat.active).toBe(true);
  });

  // ⚠️ La péremption ne doit surtout pas se mettre à révoquer : elle constate, elle ne décide pas.
  it("le balayage de péremption laisse le jeton intact", async () => {
    const b = base({ ...LIGNE, last_seen: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    await presentations.listActivePresentations("proprio@ex.fr");
    const cloture = b.ecritures.find((e) => e && e.active === false);
    expect(cloture, "le balayage doit bien clore la présentation périmée").toBeTruthy();
    expect(Object.keys(cloture), "révoquer ici interdirait toute reprise sans session")
      .not.toContain("control_hash");
  });
});
