// LE PLAFOND DE CRÉATION ANONYME TIENT SOUS LA CONCURRENCE — ÉPROUVÉ CONTRE UN VRAI POSTGRES.
//
// ⚠️ P1c audit CODEX 5.6, étape 1. Le double en mémoire ne sait ni verrouiller (pg_advisory_xact_lock)
// ni compter-puis-insérer atomiquement : c'est PRÉCISÉMENT ce que le plafond exige. Un « compter, puis
// insérer » naïf laisse deux créations concurrentes franchir le plafond ensemble. Seule une vraie base
// le démontre. Le banc s'esquive sans adresse (pas de Postgres sur un poste), et échoue s'il s'esquive
// dans la forge — même règle que les autres bancs `base/`.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc présence atomique : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. " +
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

let presentations, base;

decrire("le plafond de création anonyme est atomique (RPC 0015)", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    presentations = require("../server/presentations.js");
    base = contexte.db;
  });

  async function nouvellePresentation() {
    return presentations.createPresentation({
      docId: "doc-" + crypto.randomBytes(4).toString("hex"),
      fileUrl: "https://exemple.test/doc.pdf", fileName: "doc.pdf",
      docTitle: "Banc", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
    });
  }

  const battre = (slug, key, opts = {}) => presentations.recordAttendance(
    slug,
    { key, name: "V", isMember: !!opts.isMember, isPresenter: !!opts.isPresenter },
    { ipHash: opts.ip || "hA", anonCap: opts.cap ?? 325 },
  );

  const nbAnon = async (slug) =>
    (await base.request(`doc_presentation_attendees?slug=eq.${encodeURIComponent(slug)}&is_member=is.false&is_presenter=is.false&select=attendee_key`)).length;

  // ⚠️ EN CONCURRENCE, PAS À LA SUITE. Enchaînées, une lecture-puis-insertion naïve tiendrait le
  // compte ; c'est la course qui distingue le verrou atomique du reste.
  it("360 créations SIMULTANÉES avec un plafond de 325 : exactement 325 passent, pas une de plus", async () => {
    const p = await nouvellePresentation();
    const essais = Array.from({ length: 360 }, (_, i) => battre(p.slug, `anon-${i}`, { cap: 325 }));
    const r = await Promise.all(essais);
    const passes = r.filter((x) => x.ok).length;
    const plafonnes = r.filter((x) => !x.ok && x.status === 429).length;
    expect(passes, "le verrou atomique n'a pas laissé dépasser le plafond").toBe(325);
    expect(plafonnes).toBe(360 - 325);
    expect(await nbAnon(p.slug), "exactement 325 lignes anonymes en base").toBe(325);
  }, 30000);

  it("une clé DÉJÀ enregistrée s'actualise même une fois le plafond atteint", async () => {
    const p = await nouvellePresentation();
    await Promise.all(Array.from({ length: 325 }, (_, i) => battre(p.slug, `a-${i}`, { cap: 325 })));
    const encore = await battre(p.slug, "a-0", { cap: 325 });   // existe déjà
    expect(encore.ok, "une présence enregistrée doit toujours pouvoir s'actualiser").toBe(true);
    expect(await nbAnon(p.slug), "aucune nouvelle ligne : c'était une mise à jour").toBe(325);
  }, 30000);

  it("membre et présentateur ne consomment pas le quota anonyme, même au plafond", async () => {
    const p = await nouvellePresentation();
    await Promise.all(Array.from({ length: 325 }, (_, i) => battre(p.slug, `b-${i}`, { cap: 325 })));
    const m = await battre(p.slug, "membre@x.fr", { isMember: true, cap: 325 });
    const pr = await battre(p.slug, "presKey", { isPresenter: true, cap: 325 });
    expect(m.ok && pr.ok, "identité prouvée → jamais soumise au plafond anonyme").toBe(true);
  }, 30000);

  it("le plafond est par présentation : une autre présentation a son propre compte", async () => {
    const p1 = await nouvellePresentation();
    const p2 = await nouvellePresentation();
    await Promise.all(Array.from({ length: 325 }, (_, i) => battre(p1.slug, `c-${i}`, { cap: 325 })));
    const r = await battre(p2.slug, "c-0", { cap: 325 });
    expect(r.ok, "le plafond de p1 ne concerne pas p2").toBe(true);
  }, 30000);
});
