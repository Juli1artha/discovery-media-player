// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE COMPTE EXACT DU CONTEXTE AUTONOME, ÉPROUVÉ SUR SON PROPRE CODE.
//
// ⚠️ POURQUOI CE BANC EXISTE À CÔTÉ DE CELUI DE LA VRAIE BASE. `base/vraiPostgrest.test.js` montre
// que le compte est JUSTE devant un vrai serveur — c'est l'essentiel, et rien d'autre ne peut le
// montrer. Mais deux formes de réponse y sont INATTEIGNABLES : notre `count` demande toujours
// `count=exact`, donc ce serveur ne rendra jamais « je n'ai pas compté » (`…/*`), ni un en-tête
// absent. Or ce sont précisément les cas où le contrat interdit de rendre zéro.
//
// ⚠️ ET ON N'ÉPROUVE PAS UNE COPIE. Une première rédaction recopiait l'expression régulière dans le
// banc : elle aurait été verte pendant que le code divergeait — la vacuité que ce dépôt refuse
// partout. On pose donc un `fetch` et on fait passer le VRAI chemin, celui de la production.

const OK = (entetes) => async () => ({
  ok: true, status: 200,
  headers: { get: (n) => (n.toLowerCase() === "content-range" ? entetes : null) },
  text: async () => "",
});

describe("le compte exact du contexte autonome", () => {
  const vraiFetch = globalThis.fetch;
  let db;

  beforeEach(() => {
    db = require("../../context/standalone.js").createStandaloneContext({
      SUPABASE_URL: "https://base.exemple.test",
      SUPABASE_SERVICE_ROLE_KEY: "cle-de-banc",
    }).db;
  });
  afterEach(() => { globalThis.fetch = vraiFetch; });

  it("lit le total après la barre du `Content-Range`", async () => {
    globalThis.fetch = OK("0-0/1651");
    expect(await db.count("t?select=id")).toBe(1651);
  });

  // ⚠️ LES TROIS FORMES QUI NE DISENT PAS DE COMPTE. Zéro est la réponse qui autorise à supprimer
  // une colonne : le fabriquer depuis une réponse qui n'a pas compté serait le pire mensonge que
  // cette capacité puisse faire, et le contrat l'écrit noir sur blanc.
  it.each([
    ["PostgREST n'a pas compté", "0-0/*"],
    ["aucune ligne et aucun compte", "*/*"],
    ["en-tête vide", ""],
    ["en-tête absent", null],
  ])("⚠️ %s ⇒ `null`, jamais zéro", async (_, entete) => {
    globalThis.fetch = OK(entete);
    expect(await db.count("t?select=id")).toBe(null);
  });

  it("zéro ligne comptées se lit bien zéro — un compte, lui, se croit", async () => {
    globalThis.fetch = OK("*/0");
    expect(await db.count("t?select=id")).toBe(0);
  });

  // ⚠️ CE QU'IL DEMANDE AU SERVEUR EST LA MOITIÉ DU CONTRAT. Sans `count=exact` PostgREST rend
  // `…/*` et le compte n'existe pas ; sans `Range: 0-0` il transporterait des lignes, ce que cette
  // voie existe justement pour éviter.
  it("⚠️ demande `count=exact` et ne transporte aucune ligne", async () => {
    let vu = null;
    globalThis.fetch = async (url, opts) => { vu = { url, opts }; return OK("0-0/3")(); };
    await db.count("t?select=id&x=eq.1");
    expect(vu.opts.headers.Prefer, "sans lui, le serveur ne compte pas").toBe("count=exact");
    expect(vu.opts.headers.Range, "sans lui, il rendrait des lignes").toBe("0-0");
    expect(vu.opts.method).toBe("GET");
    expect(String(vu.url)).toContain("/rest/v1/t?select=id&x=eq.1");
  });

  // ⚠️ UN REJET REMONTE ANALYSÉ, parce que l'appelant y lit le `42703` d'une colonne supprimée —
  // un état CONNU qui vaut zéro — et qu'il ne peut le faire que si le corps a été lu.
  it("⚠️ un rejet remonte avec son statut et son corps analysé", async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 400,
      headers: { get: () => null },
      text: async () => JSON.stringify({ code: "42703", message: "column does not exist" }),
    });
    let refus = null;
    try { await db.count("t?select=absente"); } catch (e) { refus = e; }
    expect(refus, "un compte a été rendu là où la requête est invalide").toBeTruthy();
    expect(refus.statusCode).toBe(400);
    expect(refus.details.code, "le corps analysé porte le code PostgreSQL").toBe("42703");
  });
});
