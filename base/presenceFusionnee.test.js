// LA BASE LIT LA PRÉSENTATION, ET ON LE MESURE — CONTRE UN VRAI POSTGRES (migration 0019).
//
// ⚠️ CE FICHIER PORTE LA MOITIÉ D'UNE PREUVE. La décision « qui est le présentateur » a quitté le
// JavaScript pour le SQL : `server/__tests__/titreUsurpe.test.js` prouve désormais que la route
// TRANSMET l'empreinte du jeton sans rien accorder elle-même, et c'est ici qu'on prouve que cette
// empreinte accorde — ou n'accorde pas — le titre. Chaque moitié reste verte toute seule pendant que
// la propriété, elle, aurait cessé de tenir : les deux fichiers se nomment donc l'un l'autre.
//
// ⚠️ ET LES DEUX REFUS. Avant 0019, la route lisait la présentation et refusait en JavaScript : un
// 404 « elle n'existe pas », un 409 « elle est finie ». Un déplacement de décision est l'endroit où
// une garde se perd en chemin ; on éprouve donc ici que les deux refus existent toujours, et surtout
// qu'AUCUNE LIGNE n'est écrite quand ils tombent — ce qu'un double en mémoire ne peut pas montrer.
//
// ⚠️ ENFIN LE GAIN LUI-MÊME. Un banc qui ne compte pas les allers-retours ne peut pas distinguer le
// chemin fusionné de l'ancien : il resterait vert si le mémo était armé et que tout repartait comme
// avant. On compte donc les requêtes, et on lit ce qui part.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc présence fusionnée : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. " +
    "S'esquiver dans la forge reviendrait à ne rien éprouver.");
}
const decrire = BASE && SECRET ? describe : describe.skip;

function jeton() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

let presentations, base, journal;

decrire("la présence en un seul aller-retour (RPC 0019)", () => {
  beforeAll(async () => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    presentations = require("../server/presentations.js");
    base = contexte.db;
    // On journalise SANS rien changer au comportement : c'est la seule façon de distinguer le
    // chemin fusionné de l'ancien, et de refuser de conclure si c'est l'ancien qui a tourné.
    const vraie = contexte.db.request.bind(contexte.db);
    journal = [];
    contexte.db.request = async (chemin, o) => {
      journal.push({ chemin, methode: (o && o.method) || "GET", corps: (o && o.body) || null });
      return vraie(chemin, o);
    };
  });

  async function nouvelle() {
    return presentations.createPresentation({
      docId: "doc-" + crypto.randomBytes(4).toString("hex"),
      fileUrl: "https://exemple.test/doc.pdf", fileName: "doc.pdf",
      docTitle: "Banc 0019", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
    });
  }

  const battre = (slug, key, opts = {}) => presentations.recordAttendance(
    slug, { key, name: "V" },
    { ipHash: opts.ip || "h0019", anonCap: opts.cap ?? 325, hasToken: opts.hasToken ?? false,
      controlHash: opts.controlHash ?? null, sansFusion: !!opts.sansFusion },
  );

  const lignes = async (slug) => base.request(
    `doc_presentation_attendees?slug=eq.${encodeURIComponent(slug)}&select=attendee_key,is_presenter,pages`);

  /** Ce que le battement vient d'envoyer, journal remis à zéro. */
  function depuis(n) { return journal.slice(n); }

  it("un battement coûte UN aller-retour, et c'est bien le contrat fusionné qui part", async () => {
    const { slug } = await nouvelle();
    await battre(slug, "chauffe");            // sonde de schéma et mémos : hors mesure
    const n = journal.length;
    const r = await battre(slug, "mesure");
    expect(r.ok).toBe(true);
    const parti = depuis(n);
    expect(parti.map((e) => e.chemin)).toEqual(["rpc/player_attendance_bump"]);
    // ⚠️ ANTI-VACUITÉ : sans ces deux lignes, le test resterait vert alors que l'ancien chemin
    // tourne — `p_page` renseignée voudrait dire « le player a lu la présentation lui-même ».
    expect(parti[0].corps.p_page, "le player n'a pas lu : c'est la base qui tranche").toBe(null);
    expect("p_control_hash" in parti[0].corps, "le contrat à 13 arguments").toBe(true);
    await presentations.endPresentation(slug, (await nouvelle()).control).catch(() => {});
  });

  it("l'ancien chemin, lui, en coûte DEUX — c'est la mesure du gain", async () => {
    const { slug } = await nouvelle();
    await battre(slug, "chauffe");
    const n = journal.length;
    await battre(slug, "mesure", { sansFusion: true });
    const parti = depuis(n).map((e) => e.chemin);
    expect(parti.length, "lecture de la présentation, puis écriture").toBe(2);
    expect(parti[parti.length - 1]).toBe("rpc/player_attendance_bump");
  });

  it("l'empreinte juste accorde le titre, la fausse ne l'accorde pas", async () => {
    const { slug, control } = await nouvelle();
    await battre(slug, "vrai", { controlHash: sha(control) });
    await battre(slug, "faux", { controlHash: sha("pas-le-bon") });
    await battre(slug, "muet");
    const l = await lignes(slug);
    const titre = (k) => (l.find((x) => x.attendee_key === k) || {}).is_presenter;
    expect(titre("vrai"), "le jeton de contrôle prouve le titre").toBe(true);
    expect(titre("faux"), "une empreinte fausse ne prouve rien").toBe(false);
    expect(titre("muet"), "ne rien présenter ne prouve rien non plus").toBe(false);
  });

  it("la page enregistrée vient de la BASE, pas de l'appelant", async () => {
    const { slug, control } = await nouvelle();
    await presentations.setPage(slug, control, 5);
    await battre(slug, "suiveur");
    const l = await lignes(slug);
    const pages = (l.find((x) => x.attendee_key === "suiveur") || {}).pages || [];
    expect(pages, "le battement ne portait aucune page").toContain(5);
  });

  it("une présentation INTROUVABLE se refuse, et rien ne s'écrit", async () => {
    const inconnu = "banc0019" + crypto.randomBytes(4).toString("hex");
    const r = await battre(inconnu, "fantome");
    expect(r.ok).toBe(false);
    expect(r.status, "404 : cette présentation n'existe pas").toBe(404);
    expect((await lignes(inconnu)).length, "aucune ligne créée").toBe(0);
  });

  it("une présentation CLOSE ET ARCHIVÉE se refuse, et rien ne s'écrit", async () => {
    const { slug, control } = await nouvelle();
    await presentations.endPresentation(slug, control);
    const avant = (await lignes(slug)).length;
    const r = await battre(slug, "tardif");
    expect(r.ok).toBe(false);
    expect(r.status, "409 : elle est finie").toBe(409);
    expect((await lignes(slug)).length, "aucune ligne créée après la clôture").toBe(avant);
  });

  it("un appelant qui fournit la présentation garde EXACTEMENT l'ancien comportement", async () => {
    const { slug, control } = await nouvelle();
    await presentations.setPage(slug, control, 3);
    const pres = await presentations.getPresentation(slug);
    const r = await presentations.recordAttendance(slug, { key: "ancien", name: "V" },
      { presentation: pres, ipHash: "h0019", anonCap: 325, hasToken: false, controlHash: sha(control) });
    expect(r.ok).toBe(true);
    const l = await lignes(slug);
    const ligne = l.find((x) => x.attendee_key === "ancien") || {};
    expect(ligne.pages, "la page vient de la présentation qu'il a lue").toContain(3);
    expect(ligne.is_presenter, "et il compare le jeton lui-même, comme avant").toBe(true);
  });
});
