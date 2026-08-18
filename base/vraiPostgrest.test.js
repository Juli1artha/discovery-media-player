// ⚠️ LE DOUBLE EN MÉMOIRE DIT LUI-MÊME CE QU'IL NE SAIT PAS FAIRE.
//
//   « Pas de transactions, pas de contraintes, pas de types, pas de RLS — et surtout PAS un
//     substitut pour vérifier ce qui relève du SGBD (un verrou optimiste concurrent, une
//     contrainte d'unicité). »   — tools/postgrest-en-memoire.cjs
//
// Or ce sont EXACTEMENT les trois propriétés sur lesquelles reposent les correctifs récents :
// l'idempotence des messages tient à une contrainte d'unicité, l'ordre des écritures de pilotage
// à l'atomicité d'un PATCH conditionnel, et la sonde de schéma au fait que PostgREST rejette le
// POST ENTIER sur une colonne inconnue. Aucune n'avait jamais été éprouvée devant une vraie base :
// elles étaient déduites de la documentation, pas constatées.
//
// ⚠️ CE BANC NE MONTE PAS UN CHEMIN À PART. Il branche le player sur un vrai PostgREST par le
// MÊME mécanisme que le double : une URL et une clé dans l'environnement. Si le banc devait
// s'écarter du chemin de production pour passer, il ne prouverait que sa propre existence.
//
// Il s'esquive quand l'adresse n'est pas fournie — il n'y a pas de Postgres sur un poste de
// travail. La preuve est produite dans la forge, et nulle part ailleurs.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

// ⚠️ UN BANC QUI S'ESQUIVE EN SILENCE PASSE AU VERT SANS RIEN AVOIR EXERCÉ. Confortable sur un
// poste de travail, béant dans la forge : le jour où le service PostgREST cesse de démarrer,
// l'étape resterait verte et les trois propriétés ne seraient plus vérifiées par personne. Même
// règle que le banc navigateur — `CI` posé, l'esquive devient un échec.
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc vraie base : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. Dans la forge, " +
    "s'esquiver reviendrait à ne plus rien éprouver — le service PostgREST n'a pas démarré ?");
}
const decrire = BASE && SECRET ? describe : describe.skip;

/** Jeton HS256 pour le rôle d'essai. Le secret est une valeur de banc, pas un identifiant. */
function jeton() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
}

