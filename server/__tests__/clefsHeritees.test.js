// LES AGRÉGATEURS ÉTAIENT DES OBJETS INDEXÉS PAR DES DONNÉES DU DEHORS.
//
// `byDoc`, `intByDoc`, `byUser`, `sessMax`, `nameBySlug`, `msgByKey` : des `{}` dont les clés sont
// des identifiants de document, des e-mails, des sessions. Une clé héritée y a une sémantique
// spéciale, et la forme `X[k] = X[k] || {…}` suffit :
//
//   `byDoc["__proto__"]` ne rend pas `undefined`, il rend `Object.prototype` — qui est VRAI. Le
//   `|| {…}` ne se déclenche donc pas, `a` DEVIENT le prototype, `a.opens++` écrit
//   `Object.prototype.opens = NaN`, et `a.readers.add(…)` lève sur `undefined`.
//
// ⚠️ UNE SEULE LIGNE DE TABLE POUR EMPOISONNER UN PROCESSUS. La `TypeError` est visible ; la
// propriété laissée sur le prototype ne l'est pas, et elle survit à la requête. Sur une instance
// serverless tiède, chaque objet du processus porte ensuite un `opens`, et n'importe quel
// `if (x.opens)` ailleurs devient faux.
//
// ⚠️ Et `user_email` est atteignable SANS AUTHENTIFICATION tant que `PLAYER_INTERNAL_STRICT` n'est
// pas posé (cf. 0.1.22). Ce n'est pas théorique.
//
// Reproduit et signalé par la seconde passe d'audit (P1-2). La garde statique de 0.1.22 ne l'a pas
// vu : elle filtrait sur des NOMS DE VARIABLES, et `id`, `k`, `sid` n'y étaient pas. Une alarme,
// jamais une barrière — d'où ces tests, qui exercent le comportement.

const shares = require("../shares.js");
const presentations = require("../presentations.js");

// Les cinq clés qui ont une sémantique héritée. `__proto__` est la plus dangereuse, mais
// `constructor` et `toString` suffisent à fausser un agrégat sans rien lever.
const HERITEES = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"];

/** Ce que le prototype ne doit jamais gagner. Relevé avant/après chaque cas. */
const POLLUTION = ["opens", "readers", "maxPage", "lastAt", "users", "seconds", "email", "name", "sessions"];
const prototypeSale = () => POLLUTION.filter((k) => Object.prototype.hasOwnProperty.call(Object.prototype, k));

afterEach(() => {
  // Si un test pollue, les suivants mentiraient — on le dit tout de suite, et on nettoie.
  const sales = prototypeSale();
  for (const k of sales) delete Object.prototype[k];
  expect(sales, "ce test a laissé des propriétés sur Object.prototype").toEqual([]);
});

function db(chemin, lignes) {
  return { async request(c) { return c.startsWith(chemin) ? lignes : []; },
    async selectAll(c) { return c.startsWith(chemin) ? lignes : []; } };
}

describe("l'agrégat par document survit à une clé héritée", () => {
  it.each(HERITEES)("doc_id=%s ne lève pas et ne touche pas le prototype", async (cle) => {
    shares.init({ db: db("commercial_doc_views", [
      { doc_id: cle, event: "open", session_id: "s1", page: 3, max_page: 7, at: "2026-08-15T10:00:00Z" },
    ]) });
    const r = await shares.overview();
    expect(r[cle], cle).toBeTruthy();
    expect(r[cle].opens, "la ligne doit être comptée, pas seulement ne pas planter").toBe(1);
  });

  // ⚠️ Le cas qui plantait ET polluait, avec la valeur exacte du rapport.
  it("doc_id=__proto__ compte la vue au lieu d'écrire sur le prototype", async () => {
    shares.init({ db: db("commercial_doc_views", [
      { doc_id: "__proto__", event: "open", session_id: "s1", page: 3, max_page: 7, at: "2026-08-15T10:00:00Z" },
    ]) });
    const r = await shares.overview();
    expect(r["__proto__"]).toMatchObject({ opens: 1, readers: 1, maxPage: 7 });
    expect(Object.prototype.opens, "c'était NaN, pour tout le processus").toBeUndefined();
  });

  // Le résultat part en JSON : une clé héritée doit y rester une clé, sur toute la chaîne.
  it("et la sortie reste sérialisable sans piéger son consommateur", async () => {
    shares.init({ db: db("commercial_doc_views", [
      { doc_id: "__proto__", event: "open", session_id: "s", page: 1, max_page: 1, at: "2026-08-15T10:00:00Z" },
    ]) });
    const relu = JSON.parse(JSON.stringify(await shares.overview()));
    expect(Object.prototype.hasOwnProperty.call(relu, "__proto__"),
      "une propriété PROPRE, pas un prototype remplacé").toBe(true);
  });
});

describe("l'agrégat interne survit à une clé héritée", () => {
  // ⚠️ Celui-ci est atteignable sans authentification : la route de session interne accepte
  // l'e-mail que le client affirme tant que PLAYER_INTERNAL_STRICT n'est pas posé.
  it.each(HERITEES)("user_email=%s ne lève pas et ne touche pas le prototype", async (cle) => {
    shares.init({ db: db("commercial_doc_internal_sessions", [
      { user_email: cle, user_name: "X", max_page: 4, total_seconds: 60, last_at: "2026-08-15T10:00:00Z" },
    ]) });
    const r = await shares.internalStatsForDoc("d1");
    expect(r.readers, cle).toBe(1);
    expect(r.users[0].opens).toBe(1);
  });
});

describe("l'entonnoir de lecture survit à une session héritée", () => {
  // `session_id` est écrit par le LECTEUR : c'est la clé la plus exposée des trois.
  it.each(HERITEES)("session_id=%s compte dans l'entonnoir", async (cle) => {
    shares.init({ db: db("commercial_doc_views", [
      { doc_id: "d1", slug: "s", event: "open", session_id: cle, page: 2, max_page: 2, at: "2026-08-15T10:00:00Z" },
    ]) });
    const r = await shares.listSharesForDoc("d1");
    expect(Array.isArray(r.funnel), cle).toBe(true);
    expect(r.funnel[0], "un lecteur a atteint la page 1").toBe(1);
  });
});

describe("le compte de messages d'une présentation survit à une clé héritée", () => {
  it.each(HERITEES)("author_email=%s est compté", async (cle) => {
    presentations.init({ db: { async request(c) {
      if (c.startsWith("doc_presentations?")) return [{ slug: "s1", doc_title: "T" }];
      if (c.startsWith("doc_presentation_attendees")) return [{ slug: "s1", attendee_key: cle, email: cle, name: "X", total_ms: 1000, pages: [1], first_seen: "a", last_seen: "b" }];
      if (c.startsWith("doc_presentation_messages")) return [{ author_email: cle, author_name: "X", body: "hi" }];
      return [];
    } } });
    const r = await presentations.presentationStats("s1");
    expect(r && r.ok, cle).toBeTruthy();
  });
});
