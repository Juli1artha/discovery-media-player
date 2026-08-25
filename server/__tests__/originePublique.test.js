// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'EN-TÊTE `Host` EST CHOISI PAR LE CLIENT.
//
// Le lien inséré dans l'email de re-partage était construit avec `req.headers.host`. Sur le
// serveur autonome, ou derrière un proxy qui ne le réécrit pas strictement, un lecteur pouvait
// donc demander un envoi parfaitement légitime — signé par l'hôte, avec sa marque — dont le bouton
// pointe vers SON domaine.
//
// ⚠️ Ce qui distingue ce défaut d'un simple lien cassé : l'email part de l'hôte, vers un
// destinataire choisi par l'attaquant, avec la réputation d'expéditeur de l'hôte derrière lui.
// C'est de l'hameçonnage fourni clé en main, et la victime n'a aucune raison de se méfier.
//
// Signalé par un audit externe (P1-1).

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const PARENT = {
  slug: "Nomi-_xYz9012", doc_id: "d1", doc_title: "Proposition", file_name: "p.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
  recipient_email: "premier@exemple.fr", recipient_name: "Premier",
  created_by: "commercial@exemple.fr", revoked: false,
};

let envois = [];
const vraisShares = require("../shares.js");
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: {
    ...vraisShares,
    getShareBySlug: async () => ({ ...PARENT }),
    createReshare: async () => ({ slug: "Enfant-_xY12", docTitle: "Doc" }),
    sendReshareEmail: async (m) => { envois.push(m); return { sent: true }; },
    logShareEvent: async () => {},
  },
};

const player = require("../handler.js");

let alertes = [];

function contexte(publicUrl) {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() { return { sent: true }; } },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture(e) { alertes.push(String(e && e.message)); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "", publicUrl },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function repartager({ publicUrl = "", host = "doc.exemple.fr" } = {}) {
  envois = []; alertes = [];
  player.init(contexte(publicUrl));
  const res = { statusCode: 0, headers: {}, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json", host }, socket: {}, query: {},
      body: { action: "reshare", slug: PARENT.slug, email: "cible@exemple.fr", send: true } },
    res,
  );
  let corps = {}; try { corps = JSON.parse(res.body || "{}"); } catch { /* réponse non JSON */ }
  return { origine: envois[0] ? envois[0].origin : null, alertes, envois, corps };
}

describe("d'où vient le lien qui part par email", () => {
  it("⚠️ un Host forgé ne fabrique plus le lien quand l'URL publique est configurée", async () => {
    const r = await repartager({ publicUrl: "https://doc.exemple.fr", host: "attaquant.example" });
    expect(r.origine, "l'attaquant ne doit pas choisir le domaine du lien").toBe("https://doc.exemple.fr");
  });

  it("l'URL publique gagne toujours, même sur un Host légitime", async () => {
    const r = await repartager({ publicUrl: "https://doc.exemple.fr", host: "doc.exemple.fr" });
    expect(r.origine).toBe("https://doc.exemple.fr");
  });

  // ⚠️ Le repli existe pour ne casser aucune instance déjà en service. Mais une instance qui
  // envoie des emails sans URL publique doit l'apprendre AVANT de le découvrir dans un rapport
  // d'hameçonnage — un défaut silencieux est un défaut qui dure.
  // ⚠️ CE TEST ENCODAIT LE REPLI, DONC IL PROTÉGEAIT LE TROU.
  //
  // Il vérifiait « sans URL publique : repli sur Host, mais signalé » — c'est-à-dire qu'il exigeait
  // que l'email parte quand même. Une alerte n'est pas une interdiction : le journal ne bloque pas
  // un hameçonnage, et l'exploitant l'apprend dans un rapport d'abus. (audit P1-1)
  //
  // Quatrième test de la journée qui épinglait un défaut en croyant décrire une propriété.
  it("sans URL publique : RIEN NE PART, et le refus est nommé", async () => {
    const r = await repartager({ publicUrl: "", host: "doc.exemple.fr" });
    expect(r.envois, "aucun courrier ne doit sortir").toHaveLength(0);
    expect(r.corps.sent).toBe(false);
    expect(r.corps.sendRefused).toBe("public-url-unconfigured");
    expect(r.alertes.join(" "), "et l'exploitant l'apprend par ses journaux, pas par un tiers")
      .toMatch(/PLAYER_PUBLIC_URL/);
  });

  // ⚠️ Ce qu'on refuse est l'ENVOI, pas le lien. Le lien est la fonction principale de cette
  // route : le retenir casserait le re-partage entier pour fermer un chemin de courrier.
  it("mais le lien est bien créé — c'est l'envoi qu'on retient, pas le partage", async () => {
    const r = await repartager({ publicUrl: "", host: "doc.exemple.fr" });
    expect(r.corps.ok).toBe(true);
    expect(r.corps.slug, "l'appelant peut transmettre le lien lui-même").toBeTruthy();
  });

  it("l'alerte ne se déclenche pas quand tout est configuré", async () => {
    const r = await repartager({ publicUrl: "https://doc.exemple.fr" });
    expect(r.alertes.join(" ")).not.toMatch(/PLAYER_PUBLIC_URL/);
  });
});

