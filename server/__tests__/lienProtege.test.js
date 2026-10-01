// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES LIENS PROTÉGÉS (0028) — UNE ÉCHÉANCE ET UN MOT DE PASSE, ET TOUTES LES PORTES À LA FOIS.
//
// Demandé par le premier hôte le 01/10/2026 : sa fenêtre de partage disait « sans expiration ». Ce qui
// rend le sujet dangereux n'est pas la page : c'est tout ce qui, à côté d'elle, lit un lien par son
// slug — le fichier (`?file=1`), l'assistant, la mesure, le re-partage. Une porte posée sur la page
// seule serait une porte de décor (la leçon de `murDocument.test.js`). Ce banc éprouve donc chaque
// issue SUR LE VRAI `shares.js` — seule la base est simulée, et elle répond ce qu'une base répondrait.
//
// Dimensions VARIÉES : expiré / protégé / les deux / aucun ; cookie absent, faux, d'un autre lien,
// valide ; migration présente / absente ; page, fichier, mesure, assistant, re-partage, liste.
// Dimensions TENUES FIXES : une seule instance (pas de second processus qui verrait un autre cookie) ;
// le navigateur n'est pas exécuté — la page du mot de passe est lue, son script n'est pas joué (le
// chemin qu'il appelle, `link-unlock`, est éprouvé directement) ; l'horloge est celle du processus.

const crypto = require("node:crypto");
const protection = require("../lien-protege.js");

const MAINTENANT = Date.now();
const DEMAIN = new Date(MAINTENANT + 86_400_000).toISOString();
const HIER = new Date(MAINTENANT - 86_400_000).toISOString();
const EMPREINTE = protection.empreinte("rose-des-vents");

const LIEN = (surcharge = {}) => ({
  slug: "Lien-_Protege1", doc_id: "doc-42", doc_title: "Plan du lot A",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/docs/plan.pdf", file_name: "plan.pdf",
  recipient_email: "prospect@exemple.fr", recipient_name: "Prospect", created_by: "commercial@exemple.fr",
  created_at: "2026-09-30T09:00:00.000Z", revoked: false, parent_slug: null, require_auth: false,
  allow_download: true, bot_enabled: true, is_test: false, expires_at: null, password_hash: null,
  ...surcharge,
});

// ── La base simulée : les liens, la colonne de la 0028 (présente ou non), et ce qu'on y écrit. ──
let liens = [];
let lecturesDeLiens = 0;
let colonnePresente = true;
let ecrites = [];
let fichiersLus = [];
let mesures = [];
const db = {
  async request(chemin, options = {}) {
    const methode = (options.method || "GET").toUpperCase();
    if (chemin.includes("select=expires_at") && chemin.includes("limit=0")) {
      if (!colonnePresente) throw Object.assign(new Error("column commercial_doc_shares.expires_at does not exist"), { status: 400 });
      return [];
    }
    if (chemin.startsWith("commercial_doc_shares")) {
      const slug = decodeURIComponent((/slug=eq\.([^&]+)/.exec(chemin) || [])[1] || "");
      if (methode === "GET") lecturesDeLiens += 1;
      if (methode === "GET") return liens.filter((l) => (!slug || l.slug === slug) && !l.revoked).map((l) => ({ ...l }));
      if (methode === "POST") { ecrites.push(...options.body); return []; }
      if (methode === "PATCH") {
        const l = liens.find((x) => x.slug === slug && !x.revoked);
        if (!l) return [];
        Object.assign(l, options.body);
        return [{ ...l }];
      }
    }
    if (chemin.startsWith("commercial_doc_views") || chemin.startsWith("commercial_doc_sessions")) { mesures.push(chemin); return []; }
    return [];
  },
  async selectAll() { return []; },
};

