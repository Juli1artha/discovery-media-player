// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ADMINISTRATION DES LIENS — LA SÉPARATION DES PORTÉES N'ÉTAIT PAS ÉPROUVÉE.
//
// ⚠️ La propriété la plus chère de `routes-liens.js` est écrite dans son commentaire : « un
// commercial verrait à qui d'autre le document a été envoyé — les prospects de ses collègues ».
// `docshare.list` pose DEUX questions à l'hôte : « peut-il lister ? » puis « peut-il TOUT
// lister ? » — et sans la seconde, la liste est filtrée sur SON email. Aucun banc ne vérifiait
// que la portée « mine » filtre réellement, ni que l'acte (`create`, `revoke`…) est transmis à
// l'hôte TEL QUEL — c'est ce qui lui permet de séparer l'envoi (acte commercial) de
// l'administration. Et la porte d'entrée elle-même : sans jeton vérifié, 401 ; refus de l'hôte,
// 403 — le player ne décide jamais qui a le droit de diffuser.

const ID_SHARES = require.resolve("../shares.js");
const vraisShares = require("../shares.js");
let stubs = {};
const enregistrees = [];
const fabrique = (nom, defaut) => async (...args) => {
  enregistrees.push({ nom, args });
  if (stubs[nom]) return stubs[nom](...args);
  return defaut;
};
require.cache[ID_SHARES] = {
  id: ID_SHARES, filename: ID_SHARES, loaded: true,
  exports: {
    ...vraisShares,
    createShare: fabrique("createShare", { slug: "lien-neuf" }),
    revokeShare: fabrique("revokeShare", { ok: true }),
    setShareAuth: fabrique("setShareAuth", { ok: true }),
    listSharesForDoc: fabrique("listSharesForDoc", { shares: [{ slug: "l1" }] }),
    listSessionsForDoc: fabrique("listSessionsForDoc", []),
    internalStatsForDoc: fabrique("internalStatsForDoc", null),
    overview: fabrique("overview", {}),
    cleIdempotence: (...args) => "idem-" + args.flat().join("-"),
  },
};

const routes = require("../routes-liens.js");

function fauxRes() {
  return {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    end(s) { this.corps = s ? JSON.parse(s) : null; },
  };
}
const req = { socket: { remoteAddress: "203.0.113.9" }, headers: {} };

let jetonVerifie = null;
let droits = async () => false;
function contexte(surcharges = {}) {
  const demandesDb = [];
  const ctx = {
    demandesDb,
    identity: {
      verifyToken: async () => jetonVerifie,
      canManageShares: (u, acte) => droits(u, acte),
      isTrustedHostCall: () => false,
      isAdmin: () => false,
    },
    db: { request: async (chemin, options) => { demandesDb.push({ chemin, options }); return stubs.db ? stubs.db(chemin, options) : []; } },
    limits: { allow: async () => true },
    errors: { capture: async () => {} },
    ...surcharges,
  };
  routes.init(ctx);
  require("../appelant.js").init(ctx);
  return ctx;
}

const agir = async (body) => { const res = fauxRes(); await routes.traiter(req, res, body, ""); return res; };

beforeEach(() => {
  stubs = {}; enregistrees.length = 0;
  jetonVerifie = { email: "commercial@hote.example", app_metadata: {} };
  droits = async () => true;
});

describe("la porte : le player vérifie le jeton, l'hôte accorde le droit", () => {
  it("sans jeton vérifié : 401 — et rien n'est demandé à l'hôte", async () => {
    contexte();
    jetonVerifie = null;
    const actes = []; droits = async (_u, acte) => { actes.push(acte); return true; };
    expect((await agir({ action: "docshare.create", docId: "d1" })).statusCode).toBe(401);
    expect(actes).toHaveLength(0);
  });

  it("le refus de l'hôte vaut 403, et l'ACTE lui est transmis tel quel — l'envoi et l'administration se séparent chez lui", async () => {
    contexte();
    const actes = []; droits = async (_u, acte) => { actes.push(acte); return false; };
    const res = await agir({ action: "docshare.revoke", slug: "l1" });
    expect(res.statusCode).toBe(403);
    expect(actes).toEqual(["revoke"]);
    expect(enregistrees.filter((a) => a.nom === "revokeShare")).toHaveLength(0);
  });
});

describe("docshare.list : la portée protège les prospects des collègues", () => {
  it("sans le droit list.all, la liste est filtrée sur l'email du demandeur — scope « mine »", async () => {
    contexte();
    droits = async (_u, acte) => acte !== "list.all";
    const res = await agir({ action: "docshare.list", docId: "d1" });
    expect(res.corps.scope).toBe("mine");
    expect(enregistrees.find((a) => a.nom === "listSharesForDoc").args).toEqual(["d1", "commercial@hote.example"]);
  });

  it("avec list.all, la liste est complète — scope « all », filtre levé", async () => {
    contexte();
    const res = await agir({ action: "docshare.list", docId: "d1" });
    expect(res.corps.scope).toBe("all");
    expect(enregistrees.find((a) => a.nom === "listSharesForDoc").args).toEqual(["d1", null]);
  });
});

