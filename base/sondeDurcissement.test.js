// LA SONDE DE DURCISSEMENT N'ÉCRIT RIEN — ÉPROUVÉ CONTRE UN VRAI POSTGRES.
//
// ⚠️ Elle interroge la base pour savoir si la migration 0018 est appliquée, en APPELANT la fonction.
// C'est le seul moyen : 0018 remplace une FONCTION, aucune sonde de colonne ne peut la voir, et
// `presenceDurcissement` est un rapport d'exécution qui rend « inconnu » sur toute instance au repos.
//
// L'innocuité repose sur une lecture de la migration : avec `p_anon_cap = 0`, une ligne inexistante
// part par la branche « capped » et la fonction rend AVANT son `insert`. Une lecture n'est pas une
// preuve — le double en mémoire ne saurait pas non plus le dire, puisqu'il ne contient pas le corps
// de la fonction. Seul un vrai Postgres tranche, et c'est ce que fait ce banc.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc sonde de durcissement : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. "
    + "S'esquiver dans la forge reviendrait à ne rien éprouver.");
}
const decrire = BASE && SECRET ? describe : describe.skip;

function jeton() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
}

let schema, base;

decrire("la sonde de durcissement dit vrai, et ne laisse aucune trace", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    schema = require("../server/schema.js");
    schema.oublier(); schema.init(contexte);
    base = contexte.db;
  });

  const lignesDeSonde = async () =>
    (await base.request(
      "doc_presentation_attendees?slug=eq." + encodeURIComponent("sonde durcissement") + "&select=attendee_key"
    )).length;

  it("rend « applique » sur une base qui porte bien 0018", async () => {
    const etat = await schema.sonderTout();
    expect(etat.durcissementBase,
      "la base du banc applique toutes les migrations : la sonde doit le CONSTATER, pas le supposer")
      .toBe("applique");
  });

  // ⚠️ LE CŒUR DE CE FICHIER. Une sonde de diagnostic qui écrit serait pire que pas de sonde : elle
  // fabriquerait des participants fantômes à chaque consultation de la carte — et la carte est
  // publique.
  it("n'insère AUCUNE ligne, même appelée plusieurs fois", async () => {
    expect(await lignesDeSonde(), "état de départ").toBe(0);
    // `oublier()` remet le cache de 30 s à zéro : la sonde repart réellement à chaque tour.
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    for (let i = 0; i < 3; i++) { schema.oublier(); schema.init(contexte); await schema.sonderTout(); }
    expect(await lignesDeSonde(),
      "la sonde a créé un participant : elle est appelée à chaque `?schema=1`, donc la carte "
      + "publique fabriquerait des lignes fantômes à volonté")
      .toBe(0);
  });

  it("le champ dit sa PORTÉE — c'est une propriété de la base, pas de ce processus", async () => {
    const etat = await schema.sonderTout();
    expect(etat.durcissementBaseCouvre).toMatch(/BASE/);
    expect(etat.durcissementBaseCouvre,
      "sans cette distinction, on relit `presenceDurcissement` en croyant lire un inventaire")
      .toMatch(/presenceDurcissement/);
  });
});
