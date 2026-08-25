// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// PLUSIEURS PROCESSUS, UNE SEULE BASE — LE TROISIÈME POSTE DU « NON MESURÉ ».
//
// ⚠️ TROIS POSTES AVAIENT ÉTÉ RANGÉS ENSEMBLE PARCE QU'ILS SE RESSEMBLAIENT : « 1 000 spectateurs »,
// « base ralentie », « multi-processus ». L'étiquette commune — « demande de l'infrastructure » —
// était fausse pour les deux premiers : une fonction de dix lignes, puis une variable
// d'environnement. Ranger trois inconnues ensemble leur donne la difficulté de la plus dure.
//
// ⚠️ ET POUR CELUI-CI, L'ANALYSE A D'ABORD RÉDUIT LA QUESTION. Tout ce qui doit être partagé entre
// processus l'est déjà par CONSTRUCTION, et on l'a vérifié plutôt que supposé :
//
//   • le débit passe par `rpc/player_rate_limit_bump` — compteur EN BASE, pas en mémoire ;
//   • le secret des jetons de présence est relu dans l'environnement à CHAQUE signature, jamais
//     mis en cache ni engendré au démarrage — donc un jeton signé par un processus se vérifie dans
//     un autre. ⚠️ Cette propriété-là n'a PAS besoin d'une base : elle est éprouvée dans de vrais
//     processus enfants par `server/__tests__/jetonEntreProcessus.test.js`, donc à chaque
//     `npm test` plutôt qu'à la seule étape de forge qui monte un Postgres ;
//   • le verrou optimiste, l'idempotence des messages et le plafond anonyme sont des propriétés du
//     SGBD (condition d'écriture, contrainte d'unicité, verrou consultatif).
//
// Ce qui reste par processus est du CACHE (lectures mutualisées, sondes de schéma) et des MÉMOS
// (« cet hôte n'a pas 0018 / 0019 ») — dont la localité au processus est un comportement DOCUMENTÉ,
// pas une propriété à défendre : c'est exactement ce que dit `presenceFusion` dans la carte.
//
// ⚠️ RESTE LA SEULE CHOSE QU'UN SEUL PROCESSUS NE PEUT PAS MONTRER : le verrou consultatif tient-il
// quand les appelants sont dans des PROCESSUS DIFFÉRENTS ? Dans un seul processus, Node sérialise
// l'émission ; le verrou est éprouvé, mais jamais contre un vrai parallélisme système. C'est ce que
// ce fichier mesure, et rien d'autre — un banc qui prétendrait mesurer plus mentirait sur ce que
// l'analyse ci-dessus a déjà réglé.

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc multi-processus : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. " +
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

const RACINE = path.join(__dirname, "..");
const PROCESSUS = 4;
const PAR_PROCESSUS = 12;
const PLAFOND = 10;

/** Le programme que chaque enfant exécute : il tape la MÊME base, sans rien partager en mémoire. */
const ENFANT = `
const presentations = require(${JSON.stringify(path.join(RACINE, "server/presentations.js"))});
const { createStandaloneContext } = require(${JSON.stringify(path.join(RACINE, "context/standalone.js"))});
const ctx = createStandaloneContext(process.env);
require(${JSON.stringify(path.join(RACINE, "server/handler.js"))}).init(ctx);
// ATTENTION : les valeurs passent par l'ENVIRONNEMENT, pas par argv. Un slug est engendre au
// hasard et peut commencer par un tiret : passe en argument, node le lit comme une OPTION et
// refuse de demarrer (« bad option: -aeLmx1Xd3hI », constate en forge). Le banc a tourne des
// jours avant qu'un slug ne commence par un tiret — le defaut n'attendait pas une plateforme,
// il attendait une DONNEE. L'environnement n'a pas de syntaxe : aucune valeur n'y change de sens.
const { MP_SLUG: slug, MP_RANG: rang, MP_COMBIEN: combien, MP_PLAFOND: plafond } = process.env;
(async () => {
  const faits = [];
  // ⚠️ TOUS EN MÊME TEMPS DANS L'ENFANT AUSSI : sinon les quatre processus se croiseraient à peine,
  // et le verrou consultatif ne serait pas plus sollicité qu'avec un seul.
  const r = await Promise.all(Array.from({ length: Number(combien) }, (_, i) =>
    presentations.recordAttendance(slug, { key: 'p' + rang + '-' + i, name: 'V' },
      { ipHash: 'ip-partagee', anonCap: Number(plafond), hasToken: false })
      .then((x) => ({ ok: !!x.ok, statut: x.status || 200 }))
      .catch((e) => ({ ok: false, erreur: String((e && e.message) || e) }))));
  faits.push(...r);
  process.stdout.write(JSON.stringify(faits));
})();
`;

