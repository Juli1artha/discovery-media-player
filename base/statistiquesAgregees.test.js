// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// DEUX TEXTES POUR LE MÊME CALCUL, CONFRONTÉS SUR LES MÊMES LIGNES.
//
// ⚠️ LA MIGRATION 0022 DÉPLACE L'AGRÉGATION EN BASE, ET LE JAVASCRIPT RESTE — délibérément. Un hôte
// n'applique pas forcément la dernière migration : le chemin en mémoire est son repli, et il reste
// la DÉFINITION DE RÉFÉRENCE. Deux définitions du même fait divergent tant que personne ne les
// confronte ; c'est la règle qui vaut déjà pour `supabase/init.sql` et ses migrations, pour
// `docs/API.md` et le code, et pour la purge de rétention et son recensement SQL.
//
// ⚠️ CE BANC NE VÉRIFIE PAS QUE LES CHIFFRES SONT « BONS » — il vérifie qu'ils sont LES MÊMES.
// C'est plus fort : aucun des deux textes n'est le juge de l'autre, et une erreur ne passe que si
// elle est commise DEUX FOIS, séparément, en SQL et en JavaScript. Un banc qui affirmerait des
// valeurs attendues écrites à la main n'aurait qu'un troisième exemplaire du même fait à entretenir.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "statistiques agrégées : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. "
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

let shares, contexte, docId, autreDoc, A, B, Z, C;