const player = require("../handler.js");
const shares = require("../shares.js");
function initialiser({ limiter = async () => true } = {}) {
  player.init({
    plugins: {}, has: () => false,
    storage: {
      isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"),
      async fetchFile(url) { fichiersLus.push(url); return { ok: true, status: 200, headers: { get: () => "application/pdf" }, arrayBuffer: async () => Buffer.from("pdf") }; },
      async put() {},
    },
    db, mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { allow: limiter },
    branding: { async logo() { return ""; }, name: "Studio", poweredBy: "", loaderName: "", forKey: async () => null, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  });
}

function reponse() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(s, h) { this.statusCode = s; for (const [k, v] of Object.entries(h || {})) this.headers[k.toLowerCase()] = v; },
    write(b) { this.body += String(b); }, end(b) { if (b != null) this.body += String(b); },
  };
}
async function ouvrir(query, cookie = "") {
  const res = reponse();
  await player.handler({ method: "GET", headers: cookie ? { cookie } : {}, socket: {}, query }, res);
  return res;
}
async function poster(body, cookie = "") {
  const res = reponse();
  await player.handler({ method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: "203.0.113.9" }, query: {}, body }, res);
  return res;
}
/** Le cookie que le bon mot de passe aurait posé — pris à la réponse réelle, jamais recomposé ici. */
async function cookieApresMotDePasse(slug, mot) {
  const r = await poster({ action: "link-unlock", slug, password: mot });
  return String(r.headers["set-cookie"] || "").split(";")[0];
}

beforeEach(() => {
  liens = []; ecrites = []; fichiersLus = []; mesures = []; colonnePresente = true;
  initialiser();
});