let presentations, base, contexte;

decrire("plusieurs processus, une seule base", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    process.env.PLAYER_PRESENCE_SECRET = process.env.PLAYER_PRESENCE_SECRET || "secret-de-banc-multi-processus";
    contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    presentations = require("../server/presentations.js");
    base = contexte.db;
  });

  async function nouvellePresentation() {
    return presentations.createPresentation({
      docId: "doc-" + crypto.randomBytes(4).toString("hex"),
      fileUrl: "https://exemple.test/doc.pdf", fileName: "doc.pdf",
      docTitle: "Banc MP", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
    });
  }

  const anonymes = async (slug) => (await base.request(
    `doc_presentation_attendees?slug=eq.${encodeURIComponent(slug)}&is_member=is.false&is_presenter=is.false&select=attendee_key`)).length;

  it(`le plafond anonyme tient à travers ${PROCESSUS} PROCESSUS qui frappent ensemble`, async () => {
    const { slug } = await nouvellePresentation();
    const lancer = (rang) => new Promise((resoudre) => {
      execFile(process.execPath, ["-e", ENFANT],
        { env: { ...process.env, MP_SLUG: slug, MP_RANG: String(rang), MP_COMBIEN: String(PAR_PROCESSUS), MP_PLAFOND: String(PLAFOND) },
          encoding: "utf8", maxBuffer: 4 << 20 },
        (err, sortie) => resoudre({ err: err && String(err.message), sortie: String(sortie || "") }));
    });

    // ⚠️ TOUS LANCÉS D'UN COUP : lancés l'un après l'autre, ils ne se croiseraient pas et le verrou
    // consultatif ne serait pas plus sollicité qu'avec un processus unique — le banc mesurerait
    // alors la séquence en croyant mesurer le parallélisme.
    const rendus = await Promise.all(Array.from({ length: PROCESSUS }, (_, i) => lancer(i)));

    // ⚠️ D'ABORD : LES ENFANTS ONT-ILS TOURNÉ ? Sans ces lignes, quatre processus morts au démarrage
    // rendraient « 0 création », c'est-à-dire un plafond respecté — le vert d'un banc qui n'a rien
    // fait est indiscernable du vert d'un banc qui a tenu.
    const pannes = rendus.filter((r) => r.err).map((r) => r.err);
    expect(pannes, "un processus enfant n'a pas abouti : le banc ne mesure rien").toEqual([]);
    const faits = rendus.flatMap((r) => JSON.parse(r.sortie));
    expect(faits.length, "chaque enfant doit avoir émis ses appels").toBe(PROCESSUS * PAR_PROCESSUS);
    expect(faits.filter((f) => f.erreur), "aucun appel ne doit lever").toEqual([]);

    // ⚠️ LE PLAFOND A-T-IL SEULEMENT MORDU ? Un banc où personne n'est refusé ne prouve pas que le
    // plafond tient : il prouve qu'on ne l'a pas atteint. On exige donc des refus AVANT de se
    // réjouir du compte — c'est la même exigence que « la charge a-t-elle eu lieu ».
    const refuses = faits.filter((f) => !f.ok && f.statut === 429);
    expect(refuses.length, `${PROCESSUS * PAR_PROCESSUS} tentatives pour un plafond de ${PLAFOND} : des refus sont attendus`)
      .toBeGreaterThan(0);

    // Le verdict : le SGBD a tranché une fois pour tous les processus.
    const crees = await anonymes(slug);
    expect(crees, `plafond ${PLAFOND} franchi depuis ${PROCESSUS} processus : le verrou consultatif ne traverse pas les processus`)
      .toBe(PLAFOND);
  });
});
