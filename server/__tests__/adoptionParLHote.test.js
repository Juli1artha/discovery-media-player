// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'HÔTE DÉMARRE CÔTÉ SERVEUR, ET LA PAGE NE POUVAIT PAS REPRENDRE.
//
// `present-start` accepte la session du membre : appelé depuis le serveur de l'hôte, il crée une
// présentation qui a un propriétaire, et rend son jeton de contrôle. Mais la page du présentateur ne
// savait reprendre que par `present-reclaim`, qui exige le JWT du membre — introuvable quand
// l'application vit sur une autre origine que le player (`app.` et `doc.`, cf. session-cles.js).
// Le jeton rendu par `present-start` n'avait aucun chemin pour entrer dans l'iframe.
//
// Demandé par un hôte (26/10) qui mène ses rendez-vous en présentation : le BD démarre depuis
// l'application, et l'hôte doit savoir à quel rendez-vous la présentation appartient.
//
// ⚠️ CE QUE CE FICHIER TIENT, EN PLUS DE « ÇA MARCHE ». Un jeton RÉUTILISÉ — rechargement de
// l'iframe, changement de document — arrive sur une ligne dont `write_seq` est déjà avancé. Le
// navigateur, lui, repart de zéro. Sans le rang rendu ici, chaque page tournée après l'adoption
// était déclarée périmée et refusée EN SILENCE : le banc `adoptionDansLaPage` le montre côté page,
// celui-ci tient la moitié serveur — le rang rendu est celui de la base.

const crypto = require("node:crypto");
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");

const CONTROL = "jeton-confie-par-l-hote-0123";
const LIGNE = {
  slug: "Ab3-_xYz9012", control_hash: sha(CONTROL), owner_email: "bd@ex.fr",
  active: true, current_page: 7, write_seq: 41, view_rotation: 90, last_seen: new Date().toISOString(),
};

const presentations = require("../presentations.js");

/**
 * Une base en mémoire qui MODÉLISE LA CONDITION du PATCH, pas seulement le succès : PostgREST rend
 * les lignes touchées, zéro ligne = refus. `entreDeux` s'exécute entre la lecture et l'écriture —
 * c'est là que vit la course qu'on veut voir fermée.
 */
function base(ligne, { entreDeux } = {}) {
  const etat = ligne ? { ...ligne } : null;
  const ecritures = [];
  presentations.init({
    db: { async request(chemin, o) {
      if (o && o.method === "PATCH") {
        if (entreDeux) { entreDeux(etat); entreDeux = null; }
        const cond = String(chemin).split("&").slice(1);
        const tient = etat && cond.every((c) => {
          const [champ, valeur] = c.split("=");
          if (champ === "control_hash") return valeur === "eq." + String(etat.control_hash || "");
          return true;
        });
        if (!tient) return [];
        ecritures.push({ chemin, corps: o.body });
        Object.assign(etat, o.body);
        return [{ ...etat }];
      }
      return etat ? [{ ...etat }] : [];
    } },
    limits: { async allow() { return true; } }, errors: { capture() {} },
  });
  return { etat, ecritures };
}

