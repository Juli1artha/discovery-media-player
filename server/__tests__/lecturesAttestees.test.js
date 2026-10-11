// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES LECTURES D'UN LIEN ATTESTÉ S'ATTRIBUENT À QUELQU'UN — ET L'HÔTE PEUT LES LIRE, ELLES SEULES.
//
// ⚠️ CE QUI ÉTAIT CASSÉ (#574, constaté chez un hôte le 11/10/2026). Un lien créé par l'hôte pour un
// visiteur qu'il atteste était mesuré parfaitement — 108 sessions, toutes avec temps par page — et
// ces lectures ne s'attribuaient à personne :
//   1. les sessions ne portaient pas l'adresse attestée : elle vit sur le LIEN
//      (`attested_recipient_email`), aucune lecture ne la sortait ;
//   2. le lien n'a pas d'auteur, donc aucun membre ne le voyait sous « mes liens » ;
//   3. le secret de l'hôte ne servait qu'à `create` : celui qui avait attesté l'adresse ne pouvait
//      pas lire ce qu'elle avait lu.
// L'espace client affichait « 0 de lecture » à un conseiller dont le client avait lu.
//
// ⚠️ CE QUE CE BANC ÉPROUVE D'ABORD, C'EST LA BORNE. La porte ouverte au secret se juge sur ce
// qu'elle ne laisse PAS passer : liens anonymes, liens de membres, repartages, autres documents,
// autres actions. D'où une base factice HONNÊTE — elle applique chaque filtre qu'on lui passe, la
// limite comprise, et refuse une colonne inconnue comme PostgREST. Une base qui rendrait tout quel
// que soit le chemin ferait passer pour une borne un filtre que personne n'écrit.
//
// Dimensions variées : la nature du lien (attesté / anonyme / membre / membre ET attesté / enfant),
// le document, la présence de la colonne, le secret (bon / mauvais / absent), le rôle du membre.
// ⚠️ Tenues fixes : une seule adresse d'appel (la limite de débit n'est éprouvée que par le refus
// de l'hôte de limites, pas par un compteur réel), et le contrat de `isTrustedHostCall` — c'est
// l'hôte qui compare le secret, ce banc ne fait que choisir sa réponse.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const player = require("../handler.js");
const { listSessionsForRecipient } = require("../shares.js");

const SECRET = "un-secret-de-serveur-suffisamment-long-0123456789";

// ── La base factice ──────────────────────────────────────────────────────────────────────────────
let liens = [];
let sessions = [];
let colonneAbsente = false;
let limiteRefusee = null;      // préfixe de clé de limite que l'hôte refuse, ou null
let demandes = [];
let clesDeLimite = [];

const valeur = (v) => decodeURIComponent(v);
const listeIn = (v) => valeur(v).split(",").map((x) => x.replace(/"/g, ""));

/** Applique un filtre PostgREST plat (`col=op.val`) — ceux que le code emploie, et pas un de plus. */
function filtrer(lignes, cle, expr) {
  if (["select", "order", "limit", "on_conflict"].includes(cle)) return lignes;
  const point = expr.indexOf(".");
  const op = expr.slice(0, point);
  const reste = expr.slice(point + 1);
  if (op === "eq") return lignes.filter((l) => String(l[cle] ?? "") === valeur(reste));
  if (op === "is" && reste === "null") return lignes.filter((l) => l[cle] == null);
  if (op === "not" && reste === "is.null") return lignes.filter((l) => l[cle] != null);
  if (op === "in") return lignes.filter((l) => listeIn(reste.slice(1, -1)).includes(l[cle]));
  if (op === "gte") return lignes.filter((l) => String(l[cle]) >= valeur(reste));
  // Un filtre que la fausse base ne sait pas appliquer est une faute du banc : on la dit.
  throw new Error(`filtre non simulé : ${cle}=${expr}`);
}

function lire(chemin) {
  const [table, requete = ""] = chemin.split("?");
  const params = requete.split("&").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i), p.slice(i + 1)];
  });
  const select = (params.find(([k]) => k === "select") || [])[1] || "*";
  // PostgREST refuse une colonne inconnue — dans le `select` ET dans un filtre.
  const nomme = [...valeur(select).split(","), ...params.map(([k]) => k)];
  if (colonneAbsente && nomme.includes("attested_recipient_email")) {
    throw new Error('column "attested_recipient_email" does not exist');
  }
  let lignes = table === "commercial_doc_shares" ? liens.slice()
    : table === "commercial_doc_sessions" ? sessions.slice() : [];
  for (const [k, v] of params) lignes = filtrer(lignes, k, v);
  if (table === "commercial_doc_sessions") lignes.sort((a, b) => b.last_at.localeCompare(a.last_at));
  const limite = params.find(([k]) => k === "limit");
  if (limite) lignes = lignes.slice(0, Number(limite[1]));
  // La projection, pour qu'une colonne non demandée ne puisse pas « sortir » par la fausse base.
  if (select === "*") return lignes;
  const champs = valeur(select).split(",");
  return lignes.map((l) => Object.fromEntries(champs.filter((c) => c in l).map((c) => [c, l[c]])));
}