// ⚠️ `docshare.sessions` N'AVAIT AUCUNE PORTÉE, et c'était une porte large à côté de la stricte.
// Les sessions portent `recipient_email` ET `ip` : tout membre autorisé à appeler cette action
// obtenait, pour n'importe quel document, l'adresse et l'IP des prospects de ses collègues — ce que
// la distinction `list` / `list.all` juste au-dessus empêche depuis qu'un hôte l'a demandée. Deux
// appels suffisaient à contourner le premier par le second.
describe("docshare.sessions : la même portée que la liste, pour la même raison", () => {
  it("sans le droit list.all, les sessions sont bornées à l'email du demandeur — scope « mine »", async () => {
    contexte();
    droits = async (_u, acte) => acte !== "list.all";
    const res = await agir({ action: "docshare.sessions", docId: "d1" });
    expect(res.corps.scope).toBe("mine");
    expect(enregistrees.find((a) => a.nom === "listSessionsForDoc").args)
      .toEqual(["d1", "commercial@hote.example"]);
  });

  it("avec list.all, les sessions sont complètes — scope « all », filtre levé", async () => {
    contexte();
    const res = await agir({ action: "docshare.sessions", docId: "d1" });
    expect(res.corps.scope).toBe("all");
    expect(enregistrees.find((a) => a.nom === "listSessionsForDoc").args).toEqual(["d1", null]);
  });

  it("⚠️ les deux actions demandent le MÊME élargissement — sinon l'une protégerait ce que l'autre livre", async () => {
    contexte();
    const actes = [];
    droits = async (_u, acte) => { actes.push(acte); return acte !== "list.all"; };
    await agir({ action: "docshare.list", docId: "d1" });
    const apresList = [...actes];
    actes.length = 0;
    await agir({ action: "docshare.sessions", docId: "d1" });
    // Chaque action demande d'ABORD son propre acte — l'hôte peut accorder `sessions` sans `list`,
    // c'est la distinction « acte commercial / acte d'administration ». Ce qui doit être commun,
    // c'est la SECONDE question : celle qui lève la borne.
    expect(apresList[0]).toBe("list");
    expect(actes[0]).toBe("sessions");
    expect(actes.slice(1), "l'élargissement se demande de la même façon des deux côtés")
      .toEqual(apresList.slice(1));
    expect(actes).toContain("list.all");
  });
});

describe("les actes relayés portent leurs arguments, pas des à-peu-près", () => {
  it("setauth booléanise, revoke transmet le slug, create rattache l'auteur au jeton vérifié", async () => {
    contexte();
    await agir({ action: "docshare.setauth", slug: "l1", requireAuth: 1 });
    expect(enregistrees.find((a) => a.nom === "setShareAuth").args).toEqual(["l1", true]);
    await agir({ action: "docshare.revoke", slug: "l1" });
    expect(enregistrees.find((a) => a.nom === "revokeShare").args[0]).toBe("l1");
    await agir({ action: "docshare.create", docId: "d1", fileUrl: "https://s/f.pdf", recipientEmail: "p@client" });
    // `createdBy` vient du JETON, jamais du body : l'auteur d'un lien ne se déclare pas.
    expect(enregistrees.find((a) => a.nom === "createShare").args[0].createdBy).toBe("commercial@hote.example");
  });
});

describe("docshare.test : UNE répétition par document, réutilisée et re-patchée", () => {
  it("sans lien de test existant : création flaggée is_test avec sa clé d'idempotence", async () => {
    contexte();
    stubs.db = async () => [];
    const res = await agir({ action: "docshare.test", docId: "d1", fileUrl: "https://s/f.pdf" });
    expect(res.corps.slug).toBe("lien-neuf");
    const crea = enregistrees.find((a) => a.nom === "createShare").args[0];
    expect(crea.isTest).toBe(true);
    expect(crea.idemKey).toBe("idem-repetition-d1");
  });

  it("avec un lien de test existant : il est RE-PATCHÉ (fichier et agent actuels) et son slug repart — pas de second lien", async () => {
    const ctx = contexte();
    stubs.db = async (chemin) => (chemin.includes("is_test=eq.true") ? [{ slug: "test-existant" }] : []);
    const res = await agir({ action: "docshare.test", docId: "d1", fileUrl: "https://s/v2.pdf", docTitle: "V2" });
    expect(res.corps).toEqual({ ok: true, slug: "test-existant" });
    expect(enregistrees.filter((a) => a.nom === "createShare")).toHaveLength(0);
    const patch = ctx.demandesDb.find((d) => d.options && d.options.method === "PATCH");
    expect(patch.chemin).toContain("slug=eq.test-existant");
    expect(patch.options.body.file_url).toBe("https://s/v2.pdf");
    expect(patch.options.body.revoked).toBe(false);
  });

  it("docId ou fileUrl absent : 400 — une répétition sans document n'existe pas", async () => {
    contexte();
    expect((await agir({ action: "docshare.test", docId: "d1" })).statusCode).toBe(400);
  });
});

describe("retention.run : hôte de confiance ou admin, sinon non", () => {
  it("un membre ordinaire — même authentifié — reçoit 403 : purger n'est pas diffuser", async () => {
    contexte();
    const res = await agir({ action: "retention.run" });
    expect(res.statusCode).toBe(403);
    expect(res.corps.error).toMatch(/hôte de confiance ou admin/);
  });
});