describe("adopter une présentation par son jeton de contrôle", () => {
  it("rend la page, l'orientation et le RANG atteints par la présentation", async () => {
    base(LIGNE);
    const r = await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(r.ok).toBe(true);
    expect(r.page, "la page adoptée saute là où l'audience est déjà").toBe(7);
    expect(r.rotation, "et dans l'orientation qu'elle voit").toBe(90);
    expect(r.seq, "sans le rang, la page repartirait de 1 sous un write_seq de 41 : refus muets").toBe(41);
  });

  it("ne régénère PAS le jeton — l'hôte qui le détient doit pouvoir le reconfier après un rechargement", async () => {
    const b = base(LIGNE);
    await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(b.etat.control_hash, "un jeton neuf rendrait celui de l'hôte inutilisable").toBe(sha(CONTROL));
    expect(b.ecritures.every((e) => !("control_hash" in e.corps))).toBe(true);
  });

  it("le jeton est DANS la condition de l'écriture, pas seulement dans la vérification", async () => {
    const b = base(LIGNE);
    await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(b.ecritures).toHaveLength(1);
    expect(b.ecritures[0].chemin).toContain(`control_hash=eq.${sha(CONTROL)}`);
  });

  // ⚠️ La péremption ne révoque pas le jeton (cf. `CLOTURE`). Une présentation démarrée côté serveur
  // puis adoptée plus de trois minutes après — le temps d'un appel téléphonique — doit revenir en
  // ligne, sinon le client qui ouvre /present/<slug> voit « terminée » jusqu'à la première page tournée.
  it("une présentation PÉRIMÉE (jeton intact) revient en ligne", async () => {
    const b = base({ ...LIGNE, active: false });
    const r = await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(r.ok).toBe(true);
    expect(b.etat.active, "le détenteur du jeton est revenu").toBe(true);
  });

  it("une présentation TERMINÉE (jeton effacé) ne se rouvre pas", async () => {
    const b = base({ ...LIGNE, active: false, control_hash: null });
    const r = await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(r).toEqual({ ok: false, status: 403 });
    expect(b.ecritures, "une fin décidée est une décision").toHaveLength(0);
  });

  it("un jeton faux est refusé, et rien n'est écrit", async () => {
    const b = base(LIGNE);
    const r = await presentations.adoptPresentation(LIGNE.slug, "un-autre-jeton-quelconque");
    expect(r).toEqual({ ok: false, status: 403 });
    expect(b.ecritures).toHaveLength(0);
  });

  it("un slug inconnu répond 404, un appel incomplet 400", async () => {
    base(null);
    expect(await presentations.adoptPresentation(LIGNE.slug, CONTROL)).toEqual({ ok: false, status: 404 });
    expect(await presentations.adoptPresentation("", CONTROL)).toEqual({ ok: false, status: 400 });
    expect(await presentations.adoptPresentation(LIGNE.slug, "")).toEqual({ ok: false, status: 400 });
  });

  // Entre la lecture et l'écriture, une reprise ailleurs a régénéré le jeton (ou une fin l'a effacé).
  it("un jeton remplacé entre la lecture et l'écriture rend 409, sans rouvrir", async () => {
    const b = base({ ...LIGNE, active: false }, { entreDeux: (e) => { e.control_hash = sha("jeton-de-la-reprise"); } });
    const r = await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(r).toEqual({ ok: false, status: 409 });
    expect(b.etat.active, "l'adoption perdante ne remet rien en ligne").toBe(false);
  });

  it("chez un hôte sans les colonnes migrées, rang et orientation valent zéro", async () => {
    const { write_seq: _r, view_rotation: _v, ...sansMigration } = LIGNE;
    base(sansMigration);
    const r = await presentations.adoptPresentation(LIGNE.slug, CONTROL);
    expect(r).toMatchObject({ ok: true, seq: 0, rotation: 0 });
  });

  it("une orientation hors des quatre valeurs est ramenée à zéro, comme à la reprise", async () => {
    base({ ...LIGNE, view_rotation: 45 });
    expect((await presentations.adoptPresentation(LIGNE.slug, CONTROL)).rotation).toBe(0);
  });
});

// ── La route : même autorité que `present-touch`, le jeton, sans session ──────────────────────────
describe("la route « present-adopt »", () => {
  const ID = require.resolve("../presentations.js");
  const vraies = require("../presentations.js");
  let recu = null;
  require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
    ...vraies,
    adoptPresentation: async (slug, control) => { recu = { slug, control }; return { ok: true, page: 3, rotation: 0, seq: 5 }; },
  } };
  const ROUTES_ID = require.resolve("../routes-direct.js");
  delete require.cache[ROUTES_ID];
  const HANDLER_ID = require.resolve("../handler.js");
  delete require.cache[HANDLER_ID];
  const player = require("../handler.js");
  afterAll(() => { require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: vraies }; delete require.cache[ROUTES_ID]; delete require.cache[HANDLER_ID]; });

  function contexte() {
    return {
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } },
      mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture() {} },
      legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
    };
  }

  async function poster(corps) {
    recu = null;
    player.init(contexte());
    const res = { statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body: corps }, res);
    return { statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
  }

  it("répond sans session, et transmet le jeton à l'autorisation", async () => {
    const r = await poster({ action: "present-adopt", slug: LIGNE.slug, control: CONTROL });
    expect(r.statut, "une page encadrée sur une autre origine n'a pas de session à présenter").toBe(200);
    expect(r.corps).toMatchObject({ ok: true, page: 3, seq: 5 });
    expect(recu).toEqual({ slug: LIGNE.slug, control: CONTROL });
  });
});
