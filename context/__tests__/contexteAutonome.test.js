// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE CONTEXTE AUTONOME — SES REFUS ÉTAIENT ÉCRITS, AUCUN N'ÉTAIT ÉPROUVÉ.
//
// ⚠️ `context/standalone.js` est le câblage par défaut : ce qu'il ne sait pas, il le REFUSE —
// c'est sa doctrine, en tête du fichier. Or ses refus les plus importants n'avaient aucun banc :
// la dernière barrière avant un DELETE à la clé service_role (P1 du huitième audit), le message
// « Base non configurée » qui dit à l'exploitant ce qui marche encore, la distinction refus ≠
// panne d'`appelHote`, et la dégradation ANNONCÉE des compteurs de débit. Une doctrine que rien
// n'éprouve tient jusqu'au premier refactor — ce fichier la fait tenir plus longtemps.
//
// Idiome du dossier : CommonJS, globaux vitest, `global.fetch` remplacé et RESTAURÉ à chaque test
// (cf. identite.test.js). Aucun réseau réel : chaque test dit ce que le contexte fait de la réponse.

const crypto = require("node:crypto");
const { createStandaloneContext } = require("../standalone.js");

const vraiFetch = global.fetch;
let appels = [];
/** Un faux réseau qui ENREGISTRE : le test peut affirmer ce qui est parti — ou n'est PAS parti. */
function reseau(repondre) {
  appels = [];
  global.fetch = async (url, init) => {
    appels.push({ url: String(url), methode: (init && init.method) || "GET", entetes: (init && init.headers) || {}, corps: init && init.body });
    return repondre(String(url), init);
  };
}
const json = (obj, statut = 200) => ({ ok: statut < 400, status: statut, text: async () => JSON.stringify(obj), json: async () => obj });