describe("la règle, sans le serveur", () => {
  it("expiré : sans date jamais, date passée toujours, date illisible TOUJOURS (on ne lit pas, on ferme)", () => {
    expect(protection.expire({ expires_at: null }, MAINTENANT)).toBe(false);
    expect(protection.expire({ expires_at: DEMAIN }, MAINTENANT)).toBe(false);
    expect(protection.expire({ expires_at: HIER }, MAINTENANT)).toBe(true);
    expect(protection.expire({ expires_at: "pas une date" }, MAINTENANT)).toBe(true);
  });
  it("le mot de passe se vérifie contre l'empreinte, jamais en clair, et l'empreinte change à chaque fois", () => {
    expect(EMPREINTE).not.toContain("rose-des-vents");
    expect(protection.motValide("rose-des-vents", EMPREINTE)).toBe(true);
    expect(protection.motValide("Rose-des-vents", EMPREINTE)).toBe(false);
    expect(protection.motValide("", EMPREINTE)).toBe(false);
    expect(protection.empreinte("rose-des-vents")).not.toBe(EMPREINTE);
  });
  it("la demande de l'hôte est BORNÉE : date à venir, deux ans au plus, mot de passe de 4 à 200 caractères", () => {
    expect(protection.protectionDemandee({ expiresAt: HIER }, MAINTENANT).refus).toMatch(/à venir/);
    expect(protection.protectionDemandee({ expiresAt: new Date(MAINTENANT + 800 * 86_400_000).toISOString() }, MAINTENANT).refus).toMatch(/730 jours/);
    expect(protection.protectionDemandee({ expiresAt: "demain" }, MAINTENANT).refus).toMatch(/illisible/);
    expect(protection.protectionDemandee({ password: "abc" }, MAINTENANT).refus).toMatch(/4 caractères/);
    expect(protection.protectionDemandee({ password: "x".repeat(201) }, MAINTENANT).refus).toMatch(/200 caractères/);
    const ok = protection.protectionDemandee({ expiresAt: DEMAIN, password: "rose-des-vents" }, MAINTENANT);
    expect(ok.protege).toBe(true);
    expect(ok.champs.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    // Rien de demandé : rien à écrire, et rien n'exige la migration.
    expect(protection.protectionDemandee({}, MAINTENANT)).toEqual({ champs: {}, protege: false });
    // Retirer : des `null` à écrire, et ce n'est pas une protection.
    expect(protection.protectionDemandee({ expiresAt: null, password: null }, MAINTENANT)).toEqual({ champs: { expires_at: null, password_hash: null }, protege: false });
  });
});

describe("⚠️ un lien EXPIRÉ est fermé partout — et il le dit", () => {
  beforeEach(() => { liens = [LIEN({ expires_at: HIER })]; });

  it("la page dit « expiré » (410), pas « introuvable » : on peut en demander un autre", async () => {
    const r = await ouvrir({ slug: "Lien-_Protege1" });
    expect(r.statusCode).toBe(410);
    expect(r.body).toContain("Ce lien a expiré");
    expect(r.body).not.toContain("plan.pdf\"");
  });
  it("⚠️ le FICHIER reste derrière (410), sans qu'un octet soit lu au stockage", async () => {
    const r = await ouvrir({ slug: "Lien-_Protege1", file: "1" });
    expect(r.statusCode).toBe(410);
    expect(fichiersLus).toEqual([]);
  });
  it("intégré, il le DIT à l'hôte (`embed-denied` expired) — un silence le ferait replier sur son propre lecteur", async () => {
    const r = await ouvrir({ slug: "Lien-_Protege1", embed: "1" });
    expect(r.body).toContain('reason:"expired"');
  });
  it("la mesure ne s'écrit pas, l'assistant ne répond pas, le re-partage ne part pas", async () => {
    await poster({ action: "track", event: "open", slug: "Lien-_Protege1", sessionId: "s1" });
    expect(mesures).toEqual([]);
    await expect(shares.createReshare("Lien-_Protege1", { email: "x@exemple.fr", name: "X", req: { headers: {} } })).rejects.toThrow(/introuvable/);
  });
  it("un lien qui expire DEMAIN s'ouvre aujourd'hui", async () => {
    liens = [LIEN({ expires_at: DEMAIN })];
    const r = await ouvrir({ slug: "Lien-_Protege1" });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("Ce lien a expiré");
  });
});

describe("⚠️ un lien protégé par MOT DE PASSE : la page le demande, et rien d'autre ne passe", () => {
  beforeEach(() => { liens = [LIEN({ password_hash: EMPREINTE })]; });

  it("sans cookie : la page du mot de passe — le titre, jamais le fichier", async () => {
    const r = await ouvrir({ slug: "Lien-_Protege1" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Document protégé");
    expect(r.body).toContain("Plan du lot A");
    expect(r.body).not.toContain("exemple.supabase.co/storage");
    expect(r.body).not.toContain(EMPREINTE);
  });
  it("⚠️ sans cookie, le FICHIER rend 401 sans streamer — une page de mot de passe à côté d'un PDF ouvert serait un décor", async () => {
    const r = await ouvrir({ slug: "Lien-_Protege1", file: "1" });
    expect(r.statusCode).toBe(401);
    expect(fichiersLus).toEqual([]);
  });
  it("le MAUVAIS mot de passe : 400, aucun cookie", async () => {
    const r = await poster({ action: "link-unlock", slug: "Lien-_Protege1", password: "boussole" });
    expect(r.statusCode).toBe(400);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("le BON mot de passe : un cookie HttpOnly, Secure — et avec lui, la page ET le fichier s'ouvrent", async () => {
    const r = await poster({ action: "link-unlock", slug: "Lien-_Protege1", password: "rose-des-vents" });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers["set-cookie"])).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    expect((await ouvrir({ slug: "Lien-_Protege1" }, cookie)).body).not.toContain("Document protégé");
    const f = await ouvrir({ slug: "Lien-_Protege1", file: "1" }, cookie);
    expect(f.statusCode).not.toBe(401);
    expect(fichiersLus).toHaveLength(1);
  });
  it("⚠️ un cookie FORGÉ, ou celui d'un AUTRE lien protégé, n'ouvre rien", async () => {
    liens.push(LIEN({ slug: "Autre-_Lien_22", password_hash: EMPREINTE }));
    const cookieAutre = await cookieApresMotDePasse("Autre-_Lien_22", "rose-des-vents");
    const nomIci = protection.nomDuCookie("Lien-_Protege1");
    // Le jeton de l'autre lien, posé sous le nom de celui-ci : même mot de passe, même empreinte — et refusé.
    const vole = `${nomIci}=${cookieAutre.split("=")[1]}`;
    expect((await ouvrir({ slug: "Lien-_Protege1" }, vole)).body).toContain("Document protégé");
    const forge = `${nomIci}=${crypto.randomBytes(32).toString("base64url")}`;
    expect((await ouvrir({ slug: "Lien-_Protege1" }, forge)).body).toContain("Document protégé");
  });
  it("⚠️ CHANGER le mot de passe referme les navigateurs déjà entrés", async () => {
    const cookie = await cookieApresMotDePasse("Lien-_Protege1", "rose-des-vents");
    colonnePresente = true;
    await shares.setShareProtection("Lien-_Protege1", { password: "nouveau-mot" });
    expect((await ouvrir({ slug: "Lien-_Protege1" }, cookie)).body).toContain("Document protégé");
  });
  // ⚠️ UN PLAFOND À LA FOIS. Un limiteur qui refusait toutes les clés `lienmdp:` laissait passer au vert
  // le retrait du plafond par ADRESSE : celui par lien refusait à sa place (mutation rejouée).
  it.each([
    ["par adresse — un poste ne recommence pas à zéro en changeant de lien", (cle) => /^lienmdp:(?!lien:)/.test(cle)],
    ["par lien — cent adresses ne forcent pas un même lien", (cle) => cle.startsWith("lienmdp:lien:")],
  ])("les essais sont PLAFONNÉS %s : 429, et le mot de passe n'est même pas comparé", async (_n, refuse) => {
    initialiser({ limiter: async (cle) => !refuse(String(cle)) });
    const r = await poster({ action: "link-unlock", slug: "Lien-_Protege1", password: "rose-des-vents" });
    expect(r.statusCode).toBe(429);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("sans cookie, la mesure ne s'écrit pas et l'assistant ne répond pas", async () => {
    await poster({ action: "track", event: "open", slug: "Lien-_Protege1", sessionId: "s1" });
    expect(mesures).toEqual([]);
  });
  it("⚠️ SANS REQUÊTE, VERROUILLÉ : un appel interne qui oublie de la passer obtient « introuvable »", async () => {
    expect(await shares.getShareBySlug("Lien-_Protege1")).toBeNull();
    expect(await shares.getShareBySlug("Lien-_Protege1", undefined)).toBeNull();
  });
  it("le re-partage exige d'être entré — et l'enfant HÉRITE de l'échéance et du mot de passe", async () => {
    await expect(shares.createReshare("Lien-_Protege1", { email: "x@exemple.fr", name: "X", req: { headers: {} } })).rejects.toThrow(/introuvable/);
    liens[0].expires_at = DEMAIN;
    const cookie = await cookieApresMotDePasse("Lien-_Protege1", "rose-des-vents");
    await shares.createReshare("Lien-_Protege1", { email: "x@exemple.fr", name: "X", req: { headers: { cookie } } });
    expect(ecrites[0]).toMatchObject({ password_hash: EMPREINTE, expires_at: DEMAIN, parent_slug: "Lien-_Protege1" });
  });
});

describe("la création et la modification, côté hôte", () => {
  const BASE = { docId: "doc-42", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/docs/plan.pdf", fileName: "plan.pdf" };

  it("un lien protégé s'écrit avec son EMPREINTE, jamais le mot de passe", async () => {
    await shares.createShare({ ...BASE, expiresAt: DEMAIN, password: "rose-des-vents" });
    expect(ecrites[0].expires_at).toBe(DEMAIN);
    expect(ecrites[0].password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(JSON.stringify(ecrites[0])).not.toContain("rose-des-vents");
  });
  it("⚠️ SANS LA MIGRATION, la création d'un lien protégé est REFUSÉE (503, qui la nomme) — jamais un lien ouvert", async () => {
    colonnePresente = false;
    require("../schema.js").oublier();
    await expect(shares.createShare({ ...BASE, password: "rose-des-vents" })).rejects.toMatchObject({ statusCode: 503, message: expect.stringMatching(/0028-liens-proteges\.sql/) });
    expect(ecrites).toEqual([]);
  });
  it("sans protection demandée, rien ne change — ni colonne écrite, ni migration exigée", async () => {
    colonnePresente = false;
    require("../schema.js").oublier();
    await shares.createShare({ ...BASE });
    expect(ecrites).toHaveLength(1);
    expect("expires_at" in ecrites[0]).toBe(false);
    expect("password_hash" in ecrites[0]).toBe(false);
  });
  it("une demande hors bornes est refusée en 400, avec la raison", async () => {
    await expect(shares.createShare({ ...BASE, password: "abc" })).rejects.toMatchObject({ statusCode: 400, publique: true });
  });
  it("modifier : poser une échéance, puis la retirer ; un lien révoqué ne se modifie pas", async () => {
    liens = [LIEN()];
    expect(await shares.setShareProtection("Lien-_Protege1", { expiresAt: DEMAIN })).toMatchObject({ ok: true, expiresAt: DEMAIN, protege: false });
    expect(await shares.setShareProtection("Lien-_Protege1", { expiresAt: null })).toMatchObject({ ok: true, expiresAt: null });
    liens[0].revoked = true;
    await expect(shares.setShareProtection("Lien-_Protege1", { expiresAt: DEMAIN })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("⚠️ la liste des liens sert l'échéance et un booléen — JAMAIS l'empreinte", async () => {
    liens = [LIEN({ password_hash: EMPREINTE, expires_at: DEMAIN })];
    const { shares: liste } = await shares.listSharesForDoc("doc-42", null);
    expect(liste[0]).toMatchObject({ expiresAt: DEMAIN, protege: true });
    expect(JSON.stringify(liste)).not.toContain(EMPREINTE.split(":")[1]);
  });
});

describe("⚠️ UNE LECTURE PAR PAGE (0.1.171) — un refus ne relit pas le lien pour dire pourquoi", () => {
  // 0.1.170 lisait le lien par `getShareBySlug`, puis le RELISAIT par `resoudreLien` quand il ne s'ouvrait pas — deux
  // allers-retours pour la même ligne, sur le chemin le plus fréquent des refus : un lien révoqué qui circule encore.
  it.each([
    ["révoqué", () => [], 404],
    ["expiré", () => [LIEN({ expires_at: HIER })], 410],
    ["protégé", () => [LIEN({ password_hash: EMPREINTE })], 200],
    ["ouvert", () => [LIEN()], 200],
  ])("lien %s : une seule lecture du lien", async (_n, jeu, statut) => {
    liens = jeu();
    lecturesDeLiens = 0;
    const r = await ouvrir({ slug: "Lien-_Protege1" });
    expect(r.statusCode).toBe(statut);
    expect(lecturesDeLiens).toBe(1);
  });
});

describe("la page de départ (`?page=N`)", () => {
  beforeEach(() => { liens = [LIEN()]; });
  const pageServie = (html) => Number((/"page":(\d+)/.exec(html) || [])[1]);

  it("un entier au-delà de 1 est transmis à la visionneuse", async () => {
    expect(pageServie((await ouvrir({ slug: "Lien-_Protege1", page: "12" })).body)).toBe(12);
  });
  it("tout le reste vaut 1, et le plafond tient", async () => {
    expect(pageServie((await ouvrir({ slug: "Lien-_Protege1", page: "abc" })).body)).toBe(1);
    expect(pageServie((await ouvrir({ slug: "Lien-_Protege1", page: "-4" })).body)).toBe(1);
    expect(pageServie((await ouvrir({ slug: "Lien-_Protege1", page: "99999999" })).body)).toBe(10000);
  });
  it("l'aperçu interne l'accepte aussi — c'est par lui que l'hôte ouvre ses propres documents", async () => {
    const r = await ouvrir({ preview: "1", url: "https://exemple.supabase.co/storage/v1/object/public/docs/plan.pdf", name: "plan.pdf", page: "7" });
    expect(pageServie(r.body)).toBe(7);
  });
});