// ── Le contexte ──────────────────────────────────────────────────────────────────────────────────
let membre = null;             // ce que `verifyToken` rend
let droits = async () => false;

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: {
      async request(chemin, options = {}) {
        demandes.push(chemin);
        if (options.method && options.method !== "GET") return [];
        return lire(String(chemin));
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: {
      async verifyToken(h) { return h ? membre : null; },
      roleOf: () => "", isAdmin: () => false,
      canManageShares: (u, acte) => droits(u, acte),
      isTrustedHostCall(headers) { return String((headers && headers["x-player-share-secret"]) || "") === SECRET; },
    },
    limits: { async allow(cle) { clesDeLimite.push(cle); return !(limiteRefusee && String(cle).startsWith(limiteRefusee)); } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], hostShare: true },
  };
}

async function appeler(body, { secret = null, jwt = null } = {}) {
  demandes = [];
  clesDeLimite = [];
  player.init(contexte());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers["x-player-share-secret"] = secret;
  if (jwt !== null) headers.authorization = `Bearer ${jwt}`;
  await player.handler({ method: "POST", headers, socket: { remoteAddress: "203.0.113.5" }, query: {}, body }, res);
  return { statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
}

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────
const lien = (slug, { doc = "programme-42", cree = null, email = null, nom = null, atteste = null, parent = null } = {}) =>
  ({ slug, doc_id: doc, parent_slug: parent, created_by: cree, recipient_email: email, recipient_name: nom, attested_recipient_email: atteste });

let rang = 0;
const session = (id, slug, { doc = "programme-42", email = null, at = null } = {}) => {
  rang += 1;
  return { session_id: id, slug, doc_id: doc, recipient_email: email,
    num_pages: 12, max_page: 7, total_seconds: 300, pages_time: { 1: 40, 2: 60 },
    device: "desktop", os: "macOS", browser: "Safari",
    started_at: "2026-10-10T09:00:00.000Z", last_at: at || `2026-10-10T10:${String(rang % 60).padStart(2, "0")}:00.000Z` };
};

function jeuComplet() {
  liens = [
    // Les deux liens que l'hôte a créés pour des visiteurs qu'il atteste : ce qu'il doit lire.
    lien("Atteste-1", { atteste: "claire@client.fr" }),
    lien("Atteste-2", { atteste: "marc@client.fr" }),
    // La plaquette publique : ni auteur ni adresse — un prospect sans compte.
    lien("Anonyme", {}),
    // Un lien de membre, nominatif : derrière le JWT.
    lien("Membre", { cree: "alice@hote.example", email: "dana@prospect.fr", nom: "Dana" }),
    // ⚠️ Un lien de membre QUI PORTERAIT une adresse attestée. L'API ne le fabrique pas, mais la
    // borne est double, et chaque moitié doit refuser seule : sans auteur ET attesté.
    lien("Membre-Atteste", { cree: "bob@hote.example", atteste: "zoe@client.fr" }),
    // ⚠️ Le repartage d'un lien attesté : `created_by` hérite d'un nul, l'adresse attestée ne suit
    // pas — son lecteur, le visiteur l'a choisi ; l'hôte ne l'a jamais vérifié.
    lien("Enfant", { parent: "Atteste-1", email: "paul@ailleurs.fr", nom: "Paul" }),
    // Un autre document, attesté aussi : le `docId` borne.
    lien("Autre-Doc", { doc: "programme-99", atteste: "claire@client.fr" }),
  ];
  sessions = [
    session("s-att-1", "Atteste-1"),
    session("s-att-2", "Atteste-2"),
    session("s-anon", "Anonyme"),
    session("s-membre", "Membre", { email: "dana@prospect.fr" }),
    session("s-membre-att", "Membre-Atteste"),
    session("s-enfant", "Enfant", { email: "paul@ailleurs.fr" }),
    session("s-autre-doc", "Autre-Doc", { doc: "programme-99" }),
  ];
}

const ids = (corps) => (corps.sessions || []).map((s) => s.session_id).sort();

beforeEach(() => {
  colonneAbsente = false;
  limiteRefusee = null;
  membre = null;
  droits = async () => false;
  jeuComplet();
});

describe("chaque session porte l'adresse attestée de son lien", () => {
  it("lue par un membre qui a list.all : l'adresse attestée sort, recipient_email reste nul", async () => {
    membre = { email: "admin@hote.example" };
    droits = async () => true;
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { jwt: "jeton" });
    expect(r.statut).toBe(200);
    expect(r.corps.scope).toBe("all");
    const claire = r.corps.sessions.find((s) => s.session_id === "s-att-1");
    expect(claire.attested_recipient_email).toBe("claire@client.fr");
    // ⚠️ La garde du relais de courrier : `recipient_email` dit aussi qui expédie au repartage.
    expect(claire.recipient_email, "le visiteur attesté ne devient pas expéditeur").toBeNull();
    // Le temps par page voyage avec : c'est toute la raison du ticket.
    expect(claire.pages_time).toEqual({ 1: 40, 2: 60 });
  });

  it("un lien qui n'est pas attesté porte le champ, à null — jamais absent", async () => {
    membre = { email: "admin@hote.example" };
    droits = async () => true;
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { jwt: "jeton" });
    const anon = r.corps.sessions.find((s) => s.session_id === "s-anon");
    expect("attested_recipient_email" in anon).toBe(true);
    expect(anon.attested_recipient_email).toBeNull();
  });

  // ⚠️ PostgREST rejette un `select=` qui nomme une colonne inconnue. Sans la sonde, un hôte sans la
  // 0001 aurait vu TOUTES ses lectures de sessions tomber en 500 en déployant cette version — pour
  // une fonction dont il ne se sert pas.
  it("⚠️ sans la migration 0001, la lecture des membres continue de répondre", async () => {
    colonneAbsente = true;
    membre = { email: "admin@hote.example" };
    droits = async () => true;
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { jwt: "jeton" });
    expect(r.statut).toBe(200);
    expect(r.corps.sessions.length).toBeGreaterThan(0);
    expect(r.corps.sessions.every((s) => s.attested_recipient_email === null)).toBe(true);
  });

  it("listSessionsForRecipient porte le même champ, depuis le lien", async () => {
    // Fixture de PROVENANCE : cette lecture part de `recipient_email`, que les sessions d'un lien
    // attesté n'ont pas — on lui donne ici une session qui en porte une, pour éprouver que le champ
    // vient bien du lien et sort sous le même nom que dans `listSessionsForDoc`.
    sessions = [session("s-fiche", "Atteste-1", { email: "claire@client.fr", at: new Date().toISOString() }),
      session("s-fiche-membre", "Membre", { email: "claire@client.fr", at: new Date().toISOString() })];
    player.init(contexte());
    const { sessions: vues } = await listSessionsForRecipient("claire@client.fr", { owner: null });
    const parId = Object.fromEntries(vues.map((s) => [s.session_id, s]));
    expect(parId["s-fiche"].attested_recipient_email).toBe("claire@client.fr");
    expect(parId["s-fiche-membre"].attested_recipient_email).toBeNull();
  });
});

