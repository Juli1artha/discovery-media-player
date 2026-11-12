// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE MODE D'AFFICHAGE D'UNE SESSION (#617, migration 0029) — ce qu'on garde d'un objet venu du navigateur, et
// quand on l'écrit.
//
// ⚠️ LES DEUX RISQUES : écrire ce qu'on ne devrait pas garder (une chaîne libre, un compteur démesuré, une clé
// inventée), et PERDRE LA SESSION en écrivant une colonne que la base n'a pas encore — PostgREST refuse alors toute
// la ligne. Dimensions VARIÉES : la forme de l'objet, la présence de la colonne (sonde du schéma), les deux tables.

const { bornerAffichage, MAX_COMPTEUR } = require("../affichage.js");

// La sonde du schéma, remplacée AVANT que shares.js la charge : `colonne` dit si la 0029 est appliquée.
let colonne = true;
const ID_SCHEMA = require.resolve("../schema.js");
const vraiSchema = require("../schema.js");
require.cache[ID_SCHEMA] = { id: ID_SCHEMA, filename: ID_SCHEMA, loaded: true,
  exports: { ...vraiSchema, attendue: async (nom) => (nom === "affichageSessions" ? colonne : true) } };
const shares = require("../shares.js");

let ecrites = [];
shares.init({ db: { async request(chemin, opts) { ecrites.push({ chemin, corps: opts && opts.body }); return []; }, async selectAll() { return []; } } });

const BON = { gabarit: "lecture", ajustement: "page", format: "paysage", une_page: false, gestes: { clavier: 3, recherche: 1, sommaire: 2 } };

describe("bornerAffichage — ce qu'on garde", () => {
  it("un objet bien formé passe tel quel", () => {
    expect(bornerAffichage(BON)).toEqual(BON);
  });
  it("les valeurs hors liste, les clés inconnues, les chaînes libres disparaissent", () => {
    expect(bornerAffichage({ gabarit: "lecture", ajustement: "zoom-200", format: "<script>", texte: "chauffage", une_page: "oui" }))
      .toEqual({ gabarit: "lecture" });
  });
  it("les compteurs : entiers, tronqués, plafonnés à 9 999 ; négatifs, NaN et clés inconnues écartés", () => {
    expect(bornerAffichage({ gabarit: "ancien", gestes: { clavier: 2.9, zoom: 1e9, fleches: -1, rotation: "abc", inventee: 4 } }))
      .toEqual({ gabarit: "ancien", gestes: { clavier: 2, zoom: MAX_COMPTEUR } });
  });
  it("un compteur hérité n'est pas un geste", () => {
    const g = Object.create({ clavier: 7 });
    expect(bornerAffichage({ gabarit: "lecture", gestes: g })).toEqual({ gabarit: "lecture" });
  });
  it("sans gabarit, rien : on ne garde pas une moitié de mesure", () => {
    for (const rien of [null, undefined, "lecture", 3, [], {}, { ajustement: "page" }, { gabarit: "autre" }]) {
      expect(bornerAffichage(rien)).toBeNull();
    }
  });
});

const p = { sessionId: "sess-1", numPages: 12, maxPage: 4, totalSeconds: 30, pagesTime: { 1: 10 }, modeAffichage: BON };
const lien = { slug: "abc", doc_id: "d1", recipient_email: "client@exemple.fr" };

describe("l'écriture des sessions", () => {
  it("la 0029 appliquée : la session EXTERNE porte `affichage`, borné", async () => {
    colonne = true; ecrites = [];
    await shares.upsertSession(lien, { ...p, modeAffichage: { ...BON, texte: "x" } }, { ua: "" });
    expect(ecrites).toHaveLength(1);
    expect(ecrites[0].chemin).toMatch(/^commercial_doc_sessions/);
    expect(ecrites[0].corps[0].affichage).toEqual(BON);
  });
  it("la 0029 appliquée : la session INTERNE aussi", async () => {
    colonne = true; ecrites = [];
    await shares.upsertInternalSession({ ...p, docId: "d1", userEmail: "membre@exemple.fr", userName: "M" }, { ua: "" });
    expect(ecrites[0].chemin).toMatch(/^commercial_doc_internal_sessions/);
    expect(ecrites[0].corps[0].affichage).toEqual(BON);
  });
  it("⚠️ la 0029 absente : la session s'écrit comme avant, SANS la colonne (sinon PostgREST refuserait toute la ligne)", async () => {
    colonne = false; ecrites = [];
    await shares.upsertSession(lien, p, { ua: "" });
    await shares.upsertInternalSession({ ...p, docId: "d1", userEmail: "membre@exemple.fr" }, { ua: "" });
    expect(ecrites).toHaveLength(2);
    for (const e of ecrites) {
      expect(e.corps[0]).not.toHaveProperty("affichage");
      expect(e.corps[0].max_page).toBe(4);
    }
  });
  it("un `affichage` forgé ou absent : la session s'écrit sans lui", async () => {
    colonne = true; ecrites = [];
    await shares.upsertSession(lien, { ...p, modeAffichage: { gabarit: "pirate" } }, { ua: "" });
    await shares.upsertSession(lien, { ...p, modeAffichage: undefined }, { ua: "" });
    for (const e of ecrites) expect(e.corps[0]).not.toHaveProperty("affichage");
  });
});

describe("la migration et le schéma s'accordent", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migration = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/0029-affichage-des-sessions.sql"), "utf8");
  const init = fs.readFileSync(path.join(__dirname, "../../supabase/init.sql"), "utf8");
  it("la 0029 ajoute `affichage jsonb` aux deux tables, rejouable", () => {
    for (const t of ["commercial_doc_sessions", "commercial_doc_internal_sessions"]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${t}\\s+add column if not exists affichage jsonb;`));
      expect(init).toMatch(new RegExp(`alter table public\\.${t}\\s+add column if not exists affichage jsonb;`));
    }
  });
  it("l'attente déclarée nomme le bon fichier", () => {
    expect(vraiSchema.ATTENDUES.affichageSessions).toMatchObject({ table: "commercial_doc_sessions", colonne: "affichage", migration: "0029-affichage-des-sessions.sql" });
  });
});
