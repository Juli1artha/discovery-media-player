// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA PRÉSENTATION EN DIRECT — SES PORTES D'ENTRÉE N'ÉTAIENT PAS ÉPROUVÉES.
//
// ⚠️ Trois propriétés vivent dans `routes-direct.js`, écrites dans ses commentaires, éprouvées
// nulle part :
//
//   1. UNE PRÉSENTATION NE DÉMARRE QUE SUR UN FICHIER DU PÉRIMÈTRE. `present-start` refuse une
//      fileUrl hors allow-list AVANT toute création — sinon le mode présentation devient un
//      moyen de faire diffuser n'importe quelle URL par l'instance.
//   2. LE BADGE SE MÉRITE, IL NE SE RÉCLAME PAS. « Présentateur » n'est accordé que si le jeton
//      de contrôle correspond au hachage stocké ; « collègue » (isMember) n'est accordé que par
//      un jeton VÉRIFIÉ — l'email prouvé remplace l'email affirmé. Le commentaire du fichier
//      raconte l'asymétrie corrigée : deux poids sur la même ligne.
//   3. UN 500 SANS TRACE A COÛTÉ TROIS JOURS. Le catch de la famille present-* CAPTURE
//      l'exception avec sa route avant de rendre 500 — c'est le correctif du « Terminer »
//      impossible chez le second hôte (23502), et il mérite de ne jamais repartir.
//
// Idiome du dossier : ./presentations remplacé AVANT le require (destructuré au chargement).

const crypto = require("node:crypto");
const ID_PRES = require.resolve("../presentations.js");
const vraiesPres = require("../presentations.js");
let stubs = {};
const enregistrees = [];
const fabrique = (nom, defaut) => async (...args) => {
  enregistrees.push({ nom, args });
  if (stubs[nom]) return stubs[nom](...args);
  return defaut;
};
require.cache[ID_PRES] = {
  id: ID_PRES, filename: ID_PRES, loaded: true,
  exports: {
    ...vraiesPres,
    createPresentation: fabrique("createPresentation", { slug: "pres-1", control: "ctrl-1" }),
    getPresentation: fabrique("getPresentation", null),
    setPage: fabrique("setPage", { ok: true }),
    endPresentation: fabrique("endPresentation", { ok: true }),
    touchPresentation: fabrique("touchPresentation", { ok: true }),
    addMessage: fabrique("addMessage", { ok: true, id: "m1" }),
    createUploadUrl: fabrique("createUploadUrl", { ok: true, url: "https://signee" }),
  },
};

const routes = require("../routes-direct.js");

function fauxRes() {
  return {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    end(s) { this.corps = s ? JSON.parse(s) : null; },
  };
}
const req = { socket: { remoteAddress: "203.0.113.9" }, headers: {} };

let jetonVerifie = null;
function contexte(surcharges = {}) {
  const captures = [];
  const ctx = {
    captures,
    storage: { isAllowedUrl: (url) => String(url).startsWith("https://storage.autorise/") },
    limits: { allow: async () => true },
    identity: {
      verifyToken: async () => jetonVerifie,
      profileOf: (u) => ({ email: (u && u.email) || "", name: (u && u.user_metadata && u.user_metadata.name) || "", avatar: "" }),
      isAdmin: () => false,
      canManageShares: async () => false,
    },
    errors: { capture: async (e, meta) => { captures.push({ message: String(e && e.message), route: meta && meta.route }); } },
    ...surcharges,
  };
  // handler.js initialise CHAQUE module ; appelant.js (profilDuJeton) a son propre init — sans
  // lui, le profil vérifié est silencieusement null et le test d'usurpation ne teste plus rien.
  routes.init(ctx);
  require("../appelant.js").init(ctx);
  return ctx;
}

const agir = async (body) => { const res = fauxRes(); await routes.traiter(req, res, body, ""); return res; };

beforeEach(() => { stubs = {}; enregistrees.length = 0; jetonVerifie = null; });

describe("present-start : le périmètre d'abord, la création ensuite", () => {
  it("une fileUrl hors allow-list est refusée en 400 AVANT toute création", async () => {
    contexte();
    const res = await agir({ action: "present-start", fileUrl: "https://ailleurs.example/doc.pdf" });
    expect(res.statusCode).toBe(400);
    expect(res.corps.error).toBe("url");
    expect(enregistrees.filter((a) => a.nom === "createPresentation")).toHaveLength(0);
  });

  it("le plafond par adresse rend 429, toujours avant la création", async () => {
    contexte({ limits: { allow: async () => false } });
    const res = await agir({ action: "present-start", fileUrl: "https://storage.autorise/doc.pdf" });
    expect(res.statusCode).toBe(429);
    expect(enregistrees.filter((a) => a.nom === "createPresentation")).toHaveLength(0);
  });

  it("sans jeton valide la présentation démarre QUAND MÊME — mais sans propriétaire (best-effort assumé)", async () => {
    contexte();
    const res = await agir({ action: "present-start", fileUrl: "https://storage.autorise/doc.pdf" });
    expect(res.corps).toEqual({ ok: true, slug: "pres-1", control: "ctrl-1" });
    expect(enregistrees.find((a) => a.nom === "createPresentation").args[0].owner).toBe(null);
  });

  it("avec un jeton vérifié, le propriétaire vient du JETON — reprise et transfert deviennent possibles", async () => {
    contexte();
    jetonVerifie = { id: "u-7", email: "paul@hote.example", user_metadata: { name: "Paul" } };
    await agir({ action: "present-start", fileUrl: "https://storage.autorise/doc.pdf", presenterName: "P. Durand" });
    const owner = enregistrees.find((a) => a.nom === "createPresentation").args[0].owner;
    expect(owner.id).toBe("u-7");
    expect(owner.email).toBe("paul@hote.example");
    expect(owner.name).toBe("P. Durand");
  });
});