// Une URL publique qui n'est pas en https serait un repli déguisé : on la refuse à la source.
describe("ce que le contexte accepte comme URL publique", () => {
  const { createStandaloneContext } = require("../../context/standalone.js");
  const ctx = (v) => createStandaloneContext({ SUPABASE_URL: "https://x.supabase.co", PLAYER_PUBLIC_URL: v }).legal.publicUrl;

  it("garde une https, sans barre finale", () => {
    expect(ctx("https://doc.exemple.fr/")).toBe("https://doc.exemple.fr");
    expect(ctx("https://doc.exemple.fr///")).toBe("https://doc.exemple.fr");
  });

  it("refuse http et toute autre forme — sinon le lien part en clair", () => {
    expect(ctx("http://doc.exemple.fr")).toBe("");
    expect(ctx("doc.exemple.fr")).toBe("");
    expect(ctx("")).toBe("");
  });
});

// ⚠️ LE COMPORTEMENT A CHANGÉ, LES TEXTES SONT RESTÉS — PENDANT DES SEMAINES.
//
// La 0.1.21 posait un repli sur `Host` et le signalait ; la seconde passe d'audit l'a fermé
// (P1-1) et le code refuse désormais l'envoi. Mais `docs/CONFIGURATION.md`, `.env.example` et le
// commentaire de `context/standalone.js` ont continué à promettre le repli, jusqu'à ce qu'un
// troisième audit externe les relise (21/08). Un exploitant qui lit la doc conclut que son
// instance enverra quand même : il ne pose pas la variable, et découvre le refus le jour d'un
// envoi qui compte.
//
// ⚠️ CETTE GARDE EST POSITIVE, ET C'EST DÉLIBÉRÉ. Interdire la formule « repli sur Host » se
// serait retourné contre nous : les textes corrigés CITENT l'ancien comportement pour expliquer
// pourquoi il a été retiré, et une garde par interdiction accuse la citation autant que la
// promesse — elle pousse alors à effacer l'explication pour la satisfaire. On exige donc la
// présence de ce que le code fait VRAIMENT, en prenant le motif de refus DANS le code : les
// textes ne peuvent plus décrire un comportement qui n'existe pas sans qu'il leur manque celui
// qui existe. Même formule que partout ici — un fait en deux exemplaires, quelqu'un les
// confronte, et « quelqu'un » peut être un test.
describe("les textes qui décrivent PLAYER_PUBLIC_URL disent ce que le code fait", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const racine = path.join(__dirname, "..", "..");

  // La source du fait : le motif que la route rend réellement quand l'URL publique manque.
  // ⚠️ On ancre sur le préfixe `public-url-`, pas sur le premier `refusEnvoi` venu : la route en
  // rend plusieurs (`no-recipient` la précède), et prendre le premier ferait porter la garde sur
  // un autre refus — elle passerait au vert en surveillant la mauvaise chose. Renommer le motif
  // fait rougir ici : c'est voulu, les textes doivent suivre le code.
  const motif = (() => {
    const src = fs.readFileSync(path.join(racine, "server", "routes-liens.js"), "utf8");
    return (src.match(/refusEnvoi = "(public-url-[a-z-]+)"/) || [])[1];
  })();

  it("le code nomme son refus — sans quoi il n'y a rien à confronter", () => {
    expect(motif).toBe("public-url-unconfigured");
  });

  for (const fichier of ["docs/CONFIGURATION.md", ".env.example", "context/standalone.js"]) {
    it(`${fichier} cite le refus que le code applique`, () => {
      const texte = fs.readFileSync(path.join(racine, fichier), "utf8");
      expect(texte, `${fichier} décrit PLAYER_PUBLIC_URL sans jamais nommer « ${motif} » — ` +
        "le lecteur ne peut pas savoir que rien ne partira").toContain(motif);
    });
  }
});