describe("l'hôte, par son secret, lit les sessions des liens qu'il a créés ET attestés", () => {
  it("rend seulement celles-là, avec scope: \"host\"", async () => {
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(r.statut).toBe(200);
    expect(r.corps.ok).toBe(true);
    expect(r.corps.scope).toBe("host");
    expect(ids(r.corps)).toEqual(["s-att-1", "s-att-2"]);
    expect(r.corps.sessions.map((s) => s.attested_recipient_email).sort())
      .toEqual(["claire@client.fr", "marc@client.fr"]);
  });

  // Chaque exclusion, nommée : une borne qui ne refuse qu'en bloc ne dit pas laquelle de ses moitiés
  // travaille.
  it.each([
    ["s-anon", "un lien anonyme — pas d'adresse attestée"],
    ["s-membre", "un lien de membre — il a un auteur"],
    ["s-membre-att", "un lien de membre même attesté — la moitié « sans auteur » refuse seule"],
    ["s-enfant", "un repartage d'un lien attesté — son lecteur n'a pas été attesté"],
    ["s-autre-doc", "un lien attesté d'un AUTRE document"],
  ])("⚠️ n'inclut pas %s : %s", async (id) => {
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(ids(r.corps)).not.toContain(id);
  });

  it("⚠️ ni l'adresse d'un prospect de membre, ni celle d'un repartage ne sortent", async () => {
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    const texte = JSON.stringify(r.corps);
    expect(texte).not.toContain("dana@prospect.fr");
    expect(texte).not.toContain("paul@ailleurs.fr");
    expect(texte).not.toContain("zoe@client.fr");
  });

  it("un document qui n'a que des liens anonymes rend [] — et n'interroge pas les sessions", async () => {
    liens = [lien("Anonyme", {}), lien("Anonyme-2", {})];
    sessions = [session("s-a", "Anonyme"), session("s-b", "Anonyme-2")];
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(r.statut).toBe(200);
    expect(r.corps.sessions).toEqual([]);
    expect(r.corps.scope).toBe("host");
    expect(demandes.some((d) => d.startsWith("commercial_doc_sessions")),
      "aucun lien attesté : rien à lire côté sessions").toBe(false);
  });

  // ⚠️ LA BORNE EST DANS LA REQUÊTE. Le `docId` d'une plaquette se partage entre clients ; si la
  // lecture prenait les 500 sessions les plus récentes du document puis filtrait, cinq cents
  // lectures anonymes repousseraient hors de la fenêtre celle du client attesté — et l'hôte lirait
  // « 0 de lecture » là où il y en a une : le constat du #574, reproduit par sa correction.
  it("⚠️ n'est pas tronquée par les lectures anonymes plus récentes du même document", async () => {
    liens = [lien("Atteste-1", { atteste: "claire@client.fr" }), lien("Anonyme", {})];
    sessions = [session("s-claire", "Atteste-1", { at: "2026-01-01T00:00:00.000Z" })];
    for (let i = 0; i < 600; i += 1) sessions.push(session(`s-anon-${i}`, "Anonyme", { at: `2026-10-10T10:00:00.${String(i).padStart(3, "0")}Z` }));
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(ids(r.corps)).toEqual(["s-claire"]);
  });

  it("⚠️ sans la migration 0001 : un 409 qui nomme le fichier, jamais un []", async () => {
    colonneAbsente = true;
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(r.statut).toBe(409);
    expect(r.corps.error).toBe("migration");
    expect(r.corps.message).toContain("0001-destinataire-atteste.sql");
    expect(r.corps.sessions, "un tableau vide se lirait « votre client n'a rien lu »").toBeUndefined();
  });

  it("exige un docId", async () => {
    const r = await appeler({ action: "docshare.sessions" }, { secret: SECRET });
    expect(r.statut).toBe(400);
  });

  it("est limitée en débit, sous une clé distincte de la création", async () => {
    await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(clesDeLimite.some((c) => c.startsWith("hsessions:"))).toBe(true);
    expect(clesDeLimite.some((c) => c.startsWith("hshare:"))).toBe(false);
    limiteRefusee = "hsessions:";
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: SECRET });
    expect(r.statut).toBe(429);
    expect(demandes.some((d) => d.startsWith("commercial_doc_sessions")), "refusé avant toute lecture").toBe(false);
  });
});

describe("ce qui ne change pas pour les membres", () => {
  it("un membre sans list.all reste borné à ses liens — aucun lien attesté", async () => {
    membre = { email: "alice@hote.example" };
    droits = async (_u, acte) => acte !== "list.all";
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { jwt: "jeton" });
    expect(r.statut).toBe(200);
    expect(r.corps.scope).toBe("mine");
    expect(ids(r.corps)).toEqual(["s-membre"]);
  });

  it("un MAUVAIS secret n'ouvre pas la portée de l'hôte : sans jeton, 401", async () => {
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: "pas-le-bon" });
    expect(r.statut).toBe(401);
  });

  it("un mauvais secret accompagné d'un jeton de membre reste une lecture de membre", async () => {
    membre = { email: "alice@hote.example" };
    droits = async (_u, acte) => acte !== "list.all";
    const r = await appeler({ action: "docshare.sessions", docId: "programme-42" }, { secret: "pas-le-bon", jwt: "jeton" });
    expect(r.statut).toBe(200);
    expect(r.corps.scope).toBe("mine");
    expect(ids(r.corps)).toEqual(["s-membre"]);
  });
});