let erreurs;
beforeEach(() => { erreurs = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { global.fetch = vraiFetch; erreurs.mockRestore(); });

const ENV_BASE = { SUPABASE_URL: "https://labase.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "cle-service" };

describe("la base absente refuse en nommant ce qui marche encore", () => {
  it("db.request sans configuration lève un message qui dit quoi configurer ET ce qui fonctionne sans", async () => {
    // Le refus nu (« undefined n'est pas une fonction » trois appels plus loin) a coûté des
    // heures de diagnostic à qui essayait le mode autonome sans base. Le message est le produit.
    const ctx = createStandaloneContext({});
    await expect(ctx.db.request("shares?select=slug")).rejects.toThrow(/Base non configurée/);
    await expect(ctx.db.request("shares?select=slug")).rejects.toThrow(/L'aperçu de documents fonctionne sans/);
  });

  it("db.request joint le CORPS de l'erreur PostgREST au statut — un « 400 » nu ne se diagnostique pas", async () => {
    reseau(() => ({ ok: false, status: 400, text: async () => '{"code":"PGRST202"}' }));
    const ctx = createStandaloneContext(ENV_BASE);
    const echec = ctx.db.request("rpc/absente", { method: "POST" });
    await expect(echec).rejects.toThrow(/400 — .*PGRST202/);
    await expect(ctx.db.request("rpc/absente")).rejects.toMatchObject({ statusCode: 400, details: { code: "PGRST202" } });
  });
});

describe("selectAll : un document très partagé dépasse la pagination par défaut", () => {
  it("enchaîne les pages par l'en-tête Range et s'arrête sur la page incomplète", async () => {
    // Sans la boucle, un document à 1 400 destinataires rendait ses 1 000 premiers et PERDAIT les
    // autres — silencieusement, puisque la réponse était bien un tableau.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 400 }, (_, i) => ({ id: 1000 + i }));
    reseau((_, init) => json(init.headers.Range === "0-999" ? page1 : page2));
    const ctx = createStandaloneContext(ENV_BASE);
    const tout = await ctx.db.selectAll("events?select=id");
    expect(tout).toHaveLength(1400);
    expect(appels.map((a) => a.entetes.Range)).toEqual(["0-999", "1000-1999"]);
  });
});

describe("storage.remove : la dernière barrière avant un DELETE à la clé service_role", () => {
  // P1 du huitième audit : `fetch` normalise `..`, donc un chemin non validé sortirait du bucket
  // visé — avec la clé qui ouvre tout. Chaque refus ci-dessous doit tomber AVANT le réseau.
  const ctx = () => createStandaloneContext(ENV_BASE);

  it("refuse tout bucket hors liste blanche, sans toucher le réseau", async () => {
    reseau(() => json({}));
    expect(await ctx().storage.remove("documents", "a.pdf")).toBe(false);
    expect(appels).toHaveLength(0);
  });

  it.each([["traversée", "a/../b.pdf"], ["segment vide", "a//b.pdf"], ["segment point", "a/./b.pdf"], ["alphabet hors chemin signé", "a/é%.pdf"]])(
    "refuse un chemin à %s, sans toucher le réseau", async (_nom, chemin) => {
      reseau(() => json({}));
      expect(await ctx().storage.remove("present-attachments", chemin)).toBe(false);
      expect(appels).toHaveLength(0);
    });

  it("efface un chemin valide par un DELETE authentifié, segments encodés un à un", async () => {
    reseau(() => json({}));
    expect(await ctx().storage.remove("present-attachments", "s1/piece.pdf")).toBe(true);
    expect(appels).toHaveLength(1);
    expect(appels[0].methode).toBe("DELETE");
    expect(appels[0].url).toBe("https://labase.supabase.co/storage/v1/object/present-attachments/s1/piece.pdf");
    expect(appels[0].entetes.Authorization).toBe("Bearer cle-service");
  });

  it("sans base configurée, rien ne part et la réponse est non", async () => {
    reseau(() => json({}));
    expect(await createStandaloneContext({}).storage.remove("present-attachments", "a.pdf")).toBe(false);
    expect(appels).toHaveLength(0);
  });
});

describe("l'instance autonome sert, elle ne range pas", () => {
  it("storage.put refuse en nommant ce qui manque (un câblage d'hôte)", async () => {
    await expect(createStandaloneContext({}).storage.put("b", "c", Buffer.alloc(1), "x"))
      .rejects.toThrow(/câblage d'hôte/);
  });

  it("signUpload rend le jeton extrait et l'URL publique quand l'API signe", async () => {
    reseau(() => json({ url: "/upload/sign/b/c?token=jeton-signe&autre=x" }));
    const r = await createStandaloneContext(ENV_BASE).storage.signUpload("pieces", "s1/p.bin");
    expect(r).toEqual({ token: "jeton-signe", publicUrl: "https://labase.supabase.co/storage/v1/object/public/pieces/s1/p.bin" });
  });

  it("signUpload rend null — jamais un objet à moitié — sur refus, réponse sans url, ou panne", async () => {
    reseau(() => json({}, 403));
    expect(await createStandaloneContext(ENV_BASE).storage.signUpload("p", "c")).toBe(null);
    reseau(() => json({ pasDUrl: true }));
    expect(await createStandaloneContext(ENV_BASE).storage.signUpload("p", "c")).toBe(null);
    reseau(() => { throw new Error("réseau coupé"); });
    expect(await createStandaloneContext(ENV_BASE).storage.signUpload("p", "c")).toBe(null);
    expect(await createStandaloneContext(ENV_BASE).storage.signUpload("", "")).toBe(null);
  });
});

describe("appelHote (via mail.send) : un refus et une panne ne doivent pas se ressembler", () => {
  const ENV_MAIL = { PLAYER_HOST_MAIL_URL: "https://hote.example/mail", PLAYER_HOST_MAIL_SECRET: "s3cret" };

  it("sans route configurée, null — et rien ne part", async () => {
    reseau(() => json({ sent: true }));
    expect(await createStandaloneContext({}).mail.send({ to: "x" })).toBe(null);
    expect(appels).toHaveLength(0);
  });

  it("une URL sans secret n'envoie RIEN et le dit — sinon l'exploitant découvre au premier email perdu", async () => {
    reseau(() => json({ sent: true }));
    const r = await createStandaloneContext({ PLAYER_HOST_MAIL_URL: "https://hote.example/mail" }).mail.send({ to: "x" });
    expect(r).toBe(null);
    expect(appels).toHaveLength(0);
    expect(erreurs.mock.calls.flat().join(" ")).toMatch(/sans PLAYER_HOST_MAIL_SECRET/);
  });

  it("le secret part en en-tête — jamais en query, les journaux gardent les URL", async () => {
    reseau(() => json({ sent: true }));
    expect(await createStandaloneContext(ENV_MAIL).mail.send({ to: "x" })).toEqual({ sent: true });
    expect(appels[0].entetes["x-player-fetch-secret"]).toBe("s3cret");
    expect(appels[0].url).not.toMatch(/s3cret/);
  });

  it("une réponse qui ne dit pas sent:true vaut « pas envoyé » — le player ne prétend jamais avoir envoyé", async () => {
    reseau(() => json({ ok: true }));
    expect(await createStandaloneContext(ENV_MAIL).mail.send({ to: "x" })).toBe(null);
  });

  it.each([
    ["un refus HTTP", () => json({}, 500), /réponse 500/],
    ["une réponse illisible", () => ({ ok: true, status: 200, json: async () => { throw new Error("pas du JSON"); } }), /illisible/],
    ["une panne réseau", () => { throw new Error("ECONNREFUSED"); }, /injoignable/],
    ["un délai dépassé", () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }, /délai dépassé/],
  ])("%s rend null ET laisse une trace qui le distingue", async (_nom, repondre, trace) => {
    // Sans la trace, « ma route répond mal » est indiscernable de « le droit est refusé » — et on
    // cherche une demi-journée du côté des rôles. L'incident est raconté dans standalone.js.
    reseau(repondre);
    expect(await createStandaloneContext(ENV_MAIL).mail.send({ to: "x" })).toBe(null);
    expect(erreurs.mock.calls.flat().join(" ")).toMatch(trace);
  });
});

describe("les décisions de l'hôte : refus par défaut, et une réponse difforme vaut refus", () => {
  const ENV_AUTHZ = { PLAYER_HOST_AUTHZ_URL: "https://hote.example/authz", PLAYER_HOST_FETCH_SECRET: "s" };

  it("sans utilisateur identifié, non — et rien ne part", async () => {
    reseau(() => json({ allowed: true }));
    expect(await createStandaloneContext(ENV_AUTHZ).identity.canManageShares(null, "create")).toBe(false);
    expect(appels).toHaveLength(0);
  });

  it("un `allowed` non booléen vaut refus, et la trace nomme le champ attendu", async () => {
    // Le cas le plus courant au branchement d'un nouvel hôte : une route qui répond { allowed: "oui" }
    // — parfaitement intentionnée, et qui n'accorde RIEN tant qu'elle ne parle pas booléen.
    reseau(() => json({ allowed: "oui" }));
    expect(await createStandaloneContext(ENV_AUTHZ).identity.canManageShares({ email: "a@b.c" }, "create")).toBe(false);
    expect(erreurs.mock.calls.flat().join(" ")).toMatch(/booléen attendu/);
  });

  it("allowed:true accorde — c'est le SEUL chemin qui accorde", async () => {
    reseau(() => json({ allowed: true }));
    expect(await createStandaloneContext(ENV_AUTHZ).identity.canManageShares({ email: "a@b.c" }, "create")).toBe(true);
  });

  it("verifyToken : une URL d'émetteur sans clé prévient qu'aucun jeton ne sera vérifié", async () => {
    reseau(() => json({}));
    const ctx = createStandaloneContext({ PLAYER_AUTH_URL: "https://auth.example" });
    expect(await ctx.identity.verifyToken("jeton")).toBe(null);
    expect(erreurs.mock.calls.flat().join(" ")).toMatch(/sans PLAYER_AUTH_KEY/);
  });

  it("branding.forKey : sans clé de marque rien ne part ; une réponse sans logo vaut null", async () => {
    reseau(() => json({ name: "sans logo" }));
    const ctx = createStandaloneContext({ PLAYER_HOST_BRAND_URL: "https://hote.example/brand" });
    expect(await ctx.branding.forKey("")).toBe(null);
    expect(appels).toHaveLength(0);
    expect(await ctx.branding.forKey("acme")).toBe(null);
    reseau(() => json({ logo: "https://cdn/l.svg", name: "Acme", dark: 1 }));
    expect(await ctx.branding.forKey("acme")).toEqual({ logo: "https://cdn/l.svg", name: "Acme", dark: true });
  });
});

describe("verifyInternalToken : un jeton de membre expire, ou il ne vaut rien", () => {
  // Le format vit dans standalone.js : base64url(JSON) + "." + HMAC-SHA256 du même JSON, signé
  // avec le secret que l'hôte détient déjà. Le commentaire du fichier porte la propriété que ce
  // banc épingle : « un jeton sans expiration signé une fois vaudrait pour toujours, y compris
  // après le départ du membre de l'entreprise ». La signature de ce jeton-là est VALIDE — c'est
  // exactement pourquoi le refus doit venir d'ailleurs.
  const SECRET = "secret-partage";
  const forger = (charge, secret = SECRET) => {
    const corps = Buffer.from(JSON.stringify(charge)).toString("base64url");
    return corps + "." + crypto.createHmac("sha256", secret).update(corps).digest("base64url");
  };
  const ctx = () => createStandaloneContext({ PLAYER_HOST_FETCH_SECRET: SECRET });
  const demain = Math.floor(Date.now() / 1000) + 3600;

  it("un jeton signé, non expiré, complet, rend le membre — et REND DES CHAÎNES, pas ce qu'on a signé", () => {
    const m = ctx().identity.verifyInternalToken(forger({ email: "p@hote.example", name: 7, docId: 42, exp: demain }));
    expect(m).toEqual({ email: "p@hote.example", name: "7", docId: "42" });
  });

  it("une signature falsifiée — ou d'un AUTRE secret — vaut null", () => {
    const bon = forger({ email: "p@hote.example", docId: "d", exp: demain });
    expect(ctx().identity.verifyInternalToken(bon.slice(0, -2) + "xx")).toBe(null);
    expect(ctx().identity.verifyInternalToken(forger({ email: "p@hote.example", docId: "d", exp: demain }, "autre-secret"))).toBe(null);
  });

  it("un jeton expiré vaut null — le départ d'un membre a une date", () => {
    expect(ctx().identity.verifyInternalToken(forger({ email: "p@hote.example", docId: "d", exp: Math.floor(Date.now() / 1000) - 5 }))).toBe(null);
  });

  it("un jeton SANS exp vaut null, même signé juste — signé une fois, valable pour toujours est le bug", () => {
    expect(ctx().identity.verifyInternalToken(forger({ email: "p@hote.example", docId: "d" }))).toBe(null);
  });

  it("un jeton sans email ou sans docId vaut null : une identité incomplète n'identifie personne", () => {
    expect(ctx().identity.verifyInternalToken(forger({ docId: "d", exp: demain }))).toBe(null);
    expect(ctx().identity.verifyInternalToken(forger({ email: "p@hote.example", exp: demain }))).toBe(null);
  });

  it("sans secret configuré, ou sans séparateur, null — un pouvoir qu'on ne sait pas accorder ne s'accorde pas", () => {
    expect(createStandaloneContext({}).identity.verifyInternalToken(forger({ email: "e", docId: "d", exp: demain }))).toBe(null);
    expect(ctx().identity.verifyInternalToken("pas-de-point")).toBe(null);
    expect(ctx().identity.verifyInternalToken("")).toBe(null);
  });
});

describe("compteurs de débit : dégrader, jamais casser — et jamais en silence", () => {
  // La sonde de table (`player_rate_limits`) puis le RPC atomique : chaque réponse anormale a un
  // comportement DÉFINI, écrit dans standalone.js, et c'est lui qu'on épingle ici.
  const surRpc = (reponseRpc) => reseau((url) =>
    url.includes("player_rate_limits?") ? json([]) : reponseRpc(url));

  it("le refus du compteur partagé est obéi", async () => {
    surRpc(() => json([{ autorise: false }]));
    expect(await createStandaloneContext(ENV_BASE).limits.allow("doc:1.2.3.4", 10, 60)).toBe(false);
  });

  it("une réponse d'une forme inconnue laisse passer ET prévient — on n'invente pas un verdict", async () => {
    surRpc(() => json([{}]));
    expect(await createStandaloneContext(ENV_BASE).limits.allow("doc:1.2.3.4", 10, 60)).toBe(true);
    expect(erreurs.mock.calls.flat().join(" ")).toMatch(/réponse inattendue/);
  });

  it("un RPC absent (migration non appliquée) laisse passer et NOMME le fichier à appliquer — une seule fois", async () => {
    surRpc(() => json({ message: "PGRST202" }, 404));
    const ctx = createStandaloneContext(ENV_BASE);
    expect(await ctx.limits.allow("doc:1.2.3.4", 10, 60)).toBe(true);
    expect(await ctx.limits.allow("doc:1.2.3.4", 10, 60)).toBe(true);
    const traces = erreurs.mock.calls.flat().join(" ");
    expect(traces).toMatch(/0004-limites-atomiques\.sql/);
    // « une fois » : le même avertissement répété à chaque requête apprend à ne plus lire.
    expect(traces.split("0004-limites-atomiques.sql").length - 1).toBe(1);
  });
});