decrire("les trois propriétés que le double ne sait pas simuler", () => {
  let presentations, schema, base;

  beforeAll(() => {
    // ⚠️ AVANT le `require` : le contexte autonome se fabrique à l'import, depuis l'environnement.
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    presentations = require("../server/presentations.js");
    schema = require("../server/schema.js");
    base = contexte.db;   // la MÊME base que le player, pas une seconde connexion
  });

  async function nouvellePresentation() {
    return presentations.createPresentation({
      docId: "doc-" + crypto.randomBytes(4).toString("hex"),
      fileUrl: "https://exemple.test/doc.pdf", fileName: "doc.pdf",
      docTitle: "Banc", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
    });
  }

  it("la sonde de schéma voit la vraie base : la colonne d'idempotence est là", async () => {
    schema.oublier();
    expect(await schema.aLaColonne("doc_presentation_messages", "client_key", "0005")).toBe(true);
    expect(await schema.aLaColonne("doc_presentations", "write_seq", "0002")).toBe(true);
    // Et elle ne dit pas oui à n'importe quoi.
    expect(await schema.aLaColonne("doc_presentation_messages", "colonne_qui_n_existe_pas", "—")).toBe(false);
  });

  // ⚠️ C'EST LA CONTRAINTE QUI FAIT LE TRAVAIL, PAS NOTRE CODE. Le double ne peut pas la porter :
  // sans index unique, les deux envois passent et l'essai serait vert pour rien.
  it("un renvoi avec la même clé ne crée pas un second message — index unique réel", async () => {
    const p = await nouvellePresentation();
    const cle = "cle-" + crypto.randomBytes(6).toString("hex");
    const envoi = () => presentations.addMessage(p.slug, {
      name: "Banc", body: "bonjour", authorToken: "jeton-banc", clientKey: cle,
    });

    const un = await envoi();
    const deux = await envoi();

    expect(un.ok).toBe(true);
    expect(deux.ok, "le 409 de la contrainte est remonté comme une panne").toBe(true);
    expect(deux.deja, "second envoi accepté comme un nouveau message").toBe(true);
    expect(deux.message.id, "deux lignes en base : le renvoi a doublé le message").toBe(un.message.id);

    const tous = await presentations.listMessages(p.slug);
    expect(tous.filter((m) => m.body === "bonjour").length).toBe(1);
  });

  // ⚠️ DEUX ENVOIS SIMULTANÉS, PAS DEUX ENVOIS À LA SUITE. Enchaînés, même une lecture-puis-
  // écriture naïve passerait : c'est la course qui distingue l'atomique du reste.
  it("deux envois SIMULTANÉS avec la même clé : un seul message existe", async () => {
    const p = await nouvellePresentation();
    const cle = "course-" + crypto.randomBytes(6).toString("hex");
    const envoi = () => presentations.addMessage(p.slug, {
      name: "Banc", body: "en même temps", authorToken: "jeton-banc", clientKey: cle,
    });

    const resultats = await Promise.all([envoi(), envoi(), envoi()]);

    expect(resultats.every((r) => r.ok)).toBe(true);
    const ids = new Set(resultats.map((r) => r.message.id));
    expect(ids.size, "la course a créé plusieurs messages").toBe(1);
    const tous = await presentations.listMessages(p.slug);
    expect(tous.filter((m) => m.body === "en même temps").length).toBe(1);
  });

  // ⚠️ LE PATCH CONDITIONNEL EST UN VERROU OU N'EST RIEN. `write_seq=lt.N` doit refuser une
  // écriture périmée en NE TOUCHANT AUCUNE LIGNE — ce que seule une vraie base peut démontrer.
  it("une écriture de pilotage doublée en vol est refusée, et n'écrase pas la plus récente", async () => {
    const p = await nouvellePresentation();

    expect((await presentations.setPage(p.slug, p.control, 7, 5)).ok).toBe(true);

    // ⚠️ UN REFUS NE SE LIT PAS DANS `ok`, ET C'EST VOULU. `setPage` documente que « périmé n'est
    // pas une erreur : c'est le système qui fonctionne » — le navigateur n'a rien à afficher, sa
    // page est déjà dépassée. Le refus se lit dans `perime`, et surtout DANS LA BASE.
    const perimee = await presentations.setPage(p.slug, p.control, 2, 3);   // rang inférieur
    expect(perimee.ok).toBe(true);
    expect(perimee.perime, "l'écriture périmée n'a pas été reconnue comme telle").toBe(true);

    const apresPerimee = await presentations.getPresentation(p.slug);
    expect(apresPerimee.current_page, "la page a RECULÉ : le verrou n'a pas tenu").toBe(7);

    // ⚠️ Et le verrou ne doit pas tout bloquer : une garde qui refuse aussi ce qui est légitime
    // passerait cet essai en refusant simplement tout. Un rang supérieur doit encore passer.
    const suivante = await presentations.setPage(p.slug, p.control, 9, 6);
    expect(suivante.perime, "le verrou refuse aussi les écritures légitimes").toBeFalsy();
    expect((await presentations.getPresentation(p.slug)).current_page).toBe(9);
  });

  // ⚠️ C'EST L'HYPOTHÈSE DERRIÈRE TOUTE LA SONDE DE SCHÉMA. Si PostgREST écrivait la ligne en
  // ignorant la colonne inconnue, `aLaColonne` ne servirait à rien — et le jour où il changerait
  // d'avis, on l'apprendrait par des envois de messages qui cessent de fonctionner en production.
  it("une colonne inconnue fait rejeter le POST ENTIER — aucune ligne partielle", async () => {
    const p = await nouvellePresentation();
    const ligne = { slug: p.slug, body: "avec une colonne inventée", colonne_inventee: "x" };
    let refus = null;
    try {
      await base.request("doc_presentation_messages", { method: "POST", body: [ligne] });
    } catch (e) { refus = e; }

    expect(refus, "PostgREST a accepté une colonne inconnue").toBeTruthy();
    const tous = await presentations.listMessages(p.slug);
    expect(tous.length, "une ligne partielle a été écrite malgré le refus").toBe(0);
  });
});
