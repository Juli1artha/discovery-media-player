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
  return { origine: envois[0] ? envois[0].origin : null, alertes };
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
  it("sans URL publique : repli sur Host, mais signalé", async () => {
    const r = await repartager({ publicUrl: "", host: "doc.exemple.fr" });
    expect(r.origine).toBe("https://doc.exemple.fr");
    expect(r.alertes.join(" ")).toMatch(/PLAYER_PUBLIC_URL/);
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
