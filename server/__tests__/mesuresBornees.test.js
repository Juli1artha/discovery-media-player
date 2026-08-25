// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE MESURE VENUE DU DEHORS EST BORNÉE — À L'ÉCRITURE ET À LA LECTURE.
//
// ⚠️ LE DÉFAUT (audit CODEX 5.6, 25/08 — P1, reproduit avant d'être corrigé). Un visiteur muni d'un
// lien valide postait `{"event":"page","page":2147483647,"maxPage":2147483647}`. `logView` ne
// vérifiait que la FINITUDE du nombre, `integer` PostgreSQL acceptait la valeur, et le funnel de la
// vue d'ensemble bouclait ensuite de 1 à 2 147 483 647.
//
// Mesuré sur cinq échelles avant correction : 5 000 000 → 561 ms et cinq millions d'entrées, donc
// par extrapolation linéaire environ quatre minutes de CPU et 17 à 40 Go à la valeur maximale. Le
// processus meurt avant la fin. UNE ligne suffisait, elle restait, et le déclenchement avait lieu à
// l'ouverture des statistiques — c'est-à-dire chez quelqu'un d'AUTORISÉ, plus tard. DoS stocké.
//
// ⚠️ LES BORNES EXISTAIENT DÉJÀ, DEUX CENT SOIXANTE-QUINZE LIGNES PLUS BAS. Elles avaient été
// posées pour les deux chemins de SESSION, contre exactement cette classe de défaut ; `logView` est
// le troisième chemin, oublié en fermant les deux autres. Le correctif n'est donc pas « borner
// aussi ici » — c'est qu'il n'y ait plus qu'UN endroit où une mesure entre en base.
//
// ⚠️ ET ON BORNE AUSSI À LA LECTURE. Borner l'écriture protège les lignes à venir ; celles déjà
// posées restent. Une agrégation qui suppose la base propre transforme une donnée héritée en panne.

const shares = require("../shares.js");

const MAX = 2147483647;

function contexte(capture) {
  return {
    db: {
      async request(_url, opts) { if (opts && opts.body) capture.ecrit = opts.body[0]; return capture.lignes || []; },
      async selectAll() { return capture.vues || []; },
    },
    errors: { async capture() {} },
  };
}

const lien = { slug: "s", doc_id: "d", recipient_email: "a@b.c", is_test: false };

describe("ce qui entre en base", () => {
  it("⚠️ REJOUE LE 25/08 : une mesure à 2 147 483 647 est bornée avant l'écriture", async () => {
    const cap = {};
    shares.init(contexte(cap));
    await shares.logView(lien, { event: "page", page: MAX, maxPage: MAX, seconds: MAX, sessionId: "x", ua: "" });
    expect(cap.ecrit.page).toBe(10000);
    expect(cap.ecrit.max_page).toBe(10000);
    expect(cap.ecrit.seconds).toBe(86400);
  });

  it("laisse passer une mesure ordinaire sans la déformer", async () => {
    const cap = {};
    shares.init(contexte(cap));
    await shares.logView(lien, { event: "page", page: 7, maxPage: 12, seconds: 340, sessionId: "x", ua: "" });
    expect(cap.ecrit.page).toBe(7);
    expect(cap.ecrit.max_page).toBe(12);
    expect(cap.ecrit.seconds).toBe(340);
  });

  it("ramène un négatif à zéro plutôt que de l'écrire", async () => {
    const cap = {};
    shares.init(contexte(cap));
    await shares.logView(lien, { event: "page", page: -5, maxPage: -1, seconds: -900, sessionId: "x", ua: "" });
    expect(cap.ecrit.page).toBe(0);
    expect(cap.ecrit.seconds).toBe(0);
  });

  it("garde `null` pour ce qui n'est pas un nombre — une absence n'est pas un zéro", async () => {
    const cap = {};
    shares.init(contexte(cap));
    await shares.logView(lien, { event: "open", page: undefined, maxPage: "abc", seconds: null, sessionId: "x", ua: "" });
    expect(cap.ecrit.page).toBeNull();
    expect(cap.ecrit.max_page).toBeNull();
  });

  it("⚠️ le chemin de SESSION passe par la même borne — c'est le point du correctif", async () => {
    const cap = {};
    shares.init(contexte(cap));
    await shares.upsertSession(lien, { sessionId: "sess", numPages: MAX, maxPage: MAX, totalSeconds: MAX, pagesTime: {} }, { ip: "", ua: "" });
    expect(cap.ecrit.max_page).toBe(10000);
    expect(cap.ecrit.num_pages).toBe(10000);
    expect(cap.ecrit.total_seconds).toBe(86400);
  });
});

describe("ce qui sort de l'agrégation", () => {
  const avecVues = (vues) => {
    const cap = { lignes: [{ slug: "s", doc_id: "d", is_test: false, created_at: "2026-01-01", recipient_email: "a@b.c" }], vues };
    shares.init(contexte(cap));
  };
  const vue = (session, page) => ({ slug: "s", event: "page", page, max_page: page, seconds: 1, session_id: session, at: "2026-08-25" });

  it("⚠️ UNE LIGNE HISTORIQUE HORS PLAGE NE FAIT PLUS BOUCLER — la base n'est pas supposée propre", async () => {
    avecVues([vue("sess1", MAX)]);
    const t = Date.now();
    const r = await shares.listSharesForDoc("d");
    expect(r.funnel.length).toBe(10000);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("le cumul descendant rend exactement ce que rendait le balayage quadratique", async () => {
    avecVues([vue("a", 5), vue("b", 3), vue("c", 5), vue("d", 1)]);
    const r = await shares.listSharesForDoc("d");
    // 4 sessions atteignent la page 1, 3 la page 2 et 3, 2 les pages 4 et 5.
    expect(r.funnel).toEqual([4, 3, 3, 2, 2]);
  });

  it("rend un funnel vide quand personne n'a dépassé la page zéro", async () => {
    avecVues([vue("a", 0)]);
    expect((await shares.listSharesForDoc("d")).funnel).toEqual([]);
  });

  it("compte une session UNE fois, quelle que soit sa page la plus haute", async () => {
    avecVues([vue("a", 1), vue("a", 2), vue("a", 3)]);
    expect((await shares.listSharesForDoc("d")).funnel).toEqual([1, 1, 1]);
  });

  it("⚠️ ne paie plus le quadratique sur des valeurs LÉGITIMES — 10 000 pages × 400 sessions", async () => {
    const vues = Array.from({ length: 400 }, (_, i) => vue("s" + i, 10000));
    avecVues(vues);
    const t = Date.now();
    const r = await shares.listSharesForDoc("d");
    expect(r.funnel.length).toBe(10000);
    expect(r.funnel[0]).toBe(400);
    // L'ancienne écriture faisait ici quatre millions de comparaisons.
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