describe("la famille present-* relaie les verdicts et TRACE ses 500", () => {
  it("un refus du module remonte avec SON statut, pas un 400 générique", async () => {
    contexte();
    stubs.setPage = async () => ({ ok: false, status: 409, error: "seq" });
    const res = await agir({ action: "present-page", slug: "p", control: "c", page: 2, seq: 5 });
    expect(res.statusCode).toBe(409);
  });

  it("une exception rend 500 ET laisse une trace qui nomme la route — un 500 muet a coûté trois jours", async () => {
    const ctx = contexte();
    stubs.endPresentation = async () => { throw new Error("null value in column archived_at (23502)"); };
    const res = await agir({ action: "present-end", slug: "p", control: "c" });
    expect(res.statusCode).toBe(500);
    expect(ctx.captures).toEqual([{ message: expect.stringContaining("23502"), route: "present-end" }]);
  });
});

describe("present-chat : le badge se mérite, il ne se réclame pas", () => {
  const CONTROLE = "ctrl-secret";
  const PRES = { slug: "p", control_hash: crypto.createHash("sha256").update(CONTROLE).digest("hex"), chat_locked: false };

  it("sans présentation : 404 ; sous plafond : 429", async () => {
    contexte();
    expect((await agir({ action: "present-chat", slug: "absente" })).statusCode).toBe(404);
    contexte({ limits: { allow: async () => false } });
    stubs.getPresentation = async () => PRES;
    expect((await agir({ action: "present-chat", slug: "p" })).statusCode).toBe(429);
  });

  it("« présentateur » n'est accordé que si le jeton de contrôle correspond au hachage stocké", async () => {
    contexte();
    stubs.getPresentation = async () => PRES;
    await agir({ action: "present-chat", slug: "p", control: CONTROLE, body: "bonjour" });
    await agir({ action: "present-chat", slug: "p", control: "usurpé", body: "bonjour" });
    const [vrai, faux] = enregistrees.filter((a) => a.nom === "addMessage").map((a) => a.args[1]);
    expect(vrai.isPresenter).toBe(true);
    expect(faux.isPresenter).toBe(false);
  });

  it("chat verrouillé : 423 pour l'audience, ouvert pour qui détient le contrôle", async () => {
    contexte();
    stubs.getPresentation = async () => ({ ...PRES, chat_locked: true });
    expect((await agir({ action: "present-chat", slug: "p", body: "x" })).statusCode).toBe(423);
    expect((await agir({ action: "present-chat", slug: "p", control: CONTROLE, body: "x" })).statusCode).toBe(200);
  });

  it("l'email PROUVÉ remplace l'email affirmé ; sans preuve, l'affirmation reste une affirmation", async () => {
    contexte();
    stubs.getPresentation = async () => PRES;
    jetonVerifie = { email: "vraie@hote.example", user_metadata: { name: "Vraie" } };
    await agir({ action: "present-chat", slug: "p", body: "x", email: "usurpee@ailleurs", name: "Faux Nom" });
    jetonVerifie = null;
    await agir({ action: "present-chat", slug: "p", body: "x", email: "anonyme@client", name: "Visiteur" });
    const [membre, visiteur] = enregistrees.filter((a) => a.nom === "addMessage").map((a) => a.args[1]);
    expect(membre.email).toBe("vraie@hote.example");
    expect(membre.isMember).toBe(true);
    expect(visiteur.email).toBe("anonyme@client");
    expect(visiteur.isMember).toBe(false);
  });
});

describe("present-upload-url : une pièce jointe exige une présentation vivante", () => {
  it("404 sans présentation, 429 sous plafond, relais du signeur sinon", async () => {
    contexte();
    expect((await agir({ action: "present-upload-url", slug: "absente" })).statusCode).toBe(404);
    stubs.getPresentation = async () => ({ slug: "p" });
    expect((await agir({ action: "present-upload-url", slug: "p", name: "a.pdf", type: "application/pdf" })).corps.url).toBe("https://signee");
    contexte({ limits: { allow: async () => false } });
    expect((await agir({ action: "present-upload-url", slug: "p" })).statusCode).toBe(429);
  });
});