decrire("les statistiques : en base et en mémoire, le même résultat", () => {
  beforeAll(async () => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    shares = require("../server/shares.js");
    shares.init(contexte);

    docId = "stats-" + crypto.randomBytes(4).toString("hex");
    autreDoc = "stats-" + crypto.randomBytes(4).toString("hex");
    // ⚠️ DES SLUGS UNIQUES, PARCE QUE CE FICHIER TOURNE DEUX FOIS. `vitest.base.config.mjs` prend
    // `base/**/*.test.js` : ce banc est donc exécuté par `test:base` PUIS par `test:stats`, dans la
    // même base. Avec des slugs écrits en dur, la seconde exécution butait sur la clé primaire de
    // `commercial_doc_shares` — exactement la graine non idempotente que `retention.test.js` a déjà
    // payée, et dont `vitest.campagne.config.mjs` garde la trace écrite. Une graine de banc doit
    // pouvoir être semée deux fois : c'est une propriété du banc, pas une hypothèse sur son
    // ordonnanceur.
    const suffixe = crypto.randomBytes(4).toString("hex");
    A = "lien-a-" + suffixe; B = "lien-b-" + suffixe; Z = "lien-z-" + suffixe; C = "lien-c-" + suffixe;
    const maintenant = Date.now();
    const il_y_a = (min) => new Date(maintenant - min * 60000).toISOString();

    // ⚠️ UN JEU D'ESSAI QUI CHERCHE LES DÉSACCORDS, PAS LA MOYENNE. Chaque ligne vise un endroit
    // précis où SQL et JavaScript peuvent diverger : le `null` et la chaîne vide comptés comme
    // sessions, l'entonnoir qui retombe sur le slug quand la session manque, une page à zéro qui
    // n'entre pas dans l'entonnoir, la casse des e-mails internes, l'ordre d'arrivée face à
    // « dernière activité », et deux liens du même document qu'il ne faut pas confondre.
    const lignes = [
      { doc_id: docId, slug: A, event: "open", page: 3, max_page: 5, seconds: 12, session_id: "s1", at: il_y_a(50) },
      { doc_id: docId, slug: A, event: "page", page: 5, max_page: 5, seconds: 40, session_id: "s1", at: il_y_a(10) },
      { doc_id: docId, slug: A, event: "open", page: 1, max_page: 2, seconds: 3, session_id: "s2", at: il_y_a(30) },
      // Session absente : l'entonnoir doit retomber sur le slug, des deux côtés.
      { doc_id: docId, slug: A, event: "page", page: 2, max_page: 2, seconds: 5, session_id: null, at: il_y_a(20) },
      // Chaîne VIDE : ni `if (v.session_id)` ni `coalesce(...) <> ''` ne doivent la compter.
      { doc_id: docId, slug: B, event: "open", page: 1, max_page: 1, seconds: 1, session_id: "", at: il_y_a(40) },
      // Page zéro : hors entonnoir, mais la ligne existe et compte comme ouverture.
      { doc_id: docId, slug: B, event: "open", page: 0, max_page: 0, seconds: 0, session_id: "s3", at: il_y_a(5) },
      // ⚠️ ARRIVÉE DANS LE DÉSORDRE : « dernière activité » se calcule, elle ne se déduit pas du tri.
      { doc_id: docId, slug: B, event: "page", page: 4, max_page: 4, seconds: 7, session_id: "s3", at: il_y_a(120) },
      // Un autre document : la vue d'ensemble ne doit pas les mélanger.
      { doc_id: autreDoc, slug: C, event: "open", page: 9, max_page: 9, seconds: 2, session_id: "s9", at: il_y_a(15) },
    ];
    await contexte.db.request("commercial_doc_views", { method: "POST", headers: { Prefer: "return=minimal" }, body: lignes });

    await contexte.db.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { doc_id: docId, slug: A, file_url: "file:///x.pdf", idem_key: "stats:" + docId + ":a" },
      { doc_id: docId, slug: B, file_url: "file:///x.pdf", idem_key: "stats:" + docId + ":b" },
      // Un lien SANS aucune vue : les deux chemins doivent le rendre à zéro, pas l'omettre.
      { doc_id: docId, slug: Z, file_url: "file:///x.pdf", idem_key: "stats:" + docId + ":z" },
    ] });

    await contexte.db.request("commercial_doc_internal_sessions", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      // MÊME personne, deux casses : une seule lectrice interne des deux côtés.
      { session_id: "i1", doc_id: docId, user_email: "Equipe@Exemple.test", last_at: il_y_a(60) },
      { session_id: "i2", doc_id: docId, user_email: "equipe@exemple.test", last_at: il_y_a(11) },
      { session_id: "i3", doc_id: docId, user_email: null, last_at: il_y_a(9) },
    ] });
  });

  /** Rejoue l'appel en refusant les fonctions d'agrégation — c'est-à-dire sur un hôte sans la 0022. */
  async function sansLa0022(faire) {
    const vraie = contexte.db.request.bind(contexte.db);
    contexte.db.request = async (chemin, o) => {
      if (String(chemin).startsWith("rpc/player_stats")) {
        const e = new Error("Could not find the function (PGRST202)");
        e.statusCode = 404; e.details = { code: "PGRST202" };
        throw e;
      }
      return vraie(chemin, o);
    };
    try { return await faire(); } finally { contexte.db.request = vraie; }
  }

  it("⚠️ `listSharesForDoc` : le SQL et le JavaScript rendent EXACTEMENT la même chose", async () => {
    const enBase = await shares.listSharesForDoc(docId);
    const enMemoire = await sansLa0022(() => shares.listSharesForDoc(docId));

    // Anti-vacuité : deux réponses vides seraient parfaitement égales et parfaitement inutiles.
    expect(enBase.shares.length, "aucun lien : le banc ne compare rien").toBe(3);
    expect(enBase.total.opens, "aucune ouverture : le banc ne compare rien").toBeGreaterThan(0);
    expect(enBase.funnel.length, "entonnoir vide : le banc ne compare rien").toBeGreaterThan(0);

    expect(enBase).toEqual(enMemoire);
  });

  it("⚠️ `overview` : idem, et les documents ne se mélangent pas", async () => {
    const enBase = await shares.overview();
    const enMemoire = await sansLa0022(() => shares.overview());

    expect(enBase[docId], "le document semé est absent : le banc ne compare rien").toBeTruthy();
    expect(enBase[docId].opens).toBeGreaterThan(0);
    expect(enBase[docId].internalReaders, "deux casses d'un même e-mail font UNE lectrice").toBe(1);
    expect(enBase[autreDoc].opens, "le second document a sa propre ligne").toBe(1);

    expect(enBase[docId]).toEqual(enMemoire[docId]);
    expect(enBase[autreDoc]).toEqual(enMemoire[autreDoc]);
  });

  // ⚠️ LE BORNAGE DE LECTURE NE PEUT PLUS ÊTRE SEMÉ — ET C'EST UNE BONNE NOUVELLE QUI CRÉE UN TROU.
  // Depuis la migration 0020, la base REFUSE une page hors plage : impossible d'insérer ici la
  // ligne héritée qui déclenchait le DoS analytique. Le désaccord entre les deux rebornages ne se
  // verrait donc jamais par les lignes. On confronte la fonction SQL au JavaScript DIRECTEMENT,
  // sur les valeurs qu'une base d'avant la 0020 peut encore porter.
  it("⚠️ `player_page_lue` reborne EXACTEMENT comme `pageLue` — y compris hors plage", async () => {
    const cas = [[null, null], [0, 0], [3, 5], [5, 3], [-1, -7], [null, 4], [2147483647, 1], [1, 2147483647], [10000, 10001]];
    for (const [page, maxPage] of cas) {
      const [{ borne }] = await contexte.db.request("rpc/player_page_lue", {
        method: "POST", body: { p_page: page, p_max_page: maxPage },
      }).then((r) => (Array.isArray(r) ? r.map((v) => ({ borne: v })) : [{ borne: r }]));
      const attendu = Math.min(Math.max(0, Number(page) || 0, Number(maxPage) || 0), 10000);
      expect(Number(borne), `player_page_lue(${page}, ${maxPage})`).toBe(attendu);
    }
  });
});
