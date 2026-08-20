// LE TRIGGER `mod_seq` AVANCE À CHAQUE ÉCRITURE — INSERTION ET MUTATION — ÉPROUVÉ CONTRE UN VRAI POSTGRES.
//
// ⚠️ P « architecture scalable ». Le différentiel du chat repose sur un fait que seul le SGBD porte :
// un trigger before-insert-or-update qui bumpe `mod_seq` depuis une séquence. Le double en mémoire ne
// simule ni trigger ni séquence. Ce banc vérifie la propriété qui fait tout le reste : un message
// ÉDITÉ (ou réagi) reçoit un mod_seq PLUS GRAND que sa création — sinon un spectateur en retard ne
// verrait jamais la mutation d'un ancien message.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

if (process.env.CI && !(BASE && SECRET)) {
  throw new Error("banc chat différentiel : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents.");
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

decrire("le rang de changement (mod_seq) est porté par la base", () => {
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
  const modSeq = async (slug, id) =>
    (await base.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${encodeURIComponent(slug)}&select=mod_seq&limit=1`))[0].mod_seq;

  it("l'insertion pose un mod_seq, l'édition le fait CROÎTRE", async () => {
    const p = await nouvellePresentation();
    const env = await presentations.addMessage(p.slug, { name: "Banc", body: "bonjour", authorToken: "jeton-banc" });
    expect(env.ok).toBe(true);
    const seqCreation = await modSeq(p.slug, env.message.id);
    expect(typeof seqCreation).toBe("number");

    await presentations.editMessage(p.slug, env.message.id, "jeton-banc", "bonjour (corrigé)");
    const seqEdition = await modSeq(p.slug, env.message.id);
    expect(seqEdition, "une mutation doit avancer le rang, sinon le différentiel la rate").toBeGreaterThan(seqCreation);
  }, 30000);

  it("le différentiel `mod_seq=gt.N` récupère un ANCIEN message muté après N", async () => {
    const p = await nouvellePresentation();
    const a = await presentations.addMessage(p.slug, { name: "Banc", body: "un", authorToken: "t1" });
    const b = await presentations.addMessage(p.slug, { name: "Banc", body: "deux", authorToken: "t2" });
    // Curseur = le plus grand rang connu après les deux insertions.
    const curseur = Math.max(await modSeq(p.slug, a.message.id), await modSeq(p.slug, b.message.id));
    // On mute le PREMIER (le plus ancien) : son rang doit repasser au-dessus du curseur.
    await presentations.editMessage(p.slug, a.message.id, "t1", "un (corrigé)");
    const diff = await presentations.listMessages(p.slug, { after: curseur });
    expect(diff.map((m) => m.id), "le message ancien muté revient, pas le message non touché").toEqual([a.message.id]);
  }, 30000);
});
